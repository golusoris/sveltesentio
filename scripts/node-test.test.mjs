import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { matchTests, runTests } from './node-test.mjs';

const dir = mkdtempSync(join(tmpdir(), 'node-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

/** Writes one test file under `dir` and returns the directory it sits in. */
function fixture(name, body) {
	const sub = join(dir, name);
	mkdirSync(join(sub, 'cases'), { recursive: true });
	writeFileSync(join(sub, 'cases', 'a.test.mjs'), `import { test } from 'node:test';\n${body}\n`);
	return sub;
}

describe('matchTests', () => {
	it('returns each match once, sorted, for overlapping globs', () => {
		const sub = fixture('match', "test('ok', () => {});");
		writeFileSync(join(sub, 'cases', 'b.test.mjs'), '');
		const files = matchTests(['cases/*.test.mjs', 'cases/a.test.mjs'], sub);
		assert.deepEqual(files, [join('cases', 'a.test.mjs'), join('cases', 'b.test.mjs')]);
	});
});

describe('runTests', () => {
	it('passes when the matched tests pass', () => {
		assert.equal(runTests(['cases/*.test.mjs'], fixture('pass', "test('ok', () => {});")), 0);
	});

	it('fails when a matched test fails', () => {
		const sub = fixture('fail', "test('bad', () => { throw new Error('planted'); });");
		assert.notEqual(runTests(['cases/*.test.mjs'], sub), 0);
	});

	it('fails when the glob matches no file', () => {
		assert.equal(runTests(['cases/*.test.mjs'], dir), 1);
	});

	it('fails when no glob is given', () => {
		assert.equal(runTests([], dir), 2);
	});
});
