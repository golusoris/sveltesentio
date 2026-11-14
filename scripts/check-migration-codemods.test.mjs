// Frontmatter, discovery, counts, fixtures, layout, limits and main for migration codemods.
// Transform failures and deadlines: check-migration-codemods-transforms.test.mjs.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { afterEach, describe, it, mock } from 'node:test';
import {
	CODEMOD_LIMIT,
	ENTRY_LIMIT,
	FIXTURE_LIMIT,
	FRONTMATTER_LINE_LIMIT,
	TRANSFORM_TIMEOUT_MS,
	VERSION_LIMIT,
	compareCounts,
	firstDifferentLine,
	main,
	readCodemodCount,
	runCheck,
} from './check-migration-codemods.mjs';
import {
	CODEMOD,
	RENAME,
	assertOne,
	cleanup,
	findings,
	goodTree,
	guide,
	repoRoot,
	stubRunner,
	tree,
} from './check-migration-codemods.fixtures.mjs';

afterEach(cleanup);

describe('readCodemodCount', () => {
	it('reads 0 and 3', () => {
		assert.deepEqual(readCodemodCount('---\ncodemods: 0\n---\n'), { count: 0 });
		assert.deepEqual(readCodemodCount('---\ntitle: x\ncodemods: 3\n---\nbody\n'), { count: 3 });
	});

	it('reads frontmatter with CRLF line ends', () => {
		assert.deepEqual(readCodemodCount('---\r\ncodemods: 2\r\n---\r\nbody\r\n'), { count: 2 });
	});

	it('refuses a file without frontmatter', () => {
		assert.match(readCodemodCount('# v0.9\n').error ?? '', /no YAML frontmatter/);
	});

	it('refuses frontmatter with no closing ---', () => {
		assert.match(readCodemodCount('---\ncodemods: 1\n').error ?? '', /no closing ---/);
	});

	it(`reads ${FRONTMATTER_LINE_LIMIT} frontmatter lines, and refuses one more`, () => {
		const lines = ['codemods: 1'];
		for (let i = 0; i < FRONTMATTER_LINE_LIMIT - 1; i++) {
			lines.push(`k${i}: x`);
		}
		assert.deepEqual(readCodemodCount(`---\n${lines.join('\n')}\n---\n`), { count: 1 });

		lines.push('extra: x');
		assert.match(readCodemodCount(`---\n${lines.join('\n')}\n---\n`).error ?? '', /no closing ---/);
	});

	it('refuses frontmatter that is not valid YAML, or not a mapping', () => {
		assert.match(readCodemodCount('---\ncodemods: [1\n---\n').error ?? '', /not valid YAML/);
		assert.match(
			readCodemodCount('---\ncodemods: 1\ncodemods: 2\n---\n').error ?? '',
			/not valid YAML/,
		);
		assert.match(readCodemodCount('---\n- 1\n---\n').error ?? '', /YAML mapping/);
	});

	it('refuses a missing, negative, fractional or non-numeric count', () => {
		assert.match(readCodemodCount('---\ntitle: x\n---\n').error ?? '', /no codemods count/);
		assert.match(readCodemodCount('---\ncodemods: -1\n---\n').error ?? '', /got -1/);
		assert.match(readCodemodCount('---\ncodemods: 1.5\n---\n').error ?? '', /got 1.5/);
		assert.match(readCodemodCount("---\ncodemods: 'two'\n---\n").error ?? '', /got "two"/);
	});
});

describe('firstDifferentLine', () => {
	it('names the first line that differs, counting from 1', () => {
		assert.equal(firstDifferentLine('a\nb\nc\n', 'a\nB\nc\n'), 2);
		assert.equal(firstDifferentLine('x', 'y'), 1);
	});

	it('counts a missing trailing line as a difference', () => {
		assert.equal(firstDifferentLine('a\nb', 'a\nb\nc'), 3);
	});
});

