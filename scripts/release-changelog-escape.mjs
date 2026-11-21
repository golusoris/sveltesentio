// release-please copies commit footers verbatim into CHANGELOG.md. Prettier leaves bare
// `*` and `_` that sit next to whitespace as plain text. markdownlint MD037 (see
// tools/markdownlint/node_modules/markdownlint/lib/md037.mjs) pairs micromark `data` tokens
// whose text is exactly `*`, `**`, `***`, `_`, `__`, or `___` and flags a marker when
// whitespace sits inside the emphasis span. Backslash escapes render the same character in
// CommonMark, so `\_` and `\*` silence MD037 without changing displayed text.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

export const MAX_TOKENS = 1_000_000;
const MAX_DEPTH = 1_024;
const MAX_FILES = 256;
const MARKER = /^[*_]{1,3}$/u;

/** @typedef {{ lint: Function, applyFixes: Function, yaml: { load: (s: string) => unknown } }} MarkdownlintBundle */

const LOCK_FILES = ['package.json', 'package-lock.json'];
const NPM_CI_TIMEOUT_MS = 120_000;

/** Private installs this process made, keyed by tool directory. */
const privateInstalls = new Map();

/**
 * Loads markdownlint from the tools/markdownlint install. When that install is absent, the
 * same lockfile is installed once per process into a private temporary directory, as
 * tools/markdownlint/verify.mjs does. `node --test` runs each test file in its own process,
 * and `npm ci` deletes node_modules before it installs, so a shared install directory would
 * let one worker remove the modules another worker is loading.
 *
 * @param {{ toolDir?: string, install?: (dir: string) => void }} [options]
 * @returns {MarkdownlintBundle}
 */
export function loadMarkdownlint(options = {}) {
	const toolDir = options.toolDir ?? join(repoRoot, 'tools', 'markdownlint');
	try {
		return loadMarkdownlintFrom(join(toolDir, 'package.json'));
	} catch (error) {
		// Only a missing install falls through to the private install; any other load error
		// fails the caller.
		if (error?.code !== 'MODULE_NOT_FOUND') throw error;
	}
	let dir = privateInstalls.get(toolDir);
	if (dir === undefined) {
		dir = privateInstall(toolDir, options.install ?? npmCi);
		privateInstalls.set(toolDir, dir);
	}
	return loadMarkdownlintFrom(join(dir, 'package.json'));
}

/**
 * @param {string} toolDir
 * @param {(dir: string) => void} install
 * @returns {string}
 */
function privateInstall(toolDir, install) {
	const dir = mkdtempSync(join(tmpdir(), 'release-changelog-markdownlint-'));
	process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
	for (const name of LOCK_FILES) copyFileSync(join(toolDir, name), join(dir, name));
	install(dir);
	return dir;
}

/** @param {string} dir */
function npmCi(dir) {
	execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
		cwd: dir,
		stdio: 'pipe',
		timeout: NPM_CI_TIMEOUT_MS,
	});
}

/**
 * @param {string} toolPkg
 * @returns {MarkdownlintBundle}
 */
function loadMarkdownlintFrom(toolPkg) {
	const req = createRequire(toolPkg);
	const main = req('markdownlint');
	return {
		lint: req('markdownlint/sync').lint,
		applyFixes: main.applyFixes,
		yaml: req('js-yaml'),
	};
}

/**
 * @param {{ parent?: object, type?: string } | undefined} token
 * @param {number} maxDepth
 * @returns {boolean}
 */
function hasHtmlFlowAncestor(token, maxDepth) {
	let parent = token?.parent;
	let depth = 0;
	while (parent) {
		if (depth >= maxDepth) {
			throw new Error(`ancestor walk exceeded MAX_DEPTH=${maxDepth}`);
		}
		if (parent.type === 'htmlFlow') return true;
		parent = parent.parent;
		depth += 1;
	}
	return false;
}

/**
 * @param {{ startLine: number, startColumn: number, endColumn: number }} token
 * @param {string[]} lines
 * @returns {boolean}
 */
function markerTouchesWhitespace(token, lines) {
	const line = lines[token.startLine - 1] ?? '';
	let touch = false;
	if (token.startColumn > 1) {
		const ch = line[token.startColumn - 2];
		if (ch !== undefined && /\s/u.test(ch)) touch = true;
	}
	const after = token.endColumn - 1;
	if (after < line.length) {
		const ch = line[after];
		if (ch !== undefined && /\s/u.test(ch)) touch = true;
	}
	return touch;
}

