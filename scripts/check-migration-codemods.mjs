#!/usr/bin/env node
// Fails when a migration guide's `codemods` count disagrees with the codemods
// under tools/migrations/, or when a codemod's output differs from its fixtures.
//
// docs/migrations/README.md tells authors to ship a mechanical rewrite as a
// codemod under tools/migrations/v<MAJOR.MINOR>/. Nothing held that promise:
// the directory did not exist and no test ran a codemod (gap audit C14-02), so
// a guide could claim a codemod nobody wrote, or ship one that rewrites code
// wrongly. The contract checked here is written down in tools/migrations/README.md.
//
// `make verify-all` and the CI lint job run it; `pnpm test:scripts` runs the
// tests in check-migration-codemods.test.mjs.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { withTimeout } from './check-template-labels.mjs';
import { errorMessage, runCodemod } from './codemod-worker.mjs';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// Upper bounds (HISS-02): entries in docs/migrations/, version directories in
// tools/migrations/, codemods per version, fixture files per codemod, lines of
// frontmatter, and the deadlines for file reads, one codemod call, and the suite.
export const ENTRY_LIMIT = 1_000;
export const VERSION_LIMIT = 200;
export const CODEMOD_LIMIT = 100;
export const FIXTURE_LIMIT = 200;
export const FRONTMATTER_LINE_LIMIT = 200;
export const TRANSFORM_TIMEOUT_MS = 30_000;
// Half of the lint job's timeout-minutes: 10; it also installs and runs other checks.
// An in-flight readdir cannot be cancelled: the run ends at most one IO_TIMEOUT_MS
// past the suite deadline.
export const SUITE_TIMEOUT_MS = 300_000;
const IO_TIMEOUT_MS = 10_000;

/** A version guide in docs/migrations/, such as v0.2.md. */
const VERSION_DOC = /^v(\d+\.\d+)\.md$/;
/** A version directory in tools/migrations/, such as v0.2. */
const VERSION_DIR = /^v(\d+\.\d+)$/;
/** A fixture: `<case>.input<ext>` or `<case>.output<ext>`; `<ext>` may have several parts (`.svelte.ts`). */
const FIXTURE = /^([A-Za-z0-9_-]+)\.(input|output)((?:\.[A-Za-z0-9]+)+)$/;

/** @typedef {{ file: string, message: string }} Finding */
/** @typedef {{ root: string, timeoutMs: number, suite: AbortSignal, findings: Finding[] }} Context */

/** @param {unknown} error */
function isMissing(error) {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Records a finding against `path`, written relative to the checked root with forward slashes. */
function note(
	/** @type {Context} */ ctx,
	/** @type {string} */ path,
	/** @type {string} */ message,
) {
	ctx.findings.push({ file: relative(ctx.root, path).split(sep).join('/'), message });
}

/** @param {string} path @param {AbortSignal} [signal] */
function readText(path, signal) {
	const deadline = AbortSignal.timeout(IO_TIMEOUT_MS);
	return readFile(path, {
		encoding: 'utf8',
		signal: signal ? AbortSignal.any([deadline, signal]) : deadline,
	});
}

/** @param {unknown} doc @returns {{ count: number } | { error: string }} */
function codemodsField(doc) {
	if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
		return { error: 'frontmatter must be a YAML mapping' };
	}
	if (!('codemods' in doc)) {
		return { error: 'frontmatter has no codemods count' };
	}
	const count = doc.codemods;
	if (!Number.isInteger(count) || count < 0) {
		return { error: `codemods must be a whole number >= 0, got ${JSON.stringify(count)}` };
	}
	return { count };
}

/**
 * The `codemods` count a migration guide declares in its YAML frontmatter: the
 * lines between a first line `---` and the next line `---`.
 * @param {string} source
 * @returns {{ count: number } | { error: string }}
 */
export function readCodemodCount(source) {
	const lines = source.split(/\r?\n/, FRONTMATTER_LINE_LIMIT + 2);
	if (lines[0] !== '---') {
		return { error: 'no YAML frontmatter: the first line must be ---' };
	}
	const end = lines.indexOf('---', 1);
	if (end === -1) {
		return { error: `frontmatter has no closing --- within ${FRONTMATTER_LINE_LIMIT} lines` };
	}
	let doc;
	try {
		doc = parse(lines.slice(1, end).join('\n'), { uniqueKeys: true });
	} catch (error) {
		return { error: `frontmatter is not valid YAML: ${errorMessage(error)}` };
	}
	return codemodsField(doc);
}

