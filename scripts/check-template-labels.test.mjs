import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	checkLabelExists,
	fetchRepoLabels,
	LABEL_LIMIT,
	LABELS_FILE_LIMIT,
	main,
	missingLabels,
	readTemplates,
	REVALIDATE_LIMIT,
	revalidateMissing,
	templateLabels,
	withTimeout,
} from './check-template-labels.mjs';

const ownTemplates = join(
	fileURLToPath(new URL('.', import.meta.url)),
	'..',
	'.github',
	'ISSUE_TEMPLATE',
);

const quiet = { log() {}, error() {} };

describe('withTimeout', () => {
	it('returns the resolved value when promise finishes before timeout', async () => {
		const val = await withTimeout(Promise.resolve('done'), 100);
		assert.equal(val, 'done');
	});

	it('rejects when the timer expires before the promise settles', async () => {
		const slow = new Promise(() => {});
		await assert.rejects(withTimeout(slow, 20, 'slow-op'), /slow-op timed out after 20ms/);
	});
});

describe('templateLabels', () => {
	it('reads an inline list with single, double and no quotes', () => {
		assert.deepEqual(templateLabels(`name: Bug\nlabels: ['bug', "help wanted", triage]\n`), [
			'bug',
			'help wanted',
			'triage',
		]);
	});

	it('reads a block list and stops at the next key', () => {
		const source =
			'name: Bug\nlabels:\n  - bug\n  # a comment\n  - "good first issue"\nbody:\n  - type: markdown\n';
		assert.deepEqual(templateLabels(source), ['bug', 'good first issue']);
	});

	it('returns no labels for a form without the key or with an empty list', () => {
		assert.deepEqual(templateLabels('name: Bug\nbody: []\n'), []);
		assert.deepEqual(templateLabels('name: Bug\nlabels: []\n'), []);
	});

	it('throws when labels key is present with a null or blank value', () => {
		assert.throws(
			() => templateLabels('name: Bug\nlabels:\n', 'x.yml'),
			/x\.yml.*labels must be an array or comma-delimited string/,
		);
		assert.throws(
			() => templateLabels('name: Bug\nlabels: null\n', 'x.yml'),
			/x\.yml.*labels must be an array or comma-delimited string/,
		);
		assert.throws(
			() => templateLabels('name: Bug\nlabels: ""\n', 'x.yml'),
			/x\.yml.*labels must be an array or comma-delimited string/,
		);
		assert.throws(
			() => templateLabels('name: Bug\nlabels: "   "\n', 'x.yml'),
			/x\.yml.*labels must be an array or comma-delimited string/,
		);
		assert.throws(
			() => templateLabels('name: Bug\nlabels: " , , "\n', 'x.yml'),
			/x\.yml.*labels must be an array or comma-delimited string/,
		);
	});

	it('refuses blank label items in an array and trims surrounding whitespace', () => {
		assert.throws(
			() => templateLabels("name: Bug\nlabels: ['bug', '']\n", 'x.yml'),
			/x\.yml.*label item must not be blank/,
		);
		assert.throws(
			() => templateLabels("name: Bug\nlabels: ['bug', '   ']\n", 'x.yml'),
			/x\.yml.*label item must not be blank/,
		);
		assert.deepEqual(templateLabels("name: Bug\nlabels: [' bug ']\n"), ['bug']);
	});

	it('enforces LABEL_LIMIT per form boundaries', () => {
		const labels99 = Array.from({ length: LABEL_LIMIT - 1 }, (_, i) => `l${i}`);
		const labels100 = Array.from({ length: LABEL_LIMIT }, (_, i) => `l${i}`);
		const labels101 = Array.from({ length: LABEL_LIMIT + 1 }, (_, i) => `l${i}`);

		assert.equal(
			templateLabels(`name: Bug\nlabels: [${labels99.join(',')}]\n`).length,
			LABEL_LIMIT - 1,
		);
		assert.equal(
			templateLabels(`name: Bug\nlabels: [${labels100.join(',')}]\n`).length,
			LABEL_LIMIT,
		);
		assert.throws(
			() => templateLabels(`name: Bug\nlabels: [${labels101.join(',')}]\n`, 'x.yml'),
			/x\.yml.*exceeds limit of 100 labels/,
		);

		assert.equal(
			templateLabels(`name: Bug\nlabels: "${labels100.join(', ')}"\n`).length,
			LABEL_LIMIT,
		);
		assert.throws(
			() => templateLabels(`name: Bug\nlabels: "${labels101.join(', ')}"\n`, 'x.yml'),
			/x\.yml.*exceeds limit of 100 labels/,
		);
	});

	it('reads an indentless block list', () => {
		assert.deepEqual(templateLabels('name: Bug\nlabels:\n- bug\n- triage\n'), ['bug', 'triage']);
	});

	it('reads a next-line flow list', () => {
		assert.deepEqual(templateLabels("name: Bug\nlabels:\n  ['bug', 'triage']\n"), [
			'bug',
			'triage',
		]);
	});

	it('reads a broken item indented on the next line', () => {
		assert.deepEqual(templateLabels('name: Bug\nlabels:\n  - bug\n  -\n    triage\n'), [
			'bug',
			'triage',
		]);
	});

	it('tolerates item comments', () => {
		assert.deepEqual(templateLabels('name: Bug\nlabels:\n  - bug # default\n'), ['bug']);
	});

	it('tolerates brackets in inline comments', () => {
		assert.deepEqual(templateLabels("name: Bug\nlabels: ['bug'] # see [docs]\n"), ['bug']);
	});

	it('reads comma-delimited strings as supported by GitHub issue forms', () => {
		assert.deepEqual(templateLabels('name: Bug\nlabels: bug, triage\n'), ['bug', 'triage']);
		assert.deepEqual(templateLabels('name: Bug\nlabels: "bug, help wanted"\n'), [
			'bug',
			'help wanted',
		]);
		assert.deepEqual(templateLabels('name: Bug\nlabels: bug\n'), ['bug']);
	});

	it('refuses duplicate keys', () => {
		assert.throws(
			() => templateLabels('name: Bug\nlabels: [bug]\nlabels: [triage]\n', 'x.yml'),
			/x\.yml.*Map keys must be unique/,
		);
	});

	it('refuses a template that is not a YAML mapping', () => {
		assert.throws(() => templateLabels('', 'x.yml'), /x\.yml.*YAML mapping/);
		assert.throws(() => templateLabels('- a\n- b\n', 'x.yml'), /x\.yml.*YAML mapping/);
	});

	it('refuses a labels form it does not know instead of reading it as empty', () => {
		assert.throws(() => templateLabels('labels: { a: 1 }\n', 'x.yml'), /x\.yml/);
		assert.throws(() => templateLabels('labels: 42\n', 'x.yml'), /x\.yml/);
		assert.throws(
			() => templateLabels('labels: [123]\n', 'x.yml'),
			/x\.yml.*label item must be a string/,
		);
		assert.throws(() => templateLabels("labels: ['bug'\n", 'x.yml'), /x\.yml/);
		assert.throws(() => templateLabels("labels: ['bug', 'tri'age']\n", 'x.yml'), /x\.yml/);
	});
});

