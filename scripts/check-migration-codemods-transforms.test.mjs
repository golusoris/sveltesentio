// Transform failures, idempotence and deadlines for check-migration-codemods.mjs.
// Discovery, counts, fixtures, layout and limits: check-migration-codemods.test.mjs.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';
import { runCheck } from './check-migration-codemods.mjs';
import {
	CODEMOD,
	assertOne,
	cleanup,
	findings,
	goodTree,
	guide,
	repoRoot,
	tree,
} from './check-migration-codemods.fixtures.mjs';

const execFileAsync = promisify(execFile);
const SLOW_STEP_MS = 2_000;

afterEach(cleanup);

describe('runCheck', () => {
	it('reports a transform that throws', async () => {
		const files = {
			...goodTree(),
			[`${CODEMOD}/transform.mjs`]: "export default () => { throw new Error('boom'); };\n",
		};
		assertOne(await findings(files), `${CODEMOD}/fixtures/basic.input.ts`, /codemod failed: boom/);
	});

	it('reports a transform that returns something other than a string', async () => {
		const files = { ...goodTree(), [`${CODEMOD}/transform.mjs`]: 'export default () => 42;\n' };
		assertOne(
			await findings(files),
			`${CODEMOD}/fixtures/basic.input.ts`,
			/must return a string, got number/,
		);
	});

	it('reports the type of a result that cannot be cloned across workers', async () => {
		const files = {
			...goodTree(),
			[`${CODEMOD}/transform.mjs`]: 'export default () => () => {};\n',
		};
		assertOne(
			await findings(files),
			`${CODEMOD}/fixtures/basic.input.ts`,
			/must return a string, got function/,
		);
	});

	it('reports a transform that is not idempotent', async () => {
		const files = {
			...goodTree(),
			[`${CODEMOD}/transform.mjs`]:
				"export default (s) => s.endsWith('// migrated\\n') ? s + '!' : s + '// migrated\\n';\n",
			[`${CODEMOD}/fixtures/basic.output.ts`]: 'foo(1);\n// migrated\n',
		};
		assertOne(await findings(files), `${CODEMOD}/fixtures/basic.output.ts`, /not idempotent/);
	});

	it('reports a transform that hides non-idempotence behind the output fixture path', async () => {
		const files = {
			...goodTree(),
			[`${CODEMOD}/transform.mjs`]:
				"export default (s, p) => p.endsWith('.output.ts') ? s : s + '// migrated\\n';\n",
			[`${CODEMOD}/fixtures/basic.output.ts`]: 'foo(1);\n// migrated\n',
		};
		assertOne(await findings(files), `${CODEMOD}/fixtures/basic.output.ts`, /not idempotent/);
	});

	it('reports non-idempotence hidden by module state from the first call', async () => {
		const files = {
			...goodTree(),
			[`${CODEMOD}/transform.mjs`]:
				"let first = true;\nexport default (s) => { if (!first) return s; first = false; return s + '// migrated\\n'; };\n",
			[`${CODEMOD}/fixtures/basic.output.ts`]: 'foo(1);\n// migrated\n',
		};
		assertOne(await findings(files), `${CODEMOD}/fixtures/basic.output.ts`, /not idempotent/);
	});

	it('reports a transform that never settles once the deadline passes', async () => {
		const files = {
			...goodTree(),
			[`${CODEMOD}/transform.mjs`]: 'export default () => new Promise(() => {});\n',
		};
		assertOne(
			// Load (Worker start + import) shares deadline; 300 ms failed on macOS run 43442486492.
			await findings(files, SLOW_STEP_MS),
			`${CODEMOD}/fixtures/basic.input.ts`,
			new RegExp(`timed out after ${SLOW_STEP_MS}ms`),
		);
	});

	it(
		'rejects a synchronous call over its deadline and accepts it under the deadline',
		{ timeout: 30_000 },
		async () => {
			const files = {
				...goodTree(),
				[`${CODEMOD}/transform.mjs`]:
					'export default (s) => { ' +
					'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3_000); ' +
					"return s.replaceAll('foo(', 'bar('); };\n",
			};
			assertOne(
				await findings(files, SLOW_STEP_MS),
				`${CODEMOD}/fixtures/basic.input.ts`,
				new RegExp(`timed out after ${SLOW_STEP_MS}ms`),
			);
			assert.deepEqual(await findings(files, 10_000), []);
		},
	);

	it('terminates a worker with a timer left running', { timeout: 20_000 }, async () => {
		const files = {
			...goodTree(),
			[`${CODEMOD}/transform.mjs`]:
				"setInterval(() => {}, 60_000);\nexport default (s) => s.replaceAll('foo(', 'bar(');\n",
		};
		const root = await tree(files);
		const driver = join(root, 'check.mjs');
		const checker = pathToFileURL(join(repoRoot, 'scripts/check-migration-codemods.mjs')).href;
		await writeFile(
			driver,
			`import { runCheck } from ${JSON.stringify(checker)};\n` +
				'const { findings } = await runCheck({ root: process.argv[2] });\n' +
				'console.log(JSON.stringify(findings));\n',
		);
		const { stdout } = await execFileAsync(process.execPath, [driver, root], {
			timeout: 15_000,
			killSignal: 'SIGKILL',
		});
		assert.equal(stdout.trim(), '[]');
	});

	it('stops a synchronous loop at its deadline', { timeout: 20_000 }, async () => {
		const files = {
			...goodTree(),
			[`${CODEMOD}/transform.mjs`]: 'export default () => { for (;;) {} };\n',
		};
		assertOne(
			await findings(files, SLOW_STEP_MS),
			`${CODEMOD}/fixtures/basic.input.ts`,
			new RegExp(`timed out after ${SLOW_STEP_MS}ms`),
		);
	});

	it('stops an import that never finishes at its deadline', async () => {
		const files = {
			...goodTree(),
			[`${CODEMOD}/transform.mjs`]: 'await new Promise(() => {});\nexport default (s) => s;\n',
		};
		assertOne(
			await findings(files, 300),
			`${CODEMOD}/transform.mjs`,
			/cannot be imported: .*timed out after 300ms/,
		);
	});

	it('reports only the suite deadline when it interrupts fixture calls', async () => {
		const files = {
			...goodTree(),
			[`${CODEMOD}/transform.mjs`]:
				'export default async (s) => { await new Promise((r) => setTimeout(r, 400)); return s; };\n',
			[`${CODEMOD}/fixtures/basic.output.ts`]: 'foo(1);\n',
			[`${CODEMOD}/fixtures/second.input.ts`]: 'foo(2);\n',
			[`${CODEMOD}/fixtures/second.output.ts`]: 'foo(2);\n',
			[`${CODEMOD}/fixtures/third.input.ts`]: 'foo(3);\n',
			[`${CODEMOD}/fixtures/third.output.ts`]: 'foo(3);\n',
		};
		assertOne(
			await findings(files, 5_000, 500),
			'tools/migrations',
			/suite deadline of 500 ms reached/,
		);
	});

	it('passes a good codemod within the suite deadline', async () => {
		assert.deepEqual(await findings(goodTree(), 5_000, 30_000), []);
	});

	it('reports only the suite deadline when aborted before discovery', async () => {
		const root = await tree(goodTree());
		const result = await runCheck({ root, signal: AbortSignal.abort() });
		assertOne(result.findings, 'tools/migrations', /suite deadline of \d+ ms reached/);
		assert.equal(result.codemods, 0);
	});

	it('skips count mismatches when aborted before discovery', async () => {
		const root = await tree({ ...goodTree(), 'docs/migrations/v0.9.md': guide(2) });
		const result = await runCheck({ root, signal: AbortSignal.abort() });
		assertOne(result.findings, 'tools/migrations', /suite deadline of \d+ ms reached/);
		assert.equal(result.codemods, 0);
	});
});
