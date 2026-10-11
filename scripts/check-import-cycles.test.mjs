import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { buildGraphs, findCycle, resolveRelative, walk } from './check-import-cycles.mjs';

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

	describe('resolveRelative', () => {
		it('resolves exact file path and rewrites .js to .ts or .svelte.ts', async () => {
			const dir = join(tempRoot, 'resolve');
			await mkdir(dir, { recursive: true });
			const fromFile = join(dir, 'source.ts');
			await writeFile(fromFile, '');

			const exactSvelte = join(dir, 'Comp.svelte');
			await writeFile(exactSvelte, '');
			const r1 = await resolveRelative(fromFile, './Comp.svelte');
			assert.equal(r1, exactSvelte);

			const tsTarget = join(dir, 'helper.ts');
			await writeFile(tsTarget, '');
			const r2 = await resolveRelative(fromFile, './helper.js');
			assert.equal(r2, tsTarget);

			const svelteTsTarget = join(dir, 'state.svelte.ts');
			await writeFile(svelteTsTarget, '');
			const r3 = await resolveRelative(fromFile, './state.js');
			assert.equal(r3, svelteTsTarget);
		});

		it('resolves extensionless path and directory import with index.ts', async () => {
			const dir = join(tempRoot, 'resolve-more');
			await mkdir(join(dir, 'sub'), { recursive: true });
			const fromFile = join(dir, 'entry.ts');
			await writeFile(fromFile, '');

			const utilTarget = join(dir, 'util.ts');
			await writeFile(utilTarget, '');
			const r1 = await resolveRelative(fromFile, './util');
			assert.equal(r1, utilTarget);

			const indexTarget = join(dir, 'sub', 'index.ts');
			await writeFile(indexTarget, '');
			const r2 = await resolveRelative(fromFile, './sub');
			assert.equal(r2, indexTarget);
		});

		it('returns undefined for unresolvable relative import', async () => {
			const dir = join(tempRoot, 'resolve-missing');
			await mkdir(dir, { recursive: true });
			const fromFile = join(dir, 'a.ts');
			await writeFile(fromFile, '');
			const res = await resolveRelative(fromFile, './does-not-exist');
			assert.equal(res, undefined);
		});

		it('propagates unexpected filesystem errors (non-ENOENT)', async () => {
			const dir = join(tempRoot, 'resolve-eacces');
			await mkdir(dir, { recursive: true });
			const restricted = join(dir, 'restricted');
			await mkdir(restricted, { recursive: true });
			const fromFile = join(dir, 'source.ts');
			await writeFile(fromFile, '');
			await chmod(restricted, 0o000);

			try {
				await assert.rejects(
					async () => {
						await resolveRelative(fromFile, './restricted/target.js');
					},
					(err) => err && (err.code === 'EACCES' || err.code === 'EPERM'),
				);
			} finally {
				await chmod(restricted, 0o755);
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

		it('reads Set-valued graphs, the shape buildGraphs produces', () => {
			const cyclic = new Map([
				['a', new Set(['b'])],
				['b', new Set(['a'])],
			]);
			assert.deepEqual(findCycle(cyclic), ['a', 'b', 'a']);
		});

		it('stays inside its step bound on a dense acyclic Set-valued graph', () => {
			// 300 nodes, every node points at all later ones: 44850 edges against 300 nodes.
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

	describe('buildGraphs', () => {
		const write = async (base, files) => {
			for (const [name, source] of Object.entries(files)) {
				const file = join(base, name);
				await mkdir(join(file, '..'), { recursive: true });
				await writeFile(file, source);
			}
		};

		it('reports no cycle for an acyclic tree', async () => {
			const base = join(tempRoot, 'graphs-clean');
			await write(base, {
				'a/src/index.ts': "export { x } from './x.js';\nimport { b } from '@sveltesentio/b';\n",
				'a/src/x.ts': 'export const x = 1;\n',
				'b/src/index.ts': 'export const b = 2;\n',
			});
			const { packages, fileGraph, packageGraph } = await buildGraphs(base);
			assert.deepEqual(packages.sort(), ['a', 'b']);
			assert.equal(fileGraph.size, 3);
			assert.equal(findCycle(fileGraph), undefined);
			assert.equal(findCycle(packageGraph), undefined);
		});

		it('finds a planted module cycle, including one closed by a dynamic import', async () => {
			const base = join(tempRoot, 'graphs-module-cycle');
			await write(base, {
				'a/src/index.ts': "import { x } from './x.js';\n",
				'a/src/x.ts': "export const x = () => import('./index.js');\n",
			});
			const { fileGraph } = await buildGraphs(base);
			// Directory order decides which module the search enters first.
			const cycle = findCycle(fileGraph);
			assert.equal(cycle?.length, 3);
			assert.equal(cycle?.[0], cycle?.[2]);
			assert.deepEqual([...new Set(cycle)].sort(), [
				join(base, 'a/src/index.ts'),
				join(base, 'a/src/x.ts'),
			]);
		});

		it('finds a planted package cycle and ignores a type-only edge', async () => {
			const base = join(tempRoot, 'graphs-package-cycle');
			await write(base, {
				'a/src/index.ts': "import { b } from '@sveltesentio/b/sub';\n",
				'b/src/index.ts': "import { a } from '@sveltesentio/a';\n",
				'c/src/index.ts': "import { d } from '@sveltesentio/d';\n",
				'd/src/index.ts': "import type { C } from '@sveltesentio/c';\n",
			});
			const { packageGraph } = await buildGraphs(base);
			const cycle = findCycle(packageGraph);
			assert.equal(cycle?.length, 3);
			assert.deepEqual([...new Set(cycle)].sort(), ['@sveltesentio/a', '@sveltesentio/b']);
			assert.deepEqual([...packageGraph.get('@sveltesentio/d')], []);
		});
	});
});
