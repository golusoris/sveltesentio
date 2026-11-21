import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const SOURCE_EXT = /\.(ts|mts|cts|js|mjs|cjs|svelte)$/i;

// eslint flags that take no value. Any other flag is refused so a valued flag
// (`--max-warnings 0`, `--ignore-pattern e2e`) never reads as a lint target.
const VALUELESS_FLAGS = new Set(['--cache', '--fix']);

/** Tracked files that match the given globs. */
function tracked(...globs) {
	return execFileSync('git', ['ls-files', '--', ...globs], { cwd: root, encoding: 'utf8' })
		.split('\n')
		.filter((file) => file !== '');
}

/**
 * @param {string | undefined} lintCommand
 * @returns {string[]}
 */
export function eslintTargets(lintCommand) {
	if (lintCommand === undefined || lintCommand === '') {
		return [];
	}
	const segments = lintCommand.split('&&');
	const targets = [];
	const segmentCount = segments.length;
	for (let s = 0; s < segmentCount; s += 1) {
		const words = segments[s].trim().split(/\s+/);
		if (words[0] !== 'eslint') {
			continue;
		}
		const wordCount = words.length;
		for (let w = 1; w < wordCount; w += 1) {
			const arg = words[w];
			if (arg.startsWith('-')) {
				if (!VALUELESS_FLAGS.has(arg)) {
					throw new Error(`unsupported eslint flag ${arg}: add its value shape to eslintTargets`);
				}
				continue;
			}
			let normalized = arg;
			if (normalized.startsWith('./')) {
				normalized = normalized.slice(2);
			}
			if (normalized.endsWith('/')) {
				normalized = normalized.slice(0, -1);
			}
			targets.push(normalized);
		}
	}
	return targets;
}

/**
 * Top-level source files (vitest.config.ts, etc.) are out of scope — only first-path-segment dirs count.
 *
 * @param {string | undefined} lintCommand
 * @param {string[]} trackedFiles paths relative to the package directory
 * @returns {string[]}
 */
export function unlintedDirs(lintCommand, trackedFiles) {
	const targets = eslintTargets(lintCommand);
	const dirs = new Set();
	const fileCount = trackedFiles.length;
	for (let i = 0; i < fileCount; i += 1) {
		const file = trackedFiles[i];
		if (!SOURCE_EXT.test(file)) {
			continue;
		}
		const slash = file.indexOf('/');
		if (slash === -1) {
			continue;
		}
		dirs.add(file.slice(0, slash));
	}
	const uncovered = [];
	const sorted = [...dirs].sort();
	const dirCount = sorted.length;
	const coversAll = targets.includes('.');
	for (let d = 0; d < dirCount; d += 1) {
		const dir = sorted[d];
		if (coversAll || targets.includes(dir)) {
			continue;
		}
		uncovered.push(dir);
	}
	return uncovered;
}

/**
 * True when a `svelte-kit sync` segment runs before the first eslint segment.
 * Typed lint of a SvelteKit app reads the generated `./$types`; without the
 * sync, `src/routes` params lint as `any` and fail no-unsafe-* rules.
 *
 * @param {string | undefined} lintCommand
 * @returns {boolean}
 */
export function syncsBeforeEslint(lintCommand) {
	if (lintCommand === undefined || lintCommand === '') {
		return false;
	}
	const segments = lintCommand.split('&&');
	const segmentCount = segments.length;
	let synced = false;
	for (let s = 0; s < segmentCount; s += 1) {
		const segment = segments[s].trim();
		if (segment === 'svelte-kit sync') {
			synced = true;
		} else if (segment.split(/\s+/)[0] === 'eslint') {
			return synced;
		}
	}
	return false;
}

/** @param {string} pkgJsonPath repo-relative path to package.json */
function trackedRelativeToPackage(pkgJsonPath) {
	const prefix = pkgJsonPath.replace(/\/package\.json$/, '') + '/';
	return tracked(prefix).map((path) => path.slice(prefix.length));
}

/** @param {string} text package.json file contents */
function lintScript(text) {
	const scripts = JSON.parse(text).scripts ?? {};
	return scripts.lint ?? '';
}

