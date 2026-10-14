import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	findImportProblems,
	main,
	scanRecipes,
	specifierProblem,
} from './check-compose-imports.mjs';

const ownRecipes = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'docs', 'compose');

// The removed alias, assembled so this file does not name it where a reader
// of the source would take it for an import.
const REMOVED = '$' + 'lib';

const recipe = (...lines) => ['```ts', ...lines, '```', ''].join('\n');

describe('check-compose-imports', () => {
	let tempRoot;

	before(async () => {
		tempRoot = await mkdtemp(join(tmpdir(), 'cci-test-'));
	});

	after(async () => {
		if (tempRoot) {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	const recipeDir = async (name, files) => {
		const dir = join(tempRoot, name);
		await mkdir(dir, { recursive: true });
		for (const [file, source] of Object.entries(files)) await writeFile(join(dir, file), source);
		return dir;
	};

	describe('specifierProblem', () => {
		it('accepts a .js file, a directory index, a component, a rune module and the bare name', () => {
			for (const specifier of [
				'#lib/api/client.js',
				'#lib/components/ui/button/index.js',
				'#lib/Widget.svelte',
				'#lib/state/projects.svelte.js',
				'#lib',
			]) {
				assert.equal(specifierProblem(specifier), null, specifier);
			}
		});

		it('accepts asset files, a query suffix and a generated-path placeholder', () => {
			for (const specifier of [
				'#lib/docs/intro.md',
				'#lib/assets/logo.svg?url',
				'#lib/data.json',
				'#lib/gen/...',
			]) {
				assert.equal(specifierProblem(specifier), null, specifier);
			}
		});

		it('refuses a specifier without an extension and one ending in .ts', () => {
			assert.match(specifierProblem('#lib/api/client'), /no file extension/);
			assert.match(specifierProblem('#lib/components/ui/button'), /no file extension/);
			assert.match(specifierProblem('#lib/api/client.ts'), /ends in \.ts/);
		});

		it('refuses a trailing slash and a lone #lib/', () => {
			assert.match(specifierProblem('#lib/api/'), /no file extension/);
			assert.match(specifierProblem('#lib/'), /no file extension/);
		});
	});

	describe('findImportProblems', () => {
		it('accepts static, side-effect, dynamic and mocked imports through #lib', () => {
			const source = recipe(
				"import { client } from '#lib/api/client.js';",
				"import '#lib/styles/app.css';",
				"const mod = await import('#lib/server/db.js');",
				"vi.mock('#lib/auth/session.js');",
				'const docs = import(`#lib/docs/${slug}.md`);',
			);
			assert.deepEqual(findImportProblems(source), []);
		});

		it('refuses the removed alias in an import and in prose', () => {
			const source = [
				`import { client } from '${REMOVED}/api/client';`,
				`Put the helper in \`${REMOVED}/server/\`.`,
			].join('\n');
			const findings = findImportProblems(source);
			assert.deepEqual(
				findings.map(({ line, problem }) => [line, problem]),
				[
					[1, 'names the alias SvelteKit 3 removed; use #lib'],
					[2, 'names the alias SvelteKit 3 removed; use #lib'],
				],
			);
		});

		it('refuses an extensionless #lib import and names its line', () => {
			const source = recipe(
				"import { ok } from '#lib/api/client.js';",
				"import { db } from '#lib/server/db';",
			);
			assert.deepEqual(
				findImportProblems(source).map(({ line, problem }) => [line, problem]),
				[[3, '#lib/server/db has no file extension; add .js, or /index.js for a directory']],
			);
		});

		it('leaves a #lib value outside an import context and a longer name alone', () => {
			const source = [
				'{ "aliases": { "components": "#lib/components", "ui": "#lib/ui" } }',
				'const $library = 1;',
				'const total = $lib_count;',
			].join('\n');
			assert.deepEqual(findImportProblems(source), []);
		});
	});

	describe('scanRecipes', () => {
		it('reads only the Markdown files, sorted', async () => {
			const dir = await recipeDir('mixed', {
				'b.md': recipe("import x from '#lib/x.js';"),
				'a.md': recipe("import y from '#lib/y';"),
				'notes.txt': `import z from '${REMOVED}/z';`,
			});
			const { files, findings } = await scanRecipes(dir);
			assert.deepEqual(files, ['a.md', 'b.md']);
			assert.deepEqual(
				findings.map(({ file, line }) => [file, line]),
				[['a.md', 2]],
			);
		});

		it('rejects a directory that does not exist', async () => {
			await assert.rejects(scanRecipes(join(tempRoot, 'missing')), { code: 'ENOENT' });
		});
	});

	describe('main', () => {
		it('returns 0 when every recipe imports through #lib', async () => {
			const dir = await recipeDir('clean', { 'a.md': recipe("import x from '#lib/x.js';") });
			assert.equal(await main(dir), 0);
		});

		it('returns 1 when one recipe imports through the removed alias', async () => {
			const dir = await recipeDir('removed', {
				'a.md': recipe("import x from '#lib/x.js';"),
				'b.md': recipe(`import y from '${REMOVED}/y';`),
			});
			assert.equal(await main(dir), 1);
		});

		it('returns 1 when there is no recipe to read', async () => {
			const dir = await recipeDir('empty', {});
			assert.equal(await main(dir), 1);
		});
	});

	it('finds no import problem in the recipes of this repository', async () => {
		const { files, findings } = await scanRecipes(ownRecipes);
		assert.ok(files.length > 0);
		assert.deepEqual(findings, []);
	});
});