describe('missingLabels', () => {
	it('names the template label the repository lacks (the planted triage case)', () => {
		const templates = [{ file: 'bug_report.yml', labels: ['bug', 'triage'] }];
		assert.deepEqual(missingLabels(templates, ['bug', 'enhancement']), [
			{ file: 'bug_report.yml', label: 'triage' },
		]);
	});

	it('compares names without case, as GitHub does', () => {
		assert.deepEqual(missingLabels([{ file: 'a.yml', labels: ['Bug'] }], ['bug']), []);
	});

	it('passes when every label exists, including no labels at all', () => {
		assert.deepEqual(missingLabels([{ file: 'a.yml', labels: [] }], []), []);
	});
});

describe('fetchRepoLabels', () => {
	const reply = (status, body) =>
		Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body) });

	it('follows pages until a short one and sends a deadline with every request', async () => {
		const seen = [];
		const full = Array.from({ length: 100 }, (_, i) => ({ name: `l${i}` }));
		const labels = await fetchRepoLabels('o/r', 't', (url, init) => {
			seen.push({ url, signal: init.signal });
			return reply(200, seen.length === 1 ? full : [{ name: 'last' }]);
		});
		assert.equal(labels.length, 101);
		assert.equal(seen.length, 2);
		assert.ok(seen.every((call) => call.signal instanceof AbortSignal));
	});

	it('refuses non-string label names in API responses', async () => {
		await assert.rejects(
			fetchRepoLabels('o/r', 't', () => reply(200, [{ name: 123 }])),
			/invalid name, got number/,
		);
		await assert.rejects(
			fetchRepoLabels('o/r', 't', () => reply(200, [{}])),
			/invalid name, got undefined/,
		);
	});

	it('passes at the 1999 labels boundary', async () => {
		const labels = await fetchRepoLabels('o/r', 't', (url) => {
			const page = Number(new URL(url).searchParams.get('page'));
			if (page < 20) {
				return reply(
					200,
					Array.from({ length: 100 }, (_, i) => ({ name: `p${page}_${i}` })),
				);
			}
			if (page === 20) {
				return reply(
					200,
					Array.from({ length: 99 }, (_, i) => ({ name: `p20_${i}` })),
				);
			}
			return reply(200, []);
		});
		assert.equal(labels.length, 1999);
	});

	it('passes at the exactly 2000 labels boundary', async () => {
		const labels = await fetchRepoLabels('o/r', 't', (url) => {
			const page = Number(new URL(url).searchParams.get('page'));
			if (page <= 20) {
				return reply(
					200,
					Array.from({ length: 100 }, (_, i) => ({ name: `p${page}_${i}` })),
				);
			}
			return reply(200, []);
		});
		assert.equal(labels.length, 2000);
	});

	it('fails at the 2001 labels boundary', async () => {
		await assert.rejects(
			fetchRepoLabels('o/r', 't', (url) => {
				const page = Number(new URL(url).searchParams.get('page'));
				if (page <= 20) {
					return reply(
						200,
						Array.from({ length: 100 }, (_, i) => ({ name: `p${page}_${i}` })),
					);
				}
				return reply(200, [{ name: 'extra' }]);
			}),
			/more than 2000 labels/,
		);
	});

	it('fails on an HTTP error instead of returning no labels', async () => {
		await assert.rejects(
			fetchRepoLabels('o/r', 't', () => reply(403, {})),
			/HTTP 403/,
		);
	});
});

