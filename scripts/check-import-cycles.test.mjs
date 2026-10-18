import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { checkImportCycles, findCycle, packageSpecifiersOf, walk } from './check-import-cycles.mjs';

describe('check-import-cycles', () => {
	let tempRoot;

	before(async () => {
		tempRoot = await mkdtemp(join(tmpdir(), 'cic-test-'));
	});

	after(async () => {
		if (tempRoot) {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	describe('walk', () => {
		it('finds nested source files with recognized extensions', async () => {
			const base = join(tempRoot, 'nested');
			await mkdir(join(base, 'sub', 'deep'), { recursive: true });
			const fileA = join(base, 'a.ts');
			const fileB = join(base, 'sub', 'b.svelte.ts');
			const fileC = join(base, 'sub', 'deep', 'c.svelte');
			await writeFile(fileA, '');
			await writeFile(fileB, '');
			await writeFile(fileC, '');

			const found = await walk(base);
			assert.equal(found.length, 3);
			assert.ok(found.includes(fileA));
			assert.ok(found.includes(fileB));
			assert.ok(found.includes(fileC));
		});

		it('skips non-source files', async () => {
			const base = join(tempRoot, 'skip-files');
			await mkdir(base, { recursive: true });
			await writeFile(join(base, 'readme.md'), '# test');
			await writeFile(join(base, 'package.json'), '{}');
			await writeFile(join(base, 'bundle.js'), 'console.log(1)');
			const valid = join(base, 'index.ts');
			await writeFile(valid, '');

			const found = await walk(base);
			assert.deepEqual(found, [valid]);
		});

		it('returns empty array for an empty directory', async () => {
			const emptyDir = join(tempRoot, 'empty');
			await mkdir(emptyDir, { recursive: true });
			const found = await walk(emptyDir);
			assert.deepEqual(found, []);
		});

		it('returns empty array for a missing directory', async () => {
			const missing = join(tempRoot, 'nonexistent');
			const found = await walk(missing);
			assert.deepEqual(found, []);
		});

		it('walks breadth and depth 5 structure', async () => {
			const base = join(tempRoot, 'breadth-depth');
			await mkdir(base, { recursive: true });
			const created = [];
			for (let b = 0; b < 5; b++) {
				let cur = join(base, `branch_${b}`);
				for (let d = 0; d < 5; d++) {
					cur = join(cur, `depth_${d}`);
					await mkdir(cur, { recursive: true });
					const f = join(cur, `f_${b}_${d}.ts`);
					await writeFile(f, '');
					created.push(f);
				}
			}
			const found = await walk(base);
			assert.equal(found.length, 25);
			for (let i = 0; i < created.length; i++) {
				assert.ok(found.includes(created[i]));
			}
		});
	});

	describe('findCycle', () => {
		it('returns undefined when there are no cycles', () => {
			const graph = new Map([
				['a', ['b']],
				['b', []],
			]);
			assert.equal(findCycle(graph), undefined);
		});

		it('finds a self-loop cycle', () => {
			const graph = new Map([['a', ['a']]]);
			assert.deepEqual(findCycle(graph), ['a', 'a']);
		});

		it('finds a 2-node cycle', () => {
			const graph = new Map([
				['a', ['b']],
				['b', ['a']],
			]);
			assert.deepEqual(findCycle(graph), ['a', 'b', 'a']);
		});

		it('finds a 3-node cycle with exact node order', () => {
			const graph = new Map([
				['a', ['b']],
				['b', ['c']],
				['c', ['a']],
			]);
			assert.deepEqual(findCycle(graph), ['a', 'b', 'c', 'a']);
		});

		it('returns undefined for diamond DAG without cycles', () => {
			const graph = new Map([
				['a', ['b', 'c']],
				['b', ['d']],
				['c', ['d']],
				['d', []],
			]);
			assert.equal(findCycle(graph), undefined);
		});

		it('handles nodes referenced but absent from graph keys', () => {
			const graph = new Map([['a', ['missing']]]);
			assert.equal(findCycle(graph), undefined);
		});

		it('reads Set-valued graphs, the shape checkImportCycles builds', () => {
			const cyclic = new Map([
				['a', new Set(['b'])],
				['b', new Set(['a'])],
			]);
			assert.deepEqual(findCycle(cyclic), ['a', 'b', 'a']);
		});

		it('stays inside its step bound on a dense acyclic Set-valued graph', () => {
			const dense = new Map();
			for (let i = 0; i < 300; i += 1) {
				const targets = new Set();
				for (let j = i + 1; j < 300; j += 1) targets.add(String(j));
				dense.set(String(i), targets);
			}
			assert.equal(findCycle(dense), undefined);
		});

		it('handles 50000-node chain without stack overflow', () => {
			const chain = new Map();
			for (let i = 0; i < 50000; i++) {
				chain.set(String(i), i + 1 < 50000 ? [String(i + 1)] : []);
			}
			assert.equal(findCycle(chain), undefined);
		});
	});

	describe('packageSpecifiersOf', () => {
		it('extracts static, bare and dynamic @sveltesentio imports, ignoring type imports', () => {
			const src = `
				import { a } from '@sveltesentio/a';
				import '@sveltesentio/b';
				export const dyn = () => import('@sveltesentio/c');
				import type { D } from '@sveltesentio/d';
				import { local } from './local.js';
			`;
			const specs = packageSpecifiersOf(src);
			assert.ok(specs.includes('@sveltesentio/a'));
			assert.ok(specs.includes('@sveltesentio/b'));
			assert.ok(specs.includes('@sveltesentio/c'));
			assert.ok(!specs.includes('@sveltesentio/d'));
			assert.ok(!specs.includes('./local.js'));
		});
	});

	describe('checkImportCycles', () => {
		const write = async (base, files) => {
			for (const [name, source] of Object.entries(files)) {
				const file = join(base, name);
				await mkdir(join(file, '..'), { recursive: true });
				await writeFile(file, source);
			}
		};

		it('reports no cycle for a clean tree', async () => {
			const base = join(tempRoot, 'graphs-clean');
			await write(base, {
				'a/src/index.ts': "export { x } from './x.js';\nimport { b } from '@sveltesentio/b';\n",
				'a/src/x.ts': 'export const x = 1;\n',
				'b/src/index.ts': 'export const b = 2;\n',
			});
			const res = await checkImportCycles(base);
			assert.deepEqual(res.packages.sort(), ['a', 'b']);
			assert.equal(res.analysedCount, 3);
			assert.equal(res.moduleCycles.length, 0);
			assert.equal(res.packageCycle, undefined);
		});

		it('shape 1: finds a two-module static cycle', async () => {
			const base = join(tempRoot, 'shape-1-static');
			await write(base, {
				'core/src/a.ts': "import './b.js';\nexport const a = 1;\n",
				'core/src/b.ts': "import './a.js';\nexport const b = 2;\n",
			});
			const res = await checkImportCycles(base);
			assert.equal(res.moduleCycles.length, 1);
			const cycle = res.moduleCycles[0];
			assert.equal(cycle.length, 3);
			assert.equal(cycle[0], cycle[2]);
			assert.deepEqual([...new Set(cycle)].sort(), [
				resolve(join(base, 'core/src/a.ts')),
				resolve(join(base, 'core/src/b.ts')),
			]);
		});

		it('shape 2: finds a dynamic import cycle', async () => {
			const base = join(tempRoot, 'shape-2-dynamic');
			await write(base, {
				'core/src/a.ts': "import './b.js';\nexport const a = 1;\n",
				'core/src/b.ts': "export const f = async () => import('./a.js');\n",
			});
			const res = await checkImportCycles(base);
			assert.equal(res.moduleCycles.length, 1);
			const cycle = res.moduleCycles[0];
			assert.equal(cycle.length, 3);
			assert.equal(cycle[0], cycle[2]);
			assert.deepEqual([...new Set(cycle)].sort(), [
				resolve(join(base, 'core/src/a.ts')),
				resolve(join(base, 'core/src/b.ts')),
			]);
		});

		it('shape 3: finds a core -> ui -> core package cycle', async () => {
			const base = join(tempRoot, 'shape-3-pkg-cycle');
			await write(base, {
				'core/src/index.ts': "import { ui } from '@sveltesentio/ui';\nexport const c = 1;\n",
				'ui/src/index.ts': "import { c } from '@sveltesentio/core';\nexport const ui = 2;\n",
			});
			const res = await checkImportCycles(base);
			assert.equal(res.moduleCycles.length, 0);
			assert.deepEqual(res.packageCycle, [
				'@sveltesentio/core',
				'@sveltesentio/ui',
				'@sveltesentio/core',
			]);
		});

		it('shape 4: finds a .svelte component cycle (A.svelte -> B.svelte -> A.svelte)', async () => {
			const base = join(tempRoot, 'shape-4-svelte-cycle');
			await write(base, {
				'ui/src/A.svelte':
					'<script lang="ts">\nimport B from "./B.svelte";\n</script>\n<div>A</div>\n',
				'ui/src/B.svelte':
					'<script lang="ts">\nimport A from "./A.svelte";\n</script>\n<div>B</div>\n',
			});
			const res = await checkImportCycles(base);
			assert.equal(res.moduleCycles.length, 1);
			const cycle = res.moduleCycles[0];
			assert.equal(cycle.length, 3);
			assert.equal(cycle[0], cycle[2]);
			assert.deepEqual([...new Set(cycle)].sort(), [
				resolve(join(base, 'ui/src/A.svelte')),
				resolve(join(base, 'ui/src/B.svelte')),
			]);
		});

		it('type-only import is not a cycle', async () => {
			const base = join(tempRoot, 'type-only-no-cycle');
			await write(base, {
				'core/src/a.ts': "import type { B } from './b.js';\nexport type A = string;\n",
				'core/src/b.ts': "import type { A } from './a.js';\nexport type B = number;\n",
				'ui/src/index.ts': "import type { A } from '@sveltesentio/core';\nexport type UI = A;\n",
			});
			const res = await checkImportCycles(base);
			assert.equal(res.moduleCycles.length, 0);
			assert.equal(res.packageCycle, undefined);
			assert.deepEqual([...res.packageGraph.get('@sveltesentio/ui')], []);
		});

		it('empty / zero-module tree fails closed', async () => {
			const emptyBase = join(tempRoot, 'empty-tree');
			await mkdir(emptyBase, { recursive: true });
			await assert.rejects(
				async () => {
					await checkImportCycles(emptyBase);
				},
				(err) => err && /failing closed/i.test(err.message),
			);
		});
	});
});
