import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findMissingTargets } from './check-export-targets.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** @param {string} dir @param {Record<string, string>} files */
async function writeTree(dir, files) {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content);
	}
}

const manifest = (/** @type {string} */ name, /** @type {unknown} */ exportsField) =>
	JSON.stringify({ name, exports: exportsField });

describe('check-export-targets', () => {
	/** @type {string} */
	let dir;

	before(async () => {
		dir = await mkdtemp(join(tmpdir(), 'export-targets-'));
	});
	after(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('names a target that does not exist, inside a conditions map', async () => {
		const packages = join(dir, 'missing');
		await writeTree(packages, {
			'demo/package.json': manifest('@fixture/demo', {
				'.': { types: './src/index.d.ts', default: './src/index.js' },
				'./extra': './src/extra.js',
			}),
			'demo/src/index.js': '',
			'demo/src/extra.js': '',
		});
		assert.deepEqual(await findMissingTargets(packages), [
			'@fixture/demo: export target "./src/index.d.ts" does not exist',
		]);
	});

	it('passes when every target exists', async () => {
		const packages = join(dir, 'complete');
		await writeTree(packages, {
			'demo/package.json': manifest('@fixture/demo', { '.': './src/index.js' }),
			'demo/src/index.js': '',
		});
		assert.deepEqual(await findMissingTargets(packages), []);
	});

	it('fails when bin string points at a .ts file', async () => {
		const packages = join(dir, 'bin-string-ts');
		await writeTree(packages, {
			'demo/package.json': JSON.stringify({
				name: '@fixture/bin-string-ts',
				bin: './src/cli.ts',
			}),
			'demo/src/cli.ts': '',
		});
		assert.deepEqual(await findMissingTargets(packages), [
			'@fixture/bin-string-ts: bin target "./src/cli.ts" does not end in .js/.mjs/.cjs (Node will not strip types under node_modules)',
		]);
	});

	it('fails when bin object points at a missing file', async () => {
		const packages = join(dir, 'bin-object-missing');
		await writeTree(packages, {
			'demo/package.json': JSON.stringify({
				name: '@fixture/bin-object-missing',
				bin: { tool: './src/missing.js' },
			}),
		});
		assert.deepEqual(await findMissingTargets(packages), [
			'@fixture/bin-object-missing: bin target "./src/missing.js" does not exist',
		]);
	});

	it('passes when bin points at an existing .js file', async () => {
		const packages = join(dir, 'bin-js');
		await writeTree(packages, {
			'demo/package.json': JSON.stringify({
				name: '@fixture/bin-js',
				bin: './src/cli.js',
			}),
			'demo/src/cli.js': '',
		});
		assert.deepEqual(await findMissingTargets(packages), []);
	});

	it('passes when package has no bin', async () => {
		const packages = join(dir, 'without-bin');
		await writeTree(packages, {
			'demo/package.json': JSON.stringify({
				name: '@fixture/without-bin',
				exports: { '.': './src/index.js' },
			}),
			'demo/src/index.js': '',
		});
		assert.deepEqual(await findMissingTargets(packages), []);
	});

	// Boundary: a package without an exports map, a bare specifier target and a
	// folder without a manifest publish no file path to check.
	it('skips what publishes no file path', async () => {
		const packages = join(dir, 'boundary');
		await writeTree(packages, {
			'plain/package.json': JSON.stringify({ name: '@fixture/plain' }),
			'bare/package.json': manifest('@fixture/bare', { '.': 'some-dependency' }),
			'loose/notes.txt': '',
		});
		assert.deepEqual(await findMissingTargets(packages), []);
	});

	it('finds no missing target in this repository', async () => {
		assert.deepEqual(await findMissingTargets(join(root, 'packages')), []);
	});
});