describe('eslintTargets', () => {
	it('returns dirs covered by explicit eslint path args', () => {
		assert.deepEqual(eslintTargets('eslint src/ test/'), ['src', 'test']);
	});

	it('returns empty when eslint is absent or the script is empty', () => {
		assert.deepEqual(eslintTargets('vitest run'), []);
		assert.deepEqual(eslintTargets(''), []);
		assert.deepEqual(eslintTargets(undefined), []);
	});

	it('treats "." as an eslint target', () => {
		assert.deepEqual(eslintTargets('eslint .'), ['.']);
	});

	it('parses eslint only from post-sync segments', () => {
		assert.deepEqual(eslintTargets('svelte-kit sync && eslint src/ e2e/'), ['src', 'e2e']);
	});

	it('skips valueless flags and normalises ./ and trailing slashes', () => {
		assert.deepEqual(eslintTargets('eslint --cache ./src/ e2e/'), ['src', 'e2e']);
	});

	it('refuses a flag whose value shape it does not know', () => {
		assert.throws(() => eslintTargets('eslint --max-warnings 0 src/'), /--max-warnings/);
	});
});

describe('unlintedDirs', () => {
	it('reports uncovered dirs with source files', () => {
		assert.deepEqual(unlintedDirs('eslint src/', ['src/a.ts', 'e2e/b.spec.ts', 'e2e/c.png']), [
			'e2e',
		]);
	});

	it('treats "." in eslint targets as covering every dir', () => {
		assert.deepEqual(unlintedDirs('eslint .', ['src/a.ts', 'e2e/b.ts']), []);
	});

	it('ignores dirs that only contain non-source files', () => {
		assert.deepEqual(unlintedDirs('eslint src/', ['assets/logo.png']), []);
	});

	it('ignores top-level source files (no parent dir)', () => {
		assert.deepEqual(unlintedDirs('eslint vitest.config.ts', ['vitest.config.ts']), []);
	});
});

describe('workspace lint scripts cover every tracked source dir', () => {
	it('every package and app calls eslint over all source dirs', () => {
		const files = tracked('packages/*/package.json', 'apps/*/package.json');
		assert.ok(files.length > 0, 'no package.json found');
		const findings = [];
		const fileCount = files.length;
		for (let i = 0; i < fileCount; i += 1) {
			const pkgJsonPath = files[i];
			const text = readFileSync(join(root, pkgJsonPath), 'utf8');
			const script = lintScript(text);
			assert.ok(script.length > 0, `${pkgJsonPath}: missing scripts.lint`);
			assert.ok(
				eslintTargets(script).length > 0,
				`${pkgJsonPath}: scripts.lint must invoke eslint`,
			);
			const relFiles = trackedRelativeToPackage(pkgJsonPath);
			const uncovered = unlintedDirs(script, relFiles);
			const uncoveredCount = uncovered.length;
			for (let u = 0; u < uncoveredCount; u += 1) {
				findings.push(`${pkgJsonPath.replace(/\/package\.json$/, '')}: ${uncovered[u]}`);
			}
		}
		assert.deepEqual(findings, []);
	});

	it('every SvelteKit app syncs before eslint', () => {
		const files = tracked('packages/*/package.json', 'apps/*/package.json');
		const kitApps = files.filter((pkgJsonPath) =>
			trackedRelativeToPackage(pkgJsonPath).some((file) => file.startsWith('src/routes/')),
		);
		assert.ok(kitApps.includes('apps/docs/package.json'), 'kit app detection found no apps/docs');
		const findings = kitApps.filter(
			(pkgJsonPath) =>
				!syncsBeforeEslint(lintScript(readFileSync(join(root, pkgJsonPath), 'utf8'))),
		);
		assert.deepEqual(findings, []);
	});
});

describe('syncsBeforeEslint', () => {
	it('accepts svelte-kit sync ahead of eslint', () => {
		assert.equal(syncsBeforeEslint('svelte-kit sync && eslint src/ e2e/'), true);
	});

	it('rejects eslint without sync or with sync after it', () => {
		assert.equal(syncsBeforeEslint('eslint src/'), false);
		assert.equal(syncsBeforeEslint('eslint src/ && svelte-kit sync'), false);
	});

	it('rejects an empty or missing script', () => {
		assert.equal(syncsBeforeEslint(''), false);
		assert.equal(syncsBeforeEslint(undefined), false);
	});
});
