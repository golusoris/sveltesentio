import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getFileInfo } from 'prettier';
import { analyzeChanges } from './ci-affected.mjs';

const thisFile = fileURLToPath(import.meta.url);
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const selfPath = relative(root, thisFile).replaceAll('\\', '/');

const IO_TIMEOUT_MS = 10_000;
const CLASS_CAP = 500;
const TRACKED_CAP = 10_000;

const IGNORE_PATHS = [join(root, '.gitignore'), join(root, '.prettierignore')];

const MANAGED_BEGIN = /^# BEGIN praetor-managed artifacts(?:\s|$)/;
const MANAGED_END = /^# END praetor-managed artifacts(?:\s|$)/;
const PROJECTION_LINE =
	/^<!-- Compiled automatically by praetorctl compile-context from AGENTS\.md\. DO NOT EDIT DIRECTLY\. -->\r?$/m;
const PERSONA_PATH = /^\.[^/]+\/agents\/[^/]+\.md$/;
const STANDARDS_ROOT_PATH = /^\.standards[^/]*$/;

const REPO_FORMATTED_FILES = [
	'package.json',
	'prettier.config.js',
	'lefthook-local.yml',
	'packages/core/README.md',
	'.config/hiss/coverage.yaml',
	'scripts/node-test.mjs',
];

// `.prettierignore`'s managed block is written by `praetorctl adopt` and verified
// locally by `praetorctl audit`; CI does not run `praetorctl`, so this list is the
// CI-side copy. Update it in the same change whenever Praetor updates that block.
const RECORDED_MANAGED = Object.freeze([
	'.agents/agents/repo-auditor.md',
	'.agents/agents/repo-gatekeeper.md',
	'.config/agent/hooks/block_evasion.py',
	'.config/labels.yaml',
	'.devcontainer/devcontainer.json',
	'.github/rulesets/main.json',
	'.github/workflows/praetor-docs.yml',
	'.paperclip/harness.json',
	'.standards-baseline.json',
	'.standards.lock',
	'.standards.yaml',
	'AGENTS.md',
	'lefthook.yml',
	'tools/figures/README.md',
	'tools/figures/astro.mjs',
	'tools/figures/build.mjs',
	'tools/figures/checks.mjs',
	'tools/figures/core.mjs',
	'tools/figures/eslint.figures.mjs',
	'tools/figures/figures.css',
	'tools/figures/mkdocs_hook.py',
	'tools/figures/serve.mjs',
	'tools/figures/third_party/interfig/VENDOR.md',
	'tools/figures/third_party/interfig/upstream/LICENSE',
	'tools/figures/third_party/interfig/upstream/src/geometry.ts',
	'tools/figures/third_party/interfig/upstream/src/model.ts',
	'tools/figures/third_party/interfig/upstream/src/svg.ts',
	'tools/figures/third_party/interfig/vendor.json',
	'tools/figures/types.ts',
	'tools/markdownlint/markdownlint-cli2.yaml',
	'tools/markdownlint/no-private-scratch-links.mjs',
	'tools/markdownlint/package-lock.json',
	'tools/markdownlint/package.json',
	'tools/markdownlint/verify.mjs',
]);

/**
 * Lists tracked repository files matching optional git pathspecs.
 * @param {...string} globs
 * @returns {string[]}
 */
function tracked(...globs) {
	const args = globs.length > 0 ? ['ls-files', '-z', '--', ...globs] : ['ls-files', '-z'];
	const out = execFileSync('git', args, {
		cwd: root,
		encoding: 'utf8',
		timeout: IO_TIMEOUT_MS,
	});
	const files = out.split('\0').filter((file) => file !== '');
	assert.ok(files.length <= TRACKED_CAP, `git ls-files exceeded cap ${TRACKED_CAP}`);
	return files;
}

/**
 * Extracts non-comment, non-blank paths from the praetor-managed block in `.prettierignore`.
 * @param {string} ignoreText
 * @returns {string[]}
 */
function parseManagedBlock(ignoreText) {
	const lines = ignoreText.split(/\r?\n/);
	const beginIndex = lines.findIndex((line) => MANAGED_BEGIN.test(line));
	const endIndex = lines.findIndex((line) => MANAGED_END.test(line));
	assert.ok(beginIndex !== -1, 'missing # BEGIN praetor-managed artifacts marker');
	assert.ok(endIndex !== -1, 'missing # END praetor-managed artifacts marker');
	assert.ok(endIndex > beginIndex, '# END marker precedes # BEGIN marker');
	const trimmed = lines.slice(beginIndex + 1, endIndex).map((line) => line.trim());
	const paths = trimmed.filter((line) => line !== '' && !line.startsWith('#'));
	assert.ok(paths.length > 0, 'praetor-managed artifacts block is empty');
	return paths;
}

/**
 * Discovers every pinned artifact path grouped by its discovery class.
 * @returns {Record<string, string[]>}
 */