/** The 1-based number of the first line where two texts differ. */
export function firstDifferentLine(/** @type {string} */ actual, /** @type {string} */ expected) {
	const a = actual.split('\n');
	const b = expected.split('\n');
	const limit = Math.max(a.length, b.length);
	for (let i = 0; i < limit; i++) {
		if (a[i] !== b[i]) return i + 1;
	}
	return limit;
}

/**
 * A directory's entries sorted by name; `null` when it does not exist. A listing
 * over `limit`, or one that fails, is a finding and yields no entries: nothing
 * is checked silently short.
 * @returns {Promise<import('node:fs').Dirent[] | null>}
 */
async function listDir(
	/** @type {Context} */ ctx,
	/** @type {string} */ dir,
	/** @type {number} */ limit,
) {
	if (ctx.suite.aborted) return null;
	let entries;
	try {
		entries = await withTimeout(
			readdir(dir, { withFileTypes: true }),
			IO_TIMEOUT_MS,
			`readdir ${dir}`,
		);
	} catch (error) {
		if (ctx.suite.aborted || isMissing(error)) return null;
		note(ctx, dir, `cannot be listed: ${errorMessage(error)}`);
		return [];
	}
	if (ctx.suite.aborted) return null;
	if (entries.length > limit) {
		note(
			ctx,
			dir,
			`holds ${entries.length} entries, more than the limit of ${limit}; nothing in it was checked`,
		);
		return [];
	}
	return entries.sort((x, y) => (x.name < y.name ? -1 : 1));
}

/** Each version guide in docs/migrations/ with the count it declares (`null` when unreadable). */
async function readVersionDocs(/** @type {Context} */ ctx) {
	const dir = join(ctx.root, 'docs', 'migrations');
	/** @type {Map<string, { path: string, count: number | null }>} */
	const docs = new Map();
	for (const entry of (await listDir(ctx, dir, ENTRY_LIMIT)) ?? []) {
		if (ctx.suite.aborted) break;
		const match = VERSION_DOC.exec(entry.name);
		if (!entry.isFile() || !match) continue;
		const path = join(dir, entry.name);
		const result = readCodemodCount(await readText(path, ctx.suite));
		if ('error' in result) note(ctx, path, result.error);
		docs.set(match[1], { path, count: 'count' in result ? result.count : null });
	}
	return docs;
}

/** Each version directory in tools/migrations/ with the codemod directories it holds. */
async function readCodemodVersions(/** @type {Context} */ ctx) {
	const dir = join(ctx.root, 'tools', 'migrations');
	/** @type {Map<string, { path: string, codemods: string[] }>} */
	const versions = new Map();
	for (const entry of (await listDir(ctx, dir, VERSION_LIMIT)) ?? []) {
		if (ctx.suite.aborted) break;
		if (!entry.isDirectory()) continue;
		const path = join(dir, entry.name);
		const match = VERSION_DIR.exec(entry.name);
		if (!match) {
			note(
				ctx,
				path,
				'not a v<MAJOR.MINOR> directory; codemods live in tools/migrations/v<MAJOR.MINOR>/<name>/',
			);
			continue;
		}
		const listed = (await listDir(ctx, path, CODEMOD_LIMIT)) ?? [];
		const codemods = listed.filter((e) => e.isDirectory()).map((e) => join(path, e.name));
		versions.set(match[1], { path, codemods });
	}
	return versions;
}

/** Each guide's declared count against the codemods shipped for its version, both ways. */
function compareCounts(ctx, docs, versions) {
	for (const [version, doc] of docs) {
		const have = versions.get(version)?.codemods.length ?? 0;
		if (doc.count !== null && doc.count !== have) {
			note(
				ctx,
				doc.path,
				`declares codemods: ${doc.count}, tools/migrations/v${version}/ has ${have}`,
			);
		}
	}
	for (const [version, dir] of versions) {
		if (!docs.has(version)) {
			note(
				ctx,
				dir.path,
				`no migration guide docs/migrations/v${version}.md declares these codemods`,
			);
		}
	}
}