/**
 * @param {object[]} roots
 * @param {number} maxTokens
 * @param {(token: object) => void} visit
 */
function walkTokens(roots, maxTokens, visit) {
	const stack = roots.slice().reverse();
	let seen = 0;
	while (stack.length > 0) {
		if (seen >= maxTokens) {
			throw new Error(`token walk exceeded MAX_TOKENS=${maxTokens}`);
		}
		const token = stack.pop();
		seen += 1;
		visit(token);
		const children = token.children;
		if (Array.isArray(children) && children.length > 0) {
			for (let i = children.length - 1; i >= 0; i -= 1) {
				stack.push(children[i]);
			}
		}
	}
}

/**
 * @param {{ maxTokens?: number }} [options]
 * @returns {object}
 */
function buildBareEmphasisRule(options = {}) {
	const maxTokens = options.maxTokens ?? MAX_TOKENS;
	return {
		names: ['release-bare-emphasis'],
		description: 'Bare emphasis markers adjacent to whitespace',
		tags: ['emphasis'],
		parser: 'micromark',
		function: (params, onError) => {
			const lines = params.lines;
			const tokens = params.parsers.micromark.tokens;
			walkTokens(tokens, maxTokens, (token) => {
				if (token.type !== 'data' || !MARKER.test(token.text)) return;
				if (hasHtmlFlowAncestor(token, MAX_DEPTH)) return;
				if (!markerTouchesWhitespace(token, lines)) return;
				onError({
					lineNumber: token.startLine,
					detail: token.text,
					fixInfo: {
						editColumn: token.startColumn,
						deleteCount: token.text.length,
						insertText: [...token.text].map((c) => `\\${c}`).join(''),
					},
				});
			});
		},
	};
}

/**
 * Escapes bare `*` / `_` markers next to whitespace so MD037 stays clean after prettier.
 *
 * @param {string} text
 * @param {MarkdownlintBundle} markdownlint
 * @param {{ maxTokens?: number }} [options]
 * @returns {string}
 */
export function escapeBareEmphasis(text, markdownlint, options = {}) {
	const rule = buildBareEmphasisRule(options);
	const results = markdownlint.lint({
		strings: { changelog: text },
		config: { default: false, 'release-bare-emphasis': true },
		customRules: [rule],
	});
	const errors = results.changelog ?? [];
	return markdownlint.applyFixes(text, errors);
}

/**
 * @param {string} file
 * @param {string} content
 * @param {MarkdownlintBundle} markdownlint
 * @returns {number} exit code fragment (0 ok, 1 had MD037)
 */
function lintFileMd037(file, content, markdownlint) {
	const results = markdownlint.lint({
		strings: { [file]: content },
		config: { default: false, MD037: true },
	});
	let failed = 0;
	for (const err of results[file] ?? []) {
		if (err.ruleNames?.includes('MD037')) {
			process.stderr.write(`${file}:${err.lineNumber} MD037\n`);
			failed = 1;
		}
	}
	return failed;
}

/**
 * @param {string[]} files
 * @returns {number}
 */
function runCli(files) {
	const markdownlint = loadMarkdownlint();
	let exitCode = 0;
	for (const file of files) {
		let original;
		try {
			original = readFileSync(file, 'utf8');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`${file}: ${message}`, { cause: error });
		}
		const escaped = escapeBareEmphasis(original, markdownlint);
		if (escaped !== original) {
			writeFileSync(file, escaped, 'utf8');
			process.stdout.write(`escaped ${file}\n`);
		}
		exitCode = Math.max(exitCode, lintFileMd037(file, escaped, markdownlint));
	}
	return exitCode;
}

/**
 * @returns {number}
 */
function main() {
	const files = process.argv.slice(2);
	if (files.length === 0) {
		process.stderr.write('usage: node scripts/release-changelog-escape.mjs <file>...\n');
		return 2;
	}
	if (files.length > MAX_FILES) {
		process.stderr.write(`too many files (${files.length}); MAX_FILES=${MAX_FILES}\n`);
		return 2;
	}
	try {
		return runCli(files);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`${message}\n`);
		return 1;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	process.exitCode = main();
}
