import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
	checkDeclaredImports,
	internalRangeViolations,
	rangeProblem,
} from './check-declared-imports.mjs';

async function put(path, content) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content));
}

describe('check-declared-imports', () => {
	let tempRoot;

	before(async () => {
		tempRoot = await mkdtemp(join(tmpdir(), 'cdi-test-'));
		for (const lib of ['run-lib', 'peer-lib', 'dev-lib']) {
			await put(join(tempRoot, 'node_modules', lib, 'package.json'), {
				name: lib,
				version: '1.0.0',
				main: 'index.js',
			});
			await put(join(tempRoot, 'node_modules', lib, 'index.js'), 'export const x = 1;\n');
		}
	});

	after(async () => {
		if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
	});

	/** Writes one package `p` with `manifest` fields and `files` under src. */
	async function fixture(name, manifest, files) {
		const pkgDir = join(tempRoot, name, 'packages');
		await put(join(pkgDir, 'p', 'package.json'), {
			name: '@sveltesentio/p',
			version: '0.5.0',
			...manifest,
		});
		for (const [file, source] of Object.entries(files)) {
			await put(join(pkgDir, 'p', 'src', file), source);
		}
		return pkgDir;
	}

	const DECLARED_MANIFEST = {
		dependencies: { 'run-lib': '^1.0.0' },
		devDependencies: { 'dev-lib': '^1.0.0', 'peer-lib': '^1.0.0' },
		peerDependencies: { 'peer-lib': '>=1.0.0' },
		peerDependenciesMeta: { 'peer-lib': { optional: true } },
	};

	it('accepts declared, optional-peer, builtin, relative and story-only dev imports', async () => {
		const pkgDir = await fixture('clean', DECLARED_MANIFEST, {
			'index.ts': [
				"import { x } from 'run-lib';",
				"import { x as y } from 'peer-lib';",
				"import { join } from 'node:path';",
				"import { z } from './z.js';",
				'export const all = [x, y, join, z];',
				'',
			].join('\n'),
			'z.ts': 'export const z = 1;\n',
			'A.stories.svelte': "<script>\n\timport { x } from 'dev-lib';\n</script>\n{x}\n",
		});
		const res = await checkDeclaredImports(pkgDir);
		assert.equal(res.analysedCount, 3);
		assert.deepEqual(res.importViolations, []);
		assert.deepEqual(res.rangeViolations, []);
	});

	it('refuses an import its manifest does not declare', async () => {
		const pkgDir = await fixture(
			'undeclared',
			{},
			{
				'index.ts': "export { x } from 'run-lib';\n",
			},
		);
		const res = await checkDeclaredImports(pkgDir);
		assert.equal(res.importViolations.length, 1);
		assert.match(res.importViolations[0], /^undeclared: .*index\.ts -> run-lib$/);
	});

	it('refuses a type-only import its manifest does not declare', async () => {
		const pkgDir = await fixture(
			'type-only',
			{},
			{
				'index.ts': "import type { x } from 'run-lib';\nexport type X = typeof x;\n",
			},
		);
		const res = await checkDeclaredImports(pkgDir);
		assert.equal(res.importViolations.length, 1);
		assert.match(res.importViolations[0], /^undeclared: .* -> run-lib$/);
	});

	it('refuses a devDependency imported outside a story', async () => {
		const pkgDir = await fixture('dev-only', DECLARED_MANIFEST, {
			'index.ts': "export { x } from 'dev-lib';\n",
		});
		const res = await checkDeclaredImports(pkgDir);
		assert.equal(res.importViolations.length, 1);
		assert.match(res.importViolations[0], /^dev-only: .* -> dev-lib$/);
	});

	it('refuses an import that resolves to nothing, but not a Vite virtual module', async () => {
		const pkgDir = await fixture('unresolvable', DECLARED_MANIFEST, {
			'index.ts': [
				"export { x } from 'not-installed';",
				"export const load = () => import('virtual:pwa-register');",
				'',
			].join('\n'),
		});
		const res = await checkDeclaredImports(pkgDir);
		assert.equal(res.importViolations.length, 1);
		assert.match(res.importViolations[0], /^unresolvable: .* -> not-installed$/);
	});

	it('fails closed when no source file exists', async () => {
		const pkgDir = await fixture('empty', {}, {});
		await assert.rejects(checkDeclaredImports(pkgDir), /Zero source files/);
	});

	describe('internal ranges', () => {
		it('admits the workspace protocol aliases and ranges holding the version', () => {
			for (const range of ['workspace:*', 'workspace:^', 'workspace:~', 'workspace:^0.5.0']) {
				assert.equal(rangeProblem(range, '0.5.0'), undefined, range);
			}
			assert.equal(rangeProblem('>=0.4.0 <1', '0.5.0'), undefined);
			assert.equal(rangeProblem('0.5.0', '0.5.0'), undefined);
		});

		it('refuses a range that excludes the workspace version', () => {
			assert.match(rangeProblem('^0.4.0', '0.5.0'), /excludes workspace version 0\.5\.0/);
			assert.match(rangeProblem('workspace:0.4.0', '0.5.0'), /excludes/);
		});

		it('refuses a range that is not semver', () => {
			assert.match(rangeProblem('workspace:latest', '0.5.0'), /not a semver range/);
		});

		it('names the manifest, field and package of each bad entry', () => {
			const manifests = [
				{ name: '@sveltesentio/core', version: '0.5.0' },
				{
					name: '@sveltesentio/forms',
					version: '0.6.0',
					devDependencies: { '@sveltesentio/core': 'workspace:*', zod: '^4.0.0' },
					peerDependencies: { '@sveltesentio/core': '^0.4.0', '@sveltesentio/gone': '*' },
				},
			];
			assert.deepEqual(internalRangeViolations(manifests), [
				'@sveltesentio/forms peerDependencies @sveltesentio/core: "^0.4.0" excludes workspace version 0.5.0',
				'@sveltesentio/forms peerDependencies @sveltesentio/gone: names no workspace package',
			]);
		});

		it('reads the ranges of the cruised packages', async () => {
			const pkgDir = await fixture(
				'range',
				{ peerDependencies: { '@sveltesentio/p': '^0.4.0' } },
				{ 'index.ts': 'export const a = 1;\n' },
			);
			const res = await checkDeclaredImports(pkgDir);
			assert.deepEqual(res.rangeViolations, [
				'@sveltesentio/p peerDependencies @sveltesentio/p: "^0.4.0" excludes workspace version 0.5.0',
			]);
		});
	});
});