/** The codemod's transform file path, or `null` after recording why it cannot be run. */
async function loadTransform(/** @type {Context} */ ctx, /** @type {string} */ dir) {
	const file = join(dir, 'transform.mjs');
	const found = await withTimeout(stat(file), IO_TIMEOUT_MS, `stat ${file}`).then(
		(s) => s.isFile(),
		() => false,
	);
	if (ctx.suite.aborted) return null;
	if (!found) {
		note(ctx, file, 'missing: every codemod needs a transform.mjs');
		return null;
	}
	const result = await runCodemod({
		transformFile: file,
		mode: 'load',
		timeoutMs: ctx.timeoutMs,
		signal: ctx.suite,
	});
	if (!result.ok) {
		if (result.kind === 'aborted') return null;
		const message =
			result.kind === 'export'
				? 'must default-export a function (source, filePath) => string'
				: `cannot be imported: ${result.message}`;
		note(ctx, file, message);
		return null;
	}
	return file;
}

/** Fixture pairs complete on both sides; a lone side, or no pair at all, is a finding. */
function completePairs(ctx, dir, cases) {
	const pairs = [];
	for (const pair of cases.values()) {
		if (pair.input === null) note(ctx, pair.output, 'has no matching .input fixture');
		else if (pair.output === null) note(ctx, pair.input, 'has no matching .output fixture');
		else pairs.push(pair);
	}
	if (pairs.length === 0) {
		note(
			ctx,
			dir,
			'holds no fixture pair; every codemod needs at least one <case>.input<ext> and <case>.output<ext>',
		);
	}
	return pairs;
}

/** The fixture pairs; `path` is relative to the codemod directory, with forward slashes. */
async function readFixturePairs(/** @type {Context} */ ctx, /** @type {string} */ dir) {
	const entries = await listDir(ctx, dir, FIXTURE_LIMIT);
	if (ctx.suite.aborted) return [];
	if (entries === null) {
		note(
			ctx,
			dir,
			'missing: every codemod needs fixtures/<case>.input<ext> and <case>.output<ext>',
		);
		return [];
	}
	/** @type {Map<string, { input: string | null, output: string | null, path: string }>} */
	const cases = new Map();
	for (const entry of entries) {
		const match = FIXTURE.exec(entry.name);
		if (!entry.isFile() || !match) {
			note(
				ctx,
				join(dir, entry.name),
				'not a fixture: name it <case>.input<ext> or <case>.output<ext>',
			);
			continue;
		}
		const key = `${match[1]}${match[3]}`;
		const pair = cases.get(key) ?? { input: null, output: null, path: `fixtures/${key}` };
		pair[/** @type {'input' | 'output'} */ (match[2])] = join(dir, entry.name);
		cases.set(key, pair);
	}
	return completePairs(ctx, dir, cases);
}

/**
 * Runs the codemod on one text under the deadline. A throw, a rejection, a
 * deadline miss or a non-string result is reported, never thrown. A suite abort records no pair finding.
 * @returns {Promise<{ ok: true, value: string } | { ok: false, message: string | null }>}
 */
async function applyTransform(ctx, /** @type {string} */ transformFile, source, filePath) {
	const result = await runCodemod({
		transformFile,
		mode: 'call',
		source,
		filePath,
		timeoutMs: ctx.timeoutMs,
		signal: ctx.suite,
	});
	if (result.ok) return /** @type {{ ok: true, value: string }} */ (result);
	if (result.kind === 'aborted') return { ok: false, message: null };
	return {
		ok: false,
		message:
			result.kind === 'type'
				? `codemod must return a string, got ${result.message}`
				: `codemod failed: ${result.message}`,
	};
}

/**
 * One fixture pair: the input must turn into the output exactly, and the output must stay as it is.
 * Both runs see the fixture's path without `.input`/`.output` (`fixtures/basic.ts`
 * for `basic.input.ts`), so the transform sees the real extension and cannot pass
 * the second run by reading a different path. Each call uses a fresh Worker and
 * module instance, so module state cannot make the second run pass.
 */
