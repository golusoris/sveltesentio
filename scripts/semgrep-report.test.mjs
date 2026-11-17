// Feeds semgrep-report.mjs planted reports: each defect must fail the scan.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TOLERATED, judge } from './semgrep-report.mjs';

const files = ['a.ts', 'tools/figures/checks.mjs'];
const [entry] = TOLERATED;
const partial = (line = entry.line, path = entry.path) => ({
	type: ['PartialParsing', [{ path, start: { line } }]],
	path,
	spans: [{ file: path, start: { line, col: 16 } }],
});
const report = (overrides = {}) => ({
	results: [],
	errors: [],
	paths: { scanned: [...files] },
	...overrides,
});
const before = '2026-10-19';

describe('semgrep report', () => {
	it('passes a clean report', () => {
		assert.deepEqual(judge(report(), files, before), []);
	});

	it('fails a finding', () => {
		const result = { check_id: 'no-eval', path: 'a.ts', start: { line: 3 } };
		assert.deepEqual(judge(report({ results: [result] }), files, before), ['a.ts:3: no-eval']);
	});

	it('tolerates the listed parse error before its expiry', () => {
		assert.deepEqual(judge(report({ errors: [partial()] }), files, before), []);
	});

	it('fails the listed parse error on its expiry day', () => {
		assert.equal(judge(report({ errors: [partial()] }), files, entry.expires).length, 1);
	});

	it('fails the same error on another line or file', () => {
		assert.equal(judge(report({ errors: [partial(entry.line + 1)] }), files, before).length, 1);
		assert.equal(judge(report({ errors: [partial(entry.line, 'a.ts')] }), files, before).length, 1);
	});

	it('fails any other error', () => {
		const error = { type: 'Timeout', path: 'a.ts', spans: [], message: 'timed out' };
		assert.equal(judge(report({ errors: [error] }), files, before).length, 1);
	});

	it('fails a selected file that was not scanned', () => {
		const problems = judge(report({ paths: { scanned: ['a.ts'] } }), files, before);
		assert.deepEqual(problems, [
			'1 selected files were not scanned, first tools/figures/checks.mjs',
		]);
	});

	it('fails a report without lists', () => {
		assert.equal(judge({}, files, before).length, 1);
	});

	it('keeps every tolerance inside the category C interval of 10 days', () => {
		for (const item of TOLERATED) {
			assert.ok(item.expires <= '2026-10-29', `${item.path} expires ${item.expires}`);
		}
	});
});

describe('judge: branches', () => {
	it('negative: null report or non-array results or errors fails early', () => {
		const expected = ['the report has no results or errors list'];
		assert.deepEqual(judge(null, files, before), expected);
		assert.deepEqual(judge(undefined, files, before), expected);
		assert.deepEqual(judge({ results: 'bad', errors: [] }, files, before), expected);
		assert.deepEqual(judge({ results: [], errors: null }, files, before), expected);
	});

	it('boundary: finding without start location formats undefined line', () => {
		const result = { check_id: 'no-eval', path: 'a.ts' };
		const problems = judge(report({ results: [result] }), files, before);
		assert.deepEqual(problems, ['a.ts:undefined: no-eval']);
	});

	it('negative and boundary: untolerated error uses path and message or fallbacks', () => {
		const withFields = { type: 'Timeout', path: 'a.ts', spans: [], message: 'timed out' };
		const problems1 = judge(report({ errors: [withFields] }), files, before);
		assert.deepEqual(problems1, ['semgrep error Timeout in a.ts: timed out']);

		const bare = { type: 'SyntaxError', spans: [] };
		const problems2 = judge(report({ errors: [bare] }), files, before);
		assert.deepEqual(problems2, ['semgrep error SyntaxError in no file:']);
	});

	it('negative and boundary: missing paths or scanned list marks selected files unscanned', () => {
		const expected = ['2 selected files were not scanned, first a.ts'];
		assert.deepEqual(judge(report({ paths: undefined }), files, before), expected);
		assert.deepEqual(judge(report({ paths: {} }), files, before), expected);
		assert.deepEqual(judge(report({ paths: undefined }), [], before), []);
	});
});