describe('checkLabelExists and revalidateMissing', () => {
	const reply = (status) => Promise.resolve({ ok: status === 200, status });

	it('checks existence of individual labels', async () => {
		const fetchStub = (url) => {
			if (url.endsWith('/bug')) return reply(200);
			if (url.endsWith('/triage')) return reply(404);
			return reply(500);
		};

		assert.equal(await checkLabelExists('o/r', 't', 'bug', fetchStub), true);
		assert.equal(await checkLabelExists('o/r', 't', 'triage', fetchStub), false);
		await assert.rejects(checkLabelExists('o/r', 't', 'error', fetchStub), /HTTP 500/);
	});

	it('drops labels that exist upon revalidation and keeps missing ones', async () => {
		const missing = [
			{ file: 'a.yml', label: 'bug' },
			{ file: 'b.yml', label: 'triage' },
		];
		const fetchStub = (url) => {
			if (url.endsWith('/bug')) return reply(200);
			return reply(404);
		};

		const stillMissing = await revalidateMissing('o/r', 't', missing, fetchStub);
		assert.deepEqual(stillMissing, [{ file: 'b.yml', label: 'triage' }]);
	});

	it('enforces scalar cap on revalidation count', async () => {
		const tooMany = Array.from({ length: REVALIDATE_LIMIT + 1 }, (_, i) => ({
			file: 'a.yml',
			label: `missing_${i}`,
		}));
		await assert.rejects(
			revalidateMissing('o/r', 't', tooMany, () => reply(200)),
			/too many missing labels to revalidate/,
		);
	});
});