describe('compareCounts', () => {
	const root = repoRoot;
	// AbortSignal.any over no signals never aborts: a live suite signal without a timer.
	const live = AbortSignal.any([]);

	it('reports a guide whose declared count exceeds the discovered codemods', () => {
		const suite = live;
		const ctx = { root, timeoutMs: TRANSFORM_TIMEOUT_MS, suite, findings: [] };
		const docs = new Map([['0.9', { path: join(root, 'docs/migrations/v0.9.md'), count: 2 }]]);
		compareCounts(ctx, docs, new Map());
		assertOne(
			ctx.findings,
			'docs/migrations/v0.9.md',
			/declares codemods: 2, tools\/migrations\/v0\.9\/ has 0/,
		);
	});

	it('records nothing after a suite abort with partial discovery maps', () => {
		const suite = AbortSignal.abort();
		const ctx = { root, timeoutMs: TRANSFORM_TIMEOUT_MS, suite, findings: [] };
		const docs = new Map([['0.9', { path: join(root, 'docs/migrations/v0.9.md'), count: 2 }]]);
		compareCounts(ctx, docs, new Map());
		assert.deepEqual(ctx.findings, []);
	});

	it('passes when the guide count matches the discovered codemods', () => {
		const suite = live;
		const ctx = { root, timeoutMs: TRANSFORM_TIMEOUT_MS, suite, findings: [] };
		const docs = new Map([['0.9', { path: join(root, 'docs/migrations/v0.9.md'), count: 1 }]]);
		const path = join(root, 'tools/migrations/v0.9');
		const versions = new Map([['0.9', { path, codemods: [join(path, 'rename-foo')] }]]);
		compareCounts(ctx, docs, versions);
		assert.deepEqual(ctx.findings, []);
	});

	it('reports discovered codemods without a migration guide', () => {
		const suite = live;
		const ctx = { root, timeoutMs: TRANSFORM_TIMEOUT_MS, suite, findings: [] };
		const path = join(root, 'tools/migrations/v0.9');
		const versions = new Map([['0.9', { path, codemods: [join(path, 'rename-foo')] }]]);
		compareCounts(ctx, new Map(), versions);
		assertOne(
			ctx.findings,
			'tools/migrations/v0.9',
			/no migration guide docs\/migrations\/v0\.9\.md declares these codemods/,
		);
	});
});

