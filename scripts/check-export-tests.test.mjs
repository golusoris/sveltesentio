import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findUntestedExports } from './check-export-tests.mjs';

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

describe('check-export-tests', () => {
	/** @type {string} */
	let dir;

	before(async () => {
		dir = await mkdtemp(join(tmpdir(), 'export-tests-'));
	});
	after(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('names an exported value no test names, through export * and a sub-export', async () => {
		const packages = join(dir, 'missing');
		await writeTree(packages, {
			'demo/package.json': manifest('@fixture/demo', {
				'.': { types: './src/index.ts', import: './src/index.ts' },
				'./extra': './src/extra.ts',
			}),
			'demo/src/index.ts': "export * from './inner.js';\nexport const tested = 1;\n",
			'demo/src/inner.ts': 'export function untestedInner(): number {\n\treturn 2;\n}\n',
			'demo/src/extra.ts': 'export class UntestedExtra {}\n',
			'demo/test/index.test.ts': "import { tested } from '../src/index.js';\nvoid tested;\n",
		});
		const result = await findUntestedExports(packages);
		assert.equal(result.checked, 3);
		assert.deepEqual(result.failures.sort(), [
			'@fixture/demo: UntestedExtra (exported from src/extra.ts) is named in no test file',
			'@fixture/demo: untestedInner (exported from src/index.ts) is named in no test file',
		]);
	});

	it('passes when a test, a spec or an e2e file names every value', async () => {
		const packages = join(dir, 'complete');
		await writeTree(packages, {
			'demo/package.json': manifest('@fixture/demo', { '.': './src/index.ts' }),
			'demo/src/index.ts':
				"export { first as renamed } from './first.js';\nexport const second = 2;\nexport enum Third { A }\n",
			'demo/src/first.ts': 'export const first = 1;\n',
			'demo/src/a.spec.ts': 'renamed;\n',
			'demo/e2e/flow.ts': 'second;\n',
			'demo/test/third.ts': 'Third;\n',
		});
		assert.deepEqual(await findUntestedExports(packages), { checked: 3, failures: [] });
	});

	// Boundary: type-only exports and default exports are not values a test
	// must name; a longer word that contains the name and a mention outside the
	// test folders do not count; a package without exports is skipped.
	it('counts values only, and whole words in test files only', async () => {
		const packages = join(dir, 'boundary');
		await writeTree(packages, {
			'demo/package.json': manifest('@fixture/demo', { '.': './src/index.ts' }),
			'demo/src/index.ts': [
				'export interface Shape { a: number }',
				'export type Alias = string;',
				"export type { Other } from './other.js';",
				'export const value = 1;',
				'export const $named = 2;',
				'export default 3;',
				'',
			].join('\n'),
			'demo/src/other.ts': 'export interface Other { b: number }\n',
			'demo/src/uses-value.ts': 'value;\n',
			'demo/test/index.test.ts': 'valueLike; $value; value_x; $named;\n',
			'plain/package.json': JSON.stringify({ name: '@fixture/plain' }),
			'loose/notes.txt': '',
		});
		assert.deepEqual(await findUntestedExports(packages), {
			checked: 2,
			failures: ['@fixture/demo: value (exported from src/index.ts) is named in no test file'],
		});
	});

	it('finds no untested exported value in this repository', async () => {
		const result = await findUntestedExports(join(root, 'packages'));
		assert.deepEqual(result.failures, []);
		assert.ok(result.checked > 400, `checked only ${result.checked} exported values`);
	});
});