describe('check-template-labels main', () => {
	let dir;

	before(async () => {
		dir = await mkdtemp(join(tmpdir(), 'ctl-test-'));
		await writeFile(join(dir, 'bug.yml'), "name: Bug\nlabels: ['bug', 'triage']\n");
		await writeFile(join(dir, 'config.yml'), 'blank_issues_enabled: false\n');
		await writeFile(join(dir, 'labels.json'), JSON.stringify(['bug']));
	});

	after(async () => {
		if (dir) await rm(dir, { recursive: true, force: true });
	});

	it('skips config.yml, which is not an issue form', async () => {
		assert.deepEqual(
			(await readTemplates(dir)).map((t) => t.file),
			['bug.yml'],
		);
	});

	it('exits 1 when a form names a missing label', async () => {
		const { error } = console;
		console.error = quiet.error;
		try {
			const code = await main({ argv: ['--labels-file', join(dir, 'labels.json')], env: {}, dir });
			assert.equal(code, 1);
		} finally {
			console.error = error;
		}
	});

	it('fails without a label source rather than passing unread', async () => {
		await assert.rejects(main({ argv: [], env: {}, dir }), /no label source/);
	});

	it('refuses non-string items in labels-file naming index', async () => {
		const badPath = join(dir, 'bad-labels.json');
		await writeFile(badPath, JSON.stringify([123]));
		await assert.rejects(
			main({ argv: ['--labels-file', badPath], env: {}, dir }),
			/item at index 0 must be a string, got number/,
		);

		await writeFile(badPath, JSON.stringify(['bug', null]));
		await assert.rejects(
			main({ argv: ['--labels-file', badPath], env: {}, dir }),
			/item at index 1 must be a string, got object/,
		);
	});

	it('enforces LABELS_FILE_LIMIT boundaries', async () => {
		const filePath = join(dir, 'file-limit.json');
		const exact2000 = [
			'bug',
			'triage',
			...Array.from({ length: LABELS_FILE_LIMIT - 2 }, (_, i) => `extra_${i}`),
		];
		await writeFile(filePath, JSON.stringify(exact2000));
		const { log } = console;
		console.log = quiet.log;
		try {
			const code = await main({ argv: ['--labels-file', filePath], env: {}, dir });
			assert.equal(code, 0);
		} finally {
			console.log = log;
		}

		const exact2001 = [
			'bug',
			'triage',
			...Array.from({ length: LABELS_FILE_LIMIT - 1 }, (_, i) => `extra_${i}`),
		];
		await writeFile(filePath, JSON.stringify(exact2001));
		await assert.rejects(
			main({ argv: ['--labels-file', filePath], env: {}, dir }),
			/exceeds limit of 2000 labels/,
		);
	});

	it('revalidates dropped labels against the API when missing from page scan', async () => {
		const fetchStub = (url) => {
			if (url.includes('?per_page=')) {
				// Pagination missed triage mid-read
				return Promise.resolve({
					ok: true,
					status: 200,
					json: () => Promise.resolve([{ name: 'bug' }]),
				});
			}
			if (url.endsWith('/triage')) {
				// Revalidation discovers triage does exist
				return Promise.resolve({ ok: true, status: 200 });
			}
			return Promise.resolve({ ok: false, status: 404 });
		};

		const { log } = console;
		console.log = quiet.log;
		try {
			const code = await main({
				argv: [],
				env: { GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'fake' },
				dir,
				fetchImpl: fetchStub,
			});
			assert.equal(code, 0);
		} finally {
			console.log = log;
		}
	});

	it('revalidates truly missing labels and exits 1', async () => {
		const fetchStub = (url) => {
			if (url.includes('?per_page=')) {
				return Promise.resolve({
					ok: true,
					status: 200,
					json: () => Promise.resolve([{ name: 'bug' }]),
				});
			}
			// Both 404
			return Promise.resolve({ ok: false, status: 404 });
		};

		const { error } = console;
		console.error = quiet.error;
		try {
			const code = await main({
				argv: [],
				env: { GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'fake' },
				dir,
				fetchImpl: fetchStub,
			});
			assert.equal(code, 1);
		} finally {
			console.error = error;
		}
	});

	it("reads this repository's own issue forms", async () => {
		const templates = await readTemplates(ownTemplates);
		assert.ok(templates.length > 0);
		assert.ok(templates.every((t) => t.labels.length > 0));
	});
});