describe('runCheck', () => {
	it('passes on the repository itself', async () => {
		const result = await runCheck({ root: repoRoot });
		assert.deepEqual(result.findings, []);
		assert.ok(result.guides >= 1, 'docs/migrations/v0.2.md is read');
	});

	it('passes with a guide at codemods: 0 and no tools/migrations/', async () => {
		assert.deepEqual(await findings({ 'docs/migrations/v0.9.md': guide(0) }), []);
	});

	it('passes with only a README in tools/migrations/, and no guides at all', async () => {
		assert.deepEqual(await findings({ 'tools/migrations/README.md': '# codemods\n' }), []);
	});

	it('passes a codemod whose output matches its fixtures', async () => {
		const result = await runCheck({ root: await tree(goodTree()) });
		assert.deepEqual(result, { guides: 1, codemods: 1, findings: [] });
	});

	it('ignores guides that are not v<MAJOR.MINOR>.md', async () => {
		const files = { ...goodTree(), 'docs/migrations/kit-2-to-3.md': '# no frontmatter\n' };
		assert.deepEqual(await findings(files), []);
	});

	it('passes a fixture pair with a multi-part extension', async () => {
		const files = {
			...goodTree(),
			[`${CODEMOD}/fixtures/runes.input.svelte.ts`]: 'foo(2);\n',
			[`${CODEMOD}/fixtures/runes.output.svelte.ts`]: 'bar(2);\n',
		};
		assert.deepEqual(await findings(files), []);
	});

	it('passes the same virtual path with the real multi-part extension on both runs', async () => {
		const files = /** @type {Record<string, string>} */ (goodTree());
		delete files[`${CODEMOD}/fixtures/basic.input.ts`];
		delete files[`${CODEMOD}/fixtures/basic.output.ts`];
		files[`${CODEMOD}/transform.mjs`] =
			"import { basename } from 'node:path';\nexport default (s, p) => (basename(p) === 'basic.svelte.ts' ? s.replaceAll('foo(', 'bar(') : 'path ' + p);\n";
		files[`${CODEMOD}/fixtures/basic.input.svelte.ts`] = 'foo(1);\n';
		files[`${CODEMOD}/fixtures/basic.output.svelte.ts`] = 'bar(1);\n';
		assert.deepEqual(await findings(files), []);
	});

	it('passes a forward-slash fixture path relative to the codemod directory', async () => {
		const files = {
			...goodTree(),
			[`${CODEMOD}/transform.mjs`]:
				"export default (s, p) => (p === 'fixtures/basic.ts' ? s.replaceAll('foo(', 'bar(') : 'path ' + p);\n",
		};
		assert.deepEqual(await findings(files), []);
	});

	it('reports output that differs from the fixture, naming the line', async () => {
		const files = {
			...goodTree(),
			[`${CODEMOD}/fixtures/basic.input.ts`]: 'keep();\nfoo(1);\n',
			[`${CODEMOD}/fixtures/basic.output.ts`]: 'keep();\nbaz(1);\n',
		};
		assertOne(await findings(files), `${CODEMOD}/fixtures/basic.output.ts`, /differs .* line 2/);
	});

	it('reports a guide that declares a codemod nobody shipped', async () => {
		const got = await findings({ 'docs/migrations/v0.9.md': guide(1) });
		assertOne(
			got,
			'docs/migrations/v0.9.md',
			/declares codemods: 1, tools\/migrations\/v0.9\/ has 0/,
		);
	});

	it('reports a codemod the guide does not count', async () => {
		const got = await findings({ ...goodTree(), 'docs/migrations/v0.9.md': guide(0) });
		assertOne(
			got,
			'docs/migrations/v0.9.md',
			/declares codemods: 0, tools\/migrations\/v0.9\/ has 1/,
		);
	});

	it('reports a version directory with no guide', async () => {
		const files = {
			...goodTree(),
			'tools/migrations/v0.8/x/transform.mjs': 'export default (s) => s;\n',
			'tools/migrations/v0.8/x/fixtures/a.input.ts': 'a\n',
			'tools/migrations/v0.8/x/fixtures/a.output.ts': 'a\n',
		};
		assertOne(
			await findings(files),
			'tools/migrations/v0.8',
			/no migration guide docs\/migrations\/v0.8.md/,
		);
	});

	it('reports a directory in tools/migrations/ that is not a version', async () => {
		const files = { ...goodTree(), 'tools/migrations/legacy/notes.txt': 'x\n' };
		assertOne(await findings(files), 'tools/migrations/legacy', /not a v<MAJOR.MINOR> directory/);
	});

	it('reports a codemod without transform.mjs', async () => {
		const files = /** @type {Record<string, string>} */ (goodTree());
		delete files[`${CODEMOD}/transform.mjs`];
		assertOne(await findings(files), `${CODEMOD}/transform.mjs`, /missing/);
	});

	it('reports a transform.mjs that does not default-export a function', async () => {
		const files = { ...goodTree(), [`${CODEMOD}/transform.mjs`]: 'export const x = 1;\n' };
		assertOne(await findings(files), `${CODEMOD}/transform.mjs`, /default-export a function/);
	});

	it('reports a transform.mjs that cannot be imported', async () => {
		const files = { ...goodTree(), [`${CODEMOD}/transform.mjs`]: 'export default (\n' };
		assertOne(await findings(files), `${CODEMOD}/transform.mjs`, /cannot be imported/);
	});

	it('reports a codemod without fixtures', async () => {
		const files = { 'docs/migrations/v0.9.md': guide(1), [`${CODEMOD}/transform.mjs`]: RENAME };
		assertOne(await findings(files), `${CODEMOD}/fixtures`, /missing/);
	});

	it('reports an empty fixtures directory', async () => {
		const files = {
			'docs/migrations/v0.9.md': guide(1),
			[`${CODEMOD}/transform.mjs`]: RENAME,
			[`${CODEMOD}/fixtures/README.md`]: 'x\n',
		};
		const got = await findings(files);
		assert.equal(got.length, 2, JSON.stringify(got));
		assert.match(got[0]?.message ?? '', /not a fixture/);
		assert.match(got[1]?.message ?? '', /holds no fixture pair/);
	});

	it('reports an input without an output, and an output without an input', async () => {
		const input = { ...goodTree(), [`${CODEMOD}/fixtures/lone.input.ts`]: 'foo(3);\n' };
		assertOne(await findings(input), `${CODEMOD}/fixtures/lone.input.ts`, /no matching .output/);
		const output = { ...goodTree(), [`${CODEMOD}/fixtures/lone.output.ts`]: 'bar(3);\n' };
		assertOne(await findings(output), `${CODEMOD}/fixtures/lone.output.ts`, /no matching .input/);
	});

	it('does not pair fixtures whose extensions differ', async () => {
		const files = {
			...goodTree(),
			[`${CODEMOD}/fixtures/ext.input.ts`]: 'foo(4);\n',
			[`${CODEMOD}/fixtures/ext.output.js`]: 'bar(4);\n',
		};
		assert.equal((await findings(files)).length, 2);
	});

	it('reports a guide with bad frontmatter, without a count finding on top', async () => {
		const missing = { ...goodTree(), 'docs/migrations/v0.9.md': '# v0.9\n' };
		assertOne(await findings(missing), 'docs/migrations/v0.9.md', /no YAML frontmatter/);
		const negative = { ...goodTree(), 'docs/migrations/v0.9.md': '---\ncodemods: -1\n---\n' };
		assertOne(await findings(negative), 'docs/migrations/v0.9.md', /got -1/);
		const word = { ...goodTree(), 'docs/migrations/v0.9.md': "---\ncodemods: 'two'\n---\n" };
		assertOne(await findings(word), 'docs/migrations/v0.9.md', /got "two"/);
	});

	it(`checks ${ENTRY_LIMIT} migration entries, and refuses one more`, async () => {
		/** @type {Record<string, string>} */
		const files = { 'docs/migrations/v0.9.md': guide(0) };
		for (let i = 0; i < ENTRY_LIMIT - 1; i++) {
			files[`docs/migrations/n${i}.md`] = '# notes\n';
		}
		assert.deepEqual(await findings(files), []);

		files['docs/migrations/extra.md'] = '# notes\n';
		const got = await findings(files);
		assert.ok(
			got.some(
				(f) => f.file === 'docs/migrations' && /more than the limit of 1000/.test(f.message),
			),
			JSON.stringify(got),
		);
	});

	it(`checks ${VERSION_LIMIT} version directories, and refuses one more`, async () => {
		/** @type {Record<string, string>} */
		const files = {};
		for (let i = 0; i < VERSION_LIMIT; i++) {
			files[`tools/migrations/v1.${i}/README.md`] = '# codemods\n';
			files[`docs/migrations/v1.${i}.md`] = guide(0);
		}
		assert.deepEqual(await findings(files), []);

		files[`tools/migrations/v1.${VERSION_LIMIT}/README.md`] = '# codemods\n';
		files[`docs/migrations/v1.${VERSION_LIMIT}.md`] = guide(0);
		const got = await findings(files);
		assert.ok(
			got.some(
				(f) => f.file === 'tools/migrations' && /more than the limit of 200/.test(f.message),
			),
			JSON.stringify(got),
		);
	});

	it(`checks ${FIXTURE_LIMIT} fixture files, and refuses one more`, async () => {
		const files = /** @type {Record<string, string>} */ (goodTree());
		files[`${CODEMOD}/transform.mjs`] = 'export default (s) => s;\n';
		delete files[`${CODEMOD}/fixtures/basic.input.ts`];
		delete files[`${CODEMOD}/fixtures/basic.output.ts`];
		for (let i = 0; i < FIXTURE_LIMIT / 2; i++) {
			files[`${CODEMOD}/fixtures/c${i}.input.txt`] = 'x\n';
			files[`${CODEMOD}/fixtures/c${i}.output.txt`] = 'x\n';
		}
		const { run, steps } = stubRunner();
		const result = await runCheck({ root: await tree(files), run });
		assert.deepEqual(result.findings, []);
		assert.equal(steps.filter((step) => step.mode === 'load').length, 1);
		assert.equal(steps.filter((step) => step.mode === 'call').length, FIXTURE_LIMIT);

		files[`${CODEMOD}/fixtures/extra.input.txt`] = 'x\n';
		const { run: overRun, steps: overSteps } = stubRunner();
		const { findings: got } = await runCheck({ root: await tree(files), run: overRun });
		assert.ok(
			got.some(
				(f) => f.file === `${CODEMOD}/fixtures` && /more than the limit of 200/.test(f.message),
			),
			JSON.stringify(got),
		);
		assert.equal(overSteps.filter((step) => step.mode === 'load').length, 1);
		assert.equal(overSteps.filter((step) => step.mode === 'call').length, 0);
	});

	it(`checks ${CODEMOD_LIMIT} codemods in one version, and refuses one more`, async () => {
		/** @type {Record<string, string>} */
		const files = { 'docs/migrations/v0.9.md': guide(CODEMOD_LIMIT) };
		for (let i = 0; i < CODEMOD_LIMIT; i++) {
			files[`tools/migrations/v0.9/c${i}/transform.mjs`] = 'export default (s) => s;\n';
			files[`tools/migrations/v0.9/c${i}/fixtures/a.input.txt`] = 'x\n';
			files[`tools/migrations/v0.9/c${i}/fixtures/a.output.txt`] = 'x\n';
		}
		const { run, steps } = stubRunner();
		const result = await runCheck({ root: await tree(files), run });
		assert.deepEqual(result.findings, []);
		assert.equal(result.codemods, CODEMOD_LIMIT);
		const loads = steps.filter((step) => step.mode === 'load');
		assert.equal(loads.length, CODEMOD_LIMIT);
		assert.equal(new Set(loads.map((step) => step.transformFile)).size, CODEMOD_LIMIT);
		assert.equal(steps.filter((step) => step.mode === 'call').length, 2 * CODEMOD_LIMIT);

		files['docs/migrations/v0.9.md'] = guide(CODEMOD_LIMIT + 1);
		files[`tools/migrations/v0.9/extra/transform.mjs`] = 'export default (s) => s;\n';
		const { run: overRun, steps: overSteps } = stubRunner();
		const { findings: got } = await runCheck({ root: await tree(files), run: overRun });
		assert.ok(
			got.some(
				(f) => f.file === 'tools/migrations/v0.9' && /more than the limit of 100/.test(f.message),
			),
			JSON.stringify(got),
		);
		assert.equal(overSteps.length, 0);
	});

	it('reports a call step that succeeds without a value, and does not reject', async () => {
		const { run: stub, steps } = stubRunner();
		/** @type {import('./check-migration-codemods.mjs').Runner} */
		const run = async (options) => (options.mode === 'call' ? { ok: true } : stub(options));
		const { findings: got } = await runCheck({ root: await tree(goodTree()), run });
		assertOne(got, `${CODEMOD}/fixtures/basic.input.ts`, /must return a string, got undefined/);
		assert.equal(steps.length, 1);
	});
});

describe('main', () => {
	it('returns 0 and prints the counts on a clean tree', async () => {
		const log = mock.method(console, 'log', () => {});
		assert.equal(await main(await tree(goodTree())), 0);
		assert.match(
			String(log.mock.calls[0]?.arguments[0]),
			/OK: 1 migration guide\(s\), 1 codemod\(s\) checked/,
		);
	});

	it('returns 1 and prints each finding on a bad tree', async () => {
		const error = mock.method(console, 'error', () => {});
		assert.equal(await main(await tree({ 'docs/migrations/v0.9.md': guide(2) })), 1);
		const printed = error.mock.calls.map((c) => String(c.arguments[0])).join('\n');
		assert.match(printed, /docs\/migrations\/v0.9.md: declares codemods: 2/);
	});
});