function discoverPinnedClasses() {
	const ignoreText = readFileSync(join(root, '.prettierignore'), 'utf8');
	const allTracked = tracked();
	const managed = parseManagedBlock(ignoreText);
	const recorded = [...RECORDED_MANAGED];
	const projection = allTracked.filter((file) =>
		PROJECTION_LINE.test(readFileSync(join(root, file), 'utf8')),
	);
	const archetype = allTracked.filter((file) => file.startsWith('.config/archetypes/'));
	const persona = allTracked.filter((file) => PERSONA_PATH.test(file));
	const rootStandards = allTracked.filter((file) => STANDARDS_ROOT_PATH.test(file));
	const standards = [...new Set([...rootStandards, '.standards-receipt.json'])].sort();
	return { managed, recorded, projection, archetype, persona, standards };
}

/**
 * Returns `class: path` entries for any discovered pinned file Prettier does not ignore.
 * @param {Record<string, string[]>} classes
 * @returns {Promise<string[]>}
 */
async function findUnignoredPinned(classes) {
	const unignored = [];
	const entries = Object.entries(classes);
	for (let i = 0; i < entries.length; i += 1) {
		const [name, paths] = entries[i];
		assert.ok(paths.length <= CLASS_CAP, `class ${name} exceeds scalar cap ${CLASS_CAP}`);
		for (let j = 0; j < paths.length; j += 1) {
			const relPath = paths[j];
			const info = await getFileInfo(join(root, relPath), { ignorePath: IGNORE_PATHS });
			if (info.ignored !== true) {
				unignored.push(`${name}: ${relPath}`);
			}
		}
	}
	return unignored;
}

describe('parseManagedBlock', () => {
	it('extracts paths between markers and skips comments and blank lines', () => {
		const sample = [
			'CLAUDE.md',
			'# BEGIN praetor-managed artifacts (praetorctl adopt)',
			'# canonical comment',
			'',
			'AGENTS.md',
			'lefthook.yml',
			'# END praetor-managed artifacts',
		].join('\n');
		assert.deepEqual(parseManagedBlock(sample), ['AGENTS.md', 'lefthook.yml']);
	});

	it('fails when markers are missing, reversed, or enclose an empty block', () => {
		const begin = '# BEGIN praetor-managed artifacts';
		const end = '# END praetor-managed artifacts';
		assert.throws(() => parseManagedBlock(`a.md\n${end}\n`), /missing # BEGIN/);
		assert.throws(() => parseManagedBlock(`${begin}\na.md\n`), /missing # END/);
		assert.throws(() => parseManagedBlock(`${end}\na.md\n${begin}\n`), /precedes # BEGIN/);
		assert.throws(() => parseManagedBlock(`${begin}\n# comment\n\n${end}\n`), /is empty/);
	});
});

describe('pinned artifact discovery', () => {
	it('discovers a non-empty, bounded set per class and excludes this test', () => {
		const classes = discoverPinnedClasses();
		const entries = Object.entries(classes);
		for (let i = 0; i < entries.length; i += 1) {
			const [name, paths] = entries[i];
			assert.ok(paths.length >= 1, `class ${name} matched 0 paths`);
			assert.ok(paths.length <= CLASS_CAP, `class ${name} exceeded cap ${CLASS_CAP}`);
		}
		const selfText = readFileSync(thisFile, 'utf8');
		assert.ok(!PROJECTION_LINE.test(selfText), `${selfPath} matched projection regex`);
		assert.ok(!classes.projection.includes(selfPath), `${selfPath} in projection class`);
	});

	it('keeps RECORDED_MANAGED unique and tracked in git', () => {
		const trackedSet = new Set(tracked());
		const missing = RECORDED_MANAGED.filter((file) => !trackedSet.has(file));
		assert.deepEqual(missing, [], `RECORDED_MANAGED untracked: ${missing.join(', ')}`);
		assert.equal(
			new Set(RECORDED_MANAGED).size,
			RECORDED_MANAGED.length,
			'RECORDED_MANAGED contains duplicate entries',
		);
	});
});

describe('prettier ignore coverage', () => {
	it('ignores every discovered pinned artifact', { timeout: IO_TIMEOUT_MS }, async () => {
		for (let i = 0; i < IGNORE_PATHS.length; i += 1) {
			assert.ok(existsSync(IGNORE_PATHS[i]), `missing ignore file: ${IGNORE_PATHS[i]}`);
		}
		const classes = discoverPinnedClasses();
		const unignored = await findUnignoredPinned(classes);
		assert.equal(
			unignored.length,
			0,
			`Prettier would format pinned artifacts:\n${unignored.join('\n')}`,
		);
	});

	it('keeps repository-owned files formatted', { timeout: IO_TIMEOUT_MS }, async () => {
		const ignored = [];
		for (let i = 0; i < REPO_FORMATTED_FILES.length; i += 1) {
			const relPath = REPO_FORMATTED_FILES[i];
			const absPath = join(root, relPath);
			assert.ok(existsSync(absPath), `expected formatted file missing: ${relPath}`);
			const info = await getFileInfo(absPath, { ignorePath: IGNORE_PATHS });
			if (info.ignored !== false) {
				ignored.push(relPath);
			}
		}
		assert.deepEqual(ignored, [], `Prettier unexpectedly ignores: ${ignored.join(', ')}`);
	});
});

describe('ci-affected on .prettierignore', () => {
	it('treats .prettierignore as a shared surface that runs the lint job', () => {
		const result = analyzeChanges(['.prettierignore']);
		assert.equal(result.hasCodeChanges, true);
		assert.equal(result.allAffected, true);
	});
});