async function checkPair(
	ctx,
	transform,
	/** @type {{ input: string, output: string, path: string }} */ pair,
) {
	const source = await readText(pair.input, ctx.suite);
	const expected = await readText(pair.output, ctx.suite);
	const actual = await applyTransform(ctx, transform, source, pair.path);
	if (!actual.ok) {
		if (actual.message !== null) note(ctx, pair.input, actual.message);
		return;
	}
	if (actual.value !== expected) {
		const line = firstDifferentLine(actual.value, expected);
		note(ctx, pair.output, `codemod output differs from this fixture at line ${line}`);
		return;
	}
	const again = await applyTransform(ctx, transform, expected, pair.path);
	if (!again.ok) {
		if (again.message !== null) note(ctx, pair.output, again.message);
	} else if (again.value !== expected) {
		note(ctx, pair.output, 'not idempotent: applying the codemod to its own output changes it');
	}
}

/** One codemod directory: its transform, then each of its fixture pairs. */
async function checkCodemod(/** @type {Context} */ ctx, /** @type {string} */ dir) {
	if (ctx.suite.aborted) return;
	const transform = await loadTransform(ctx, dir);
	if (transform === null || ctx.suite.aborted) return;
	for (const pair of await readFixturePairs(ctx, join(dir, 'fixtures'))) {
		if (ctx.suite.aborted) break;
		await checkPair(ctx, transform, pair);
	}
}

/** Checks discovered codemods until the suite deadline, returning the number checked. */
async function checkVersions(/** @type {Context} */ ctx, versions) {
	let codemods = 0;
	for (const version of versions.values()) {
		if (ctx.suite.aborted) break;
		for (const dir of version.codemods) {
			if (ctx.suite.aborted) break;
			await checkCodemod(ctx, dir);
			codemods++;
		}
	}
	return codemods;
}

/**
 * Every finding for the guides in `root`/docs/migrations/ and the codemods in
 * `root`/tools/migrations/.
 * @param {{ root?: string, timeoutMs?: number, suiteTimeoutMs?: number,
 * signal?: AbortSignal }} [options]
 * @returns {Promise<{ guides: number, codemods: number, findings: Finding[] }>}
 */
export async function runCheck({
	root = repoRoot,
	timeoutMs = TRANSFORM_TIMEOUT_MS,
	suiteTimeoutMs = SUITE_TIMEOUT_MS,
	signal,
} = {}) {
	const suite = AbortSignal.timeout(suiteTimeoutMs);
	/** @type {Context} */
	const ctx = {
		root,
		timeoutMs,
		suite: signal ? AbortSignal.any([suite, signal]) : suite,
		findings: [],
	};
	let docs = new Map();
	let codemods = 0;
	try {
		docs = await readVersionDocs(ctx);
		const versions = await readCodemodVersions(ctx);
		if (!ctx.suite.aborted) {
			compareCounts(ctx, docs, versions);
			codemods = await checkVersions(ctx, versions);
		}
	} catch (error) {
		if (!ctx.suite.aborted) {
			throw new Error(`migration codemod check failed: ${errorMessage(error)}`, { cause: error });
		}
	}
	if (ctx.suite.aborted) {
		note(
			ctx,
			join(root, 'tools', 'migrations'),
			`suite deadline of ${suiteTimeoutMs} ms reached; the remaining codemods and fixtures were not checked`,
		);
	}
	return { guides: docs.size, codemods, findings: ctx.findings };
}

/** Returns the exit code: 0 when every guide's count matches and every codemod passes its fixtures. */
export async function main(root = repoRoot) {
	const { guides, codemods, findings } = await runCheck({ root });
	if (findings.length > 0) {
		console.error(`Found ${findings.length} migration codemod problem(s):\n`);
		for (const { file, message } of findings) console.error(`  ${file}: ${message}`);
		console.error('\nThe codemod contract is in tools/migrations/README.md.');
		return 1;
	}
	console.log(`OK: ${guides} migration guide(s), ${codemods} codemod(s) checked.`);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		process.exitCode = await main();
	} catch (error) {
		console.error(errorMessage(error));
		process.exitCode = 1;
	}
}
