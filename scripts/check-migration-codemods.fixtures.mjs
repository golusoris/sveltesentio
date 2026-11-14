import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mock } from 'node:test';
import { runCheck } from './check-migration-codemods.mjs';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {number} count */
export const guide = (count) =>
	`---\nfrom-version: 0.8.x\nto-version: 0.9.0\ncodemods: ${count}\n---\n\n# v0.9\n`;

export const RENAME = "export default (s) => s.replaceAll('foo(', 'bar(');\n";
export const CODEMOD = 'tools/migrations/v0.9/rename-foo';

/** A guide declaring one codemod, and that codemod with one passing fixture pair. */
export const goodTree = () => ({
	'docs/migrations/v0.9.md': guide(1),
	[`${CODEMOD}/transform.mjs`]: RENAME,
	[`${CODEMOD}/fixtures/basic.input.ts`]: 'foo(1);\n',
	[`${CODEMOD}/fixtures/basic.output.ts`]: 'bar(1);\n',
});

/** @type {string[]} */
export const made = [];

/** Writes `files` ({ relative path: content }) into a new temporary root. */
export async function tree(/** @type {Record<string, string>} */ files) {
	const root = await mkdtemp(join(tmpdir(), 'migration-codemods-'));
	made.push(root);
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), content);
	}
	return root;
}

/** Runs the check on `files` and returns its findings. */
export async function findings(
	/** @type {Record<string, string>} */ files,
	timeoutMs = 5_000,
	/** @type {number | undefined} */ suiteTimeoutMs = undefined,
) {
	return (await runCheck({ root: await tree(files), timeoutMs, suiteTimeoutMs })).findings;
}

/** Asserts exactly one finding, on `file`, whose message matches `pattern`. */
export function assertOne(/** @type {{ file: string, message: string }[]} */ got, file, pattern) {
	assert.equal(got.length, 1, JSON.stringify(got, null, 2));
	assert.equal(got[0]?.file, file);
	assert.match(got[0]?.message ?? '', pattern);
}

export async function cleanup() {
	mock.restoreAll();
	for (const root of made.splice(0)) await rm(root, { recursive: true, force: true });
}
