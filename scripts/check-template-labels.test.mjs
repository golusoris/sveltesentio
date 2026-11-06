import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	fetchRepoLabels,
	main,
	missingLabels,
	readTemplates,
	templateLabels,
} from './check-template-labels.mjs';

const ownTemplates = join(
	fileURLToPath(new URL('.', import.meta.url)),
	'..',
	'.github',
	'ISSUE_TEMPLATE',
);

const quiet = { log() {}, error() {} };

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
	const reply = (status, body) => Promise.resolve({ ok: status === 200, status, json: () => body });

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

	it('fails on an HTTP error instead of returning no labels', async () => {
		await assert.rejects(
			fetchRepoLabels('o/r', 't', () => reply(403, {})),
			/HTTP 403/,
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

	it("reads this repository's own issue forms", async () => {
		const templates = await readTemplates(ownTemplates);
		assert.ok(templates.length > 0);
		assert.ok(templates.every((t) => t.labels.length > 0));
	});
});
