import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { KIT_INSTALLS, kitPeerPackages, readKit, typeErrors } from './check-kit-compat.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ts = createRequire(join(root, 'package.json'))('typescript');

// The named import SvelteKit 2 accepts and SvelteKit 3 refuses: the defect the check exists for.
const NAMED_IMPORT = `import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => resolve(event);
`;

// The derived form. The last line proves the type is not `any`: under `any` the
// assignment would be accepted and the unused `@ts-expect-error` would be the error.
const DERIVED = `import type { sequence } from '@sveltejs/kit/hooks';

type Handle = Parameters<typeof sequence>[number];

export const handle: Handle = async ({ event, resolve }) => resolve(event);
// @ts-expect-error a handle is a function
export const wrong: Handle = 'not a handle';
`;

const TSCONFIG = {
	compilerOptions: {
		target: 'ES2022',
		module: 'ESNext',
		moduleResolution: 'bundler',
		strict: true,
		skipLibCheck: true,
		noEmit: true,
		verbatimModuleSyntax: true,
		types: [],
	},
	files: ['hook.ts'],
};

describe('check-kit-compat', () => {
	let tempRoot;
	let kit2;
	let kit3;

	async function project(name, source) {
		const dir = join(tempRoot, name);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'hook.ts'), source);
		await writeFile(join(dir, 'tsconfig.json'), JSON.stringify(TSCONFIG));
		return join(dir, 'tsconfig.json');
	}

	before(async () => {
		tempRoot = await mkdtemp(join(tmpdir(), 'kit-compat-test-'));
		[kit2, kit3] = await Promise.all(KIT_INSTALLS.map((install) => readKit(install)));
	});

	after(async () => {
		if (tempRoot) {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	describe('readKit', () => {
		it('reads the two installs as majors 2 and 3', () => {
			assert.match(kit2.version, /^2\./);
			assert.match(kit3.version, /^3\./);
			assert.notEqual(kit2.types, kit3.types);
		});

		it('refuses an install of another major', async () => {
			const dir = join(tempRoot, 'wrong-major');
			await mkdir(dir, { recursive: true });
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({ name: '@sveltejs/kit', version: '2.70.3' }),
			);
			await assert.rejects(readKit({ major: 3, dir }), /expected major 3/);
		});

		it('refuses a directory that holds another package', async () => {
			const dir = join(tempRoot, 'wrong-name');
			await mkdir(dir, { recursive: true });
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({ name: 'svelte', version: '3.0.0' }),
			);
			await assert.rejects(readKit({ major: 3, dir }), /expected @sveltejs\/kit/);
		});
	});

	describe('kitPeerPackages', () => {
		it('lists only the packages that declare the peer, sorted', async () => {
			const base = join(tempRoot, 'packages');
			const manifests = {
				zeta: { peerDependencies: { '@sveltejs/kit': '>=2.0.0' } },
				alpha: { peerDependencies: { '@sveltejs/kit': '>=2.0.0', svelte: '>=5.0.0' } },
				'dev-only': { devDependencies: { '@sveltejs/kit': '^2.70.3' } },
				'no-peers': {},
			};
			for (const [name, manifest] of Object.entries(manifests)) {
				await mkdir(join(base, name), { recursive: true });
				await writeFile(join(base, name, 'package.json'), JSON.stringify(manifest));
			}
			await mkdir(join(base, 'no-manifest'), { recursive: true });
			await writeFile(join(base, 'stray-file.txt'), '');

			assert.deepEqual(await kitPeerPackages(base), ['alpha', 'zeta']);
		});

		it('returns an empty list when no package declares the peer', async () => {
			const base = join(tempRoot, 'packages-empty');
			await mkdir(join(base, 'solo'), { recursive: true });
			await writeFile(join(base, 'solo', 'package.json'), JSON.stringify({ name: 'solo' }));

			assert.deepEqual(await kitPeerPackages(base), []);
		});
	});

	describe('typeErrors', () => {
		it('accepts the named Handle import under SvelteKit 2', async () => {
			const config = await project('named-kit2', NAMED_IMPORT);
			assert.deepEqual(typeErrors(ts, config, kit2.types), []);
		});

		it('refuses the named Handle import under SvelteKit 3', async () => {
			const config = await project('named-kit3', NAMED_IMPORT);
			const findings = typeErrors(ts, config, kit3.types);
			assert.ok(
				findings.some((finding) => finding.startsWith('TS2305') && finding.includes("'Handle'")),
				findings.join('\n'),
			);
		});

		it('accepts the derived Handle type under both majors', async () => {
			const config = await project('derived', DERIVED);
			assert.deepEqual(typeErrors(ts, config, kit2.types), []);
			assert.deepEqual(typeErrors(ts, config, kit3.types), []);
		});

		it('reports a second SvelteKit type bundle in the program', async () => {
			const source = `/// <reference path=${JSON.stringify(kit2.types)} />\n${DERIVED}`;
			const config = await project('two-bundles', source);
			const findings = typeErrors(ts, config, kit3.types);
			assert.ok(
				findings.some((finding) => finding.includes('a second @sveltejs/kit type bundle')),
				findings.join('\n'),
			);
		});

		it('reports a configuration file that does not exist', () => {
			const findings = typeErrors(ts, join(tempRoot, 'absent', 'tsconfig.json'), kit3.types);
			assert.equal(findings.length, 1);
		});
	});
});
