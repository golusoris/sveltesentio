// Tests for scripts/check-migration-codemods.mjs: the frontmatter reader, and
// whole runs on throwaway trees that hold migration guides and codemods.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, it, mock } from 'node:test';
import {
	CODEMOD_LIMIT,
	ENTRY_LIMIT,
	FIXTURE_LIMIT,
	FRONTMATTER_LINE_LIMIT,
	VERSION_LIMIT,
	firstDifferentLine,
	main,
	readCodemodCount,
	runCheck,
} from './check-migration-codemods.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

/** @param {number} count */
const guide = (count) =>
	`---\nfrom-version: 0.8.x\nto-version: 0.9.0\ncodemods: ${count}\n---\n\n# v0.9\n`;

const RENAME = "export default (s) => s.replaceAll('foo(', 'bar(');\n";
const CODEMOD = 'tools/migrations/v0.9/rename-foo';

/** A guide declaring one codemod, and that codemod with one passing fixture pair. */
const goodTree = () => ({
	'docs/migrations/v0.9.md': guide(1),
	[`${CODEMOD}/transform.mjs`]: RENAME,
	[`${CODEMOD}/fixtures/basic.input.ts`]: 'foo(1);\n',
	[`${CODEMOD}/fixtures/basic.output.ts`]: 'bar(1);\n',
});

/** @type {string[]} */
const made = [];

/** Writes `files` ({ relative path: content }) into a new temporary root. */
async function tree(/** @type {Record<string, string>} */ files) {
	const root = await mkdtemp(join(tmpdir(), 'migration-codemods-'));
	made.push(root);
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), content);
	}
	return root;
}

/** Runs the check on `files` and returns its findings. */
async function findings(
	/** @type {Record<string, string>} */ files,
	timeoutMs = 5_000,
	/** @type {number | undefined} */ suiteTimeoutMs = undefined,
) {
	return (await runCheck({ root: await tree(files), timeoutMs, suiteTimeoutMs })).findings;
}

/** Asserts exactly one finding, on `file`, whose message matches `pattern`. */
function assertOne(/** @type {{ file: string, message: string }[]} */ got, file, pattern) {
	assert.equal(got.length, 1, JSON.stringify(got, null, 2));
	assert.equal(got[0]?.file, file);
	assert.match(got[0]?.message ?? '', pattern);
}

afterEach(async () => {
	mock.restoreAll();
	for (const root of made.splice(0)) await rm(root, { recursive: true, force: true });
});

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
			// 300 ms leaves room for the worker start of the load step on slow CI legs.
			await findings(files, 300),
			`${CODEMOD}/fixtures/basic.input.ts`,
			/timed out after 300ms/,
		);
	});

	it('rejects a synchronous call over its deadline and accepts it under the deadline', async () => {
		const files = {
			...goodTree(),
			[`${CODEMOD}/transform.mjs`]:
				"export default (s) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_500); return s.replaceAll('foo(', 'bar('); };\n",
		};
		assertOne(
			await findings(files, 300),
			`${CODEMOD}/fixtures/basic.input.ts`,
			/timed out after 300ms/,
		);
		assert.deepEqual(await findings(files, 5_000), []);
	});

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
			await findings(files, 300),
			`${CODEMOD}/fixtures/basic.input.ts`,
			/timed out after 300ms/,
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
		assert.deepEqual(await findings(files), []);

		files[`${CODEMOD}/fixtures/extra.input.txt`] = 'x\n';
		const got = await findings(files);
		assert.ok(
			got.some(
				(f) => f.file === `${CODEMOD}/fixtures` && /more than the limit of 200/.test(f.message),
			),
			JSON.stringify(got),
		);
	});

	it(`checks ${CODEMOD_LIMIT} codemods in one version, and refuses one more`, async () => {
		/** @type {Record<string, string>} */
		const files = { 'docs/migrations/v0.9.md': guide(CODEMOD_LIMIT) };
		for (let i = 0; i < CODEMOD_LIMIT; i++) {
			files[`tools/migrations/v0.9/c${i}/transform.mjs`] = 'export default (s) => s;\n';
			files[`tools/migrations/v0.9/c${i}/fixtures/a.input.txt`] = 'x\n';
			files[`tools/migrations/v0.9/c${i}/fixtures/a.output.txt`] = 'x\n';
		}
		assert.deepEqual(await findings(files), []);

		files['docs/migrations/v0.9.md'] = guide(CODEMOD_LIMIT + 1);
		files[`tools/migrations/v0.9/extra/transform.mjs`] = 'export default (s) => s;\n';
		const got = await findings(files);
		assert.ok(
			got.some(
				(f) => f.file === 'tools/migrations/v0.9' && /more than the limit of 100/.test(f.message),
			),
			JSON.stringify(got),
		);
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
