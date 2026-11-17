// Proves the HISS-04 caps in eslint.config.ts bind scripts/: a planted function over each cap
// fails lint, the same function at the cap passes, and scripts/*.test.mjs stays out of the block
// with the package tests (#588). Each case lints source text under a scripts/ path that does not
// exist on disk, so the repository config decides which block applies.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAP_RULES = [
	'complexity',
	'max-lines-per-function',
	'max-statements',
	'sonarjs/cognitive-complexity',
];

/** Source of an exported function whose cyclomatic complexity is `n` (n - 1 flat ifs). */
function cyclomatic(n) {
	const ifs = Array.from({ length: n - 1 }, (_, i) => `\tif (x === ${i}) return ${i};`);
	return `export function planted(x) {\n${ifs.join('\n')}\n\treturn -1;\n}\n`;
}

/** Source of a function with four nested ifs (cognitive 10) plus `flat` top-level ifs. */
function cognitive(flat) {
	const top = Array.from({ length: flat }, (_, i) => `\tif (x === ${i}) return ${i};`);
	const nested =
		'\tif (x) {\n\t\tif (y) {\n\t\t\tif (z) {\n\t\t\t\tif (w) return 1;\n\t\t\t}\n\t\t}\n\t}';
	return `export function planted(x, y, z, w) {\n${top.join('\n')}\n${nested}\n\treturn 0;\n}\n`;
}

/** Source of a function with exactly `n` statements, one per line. */
function statements(n) {
	const lines = Array.from({ length: n - 1 }, (_, i) => `\tconst v${i} = x + ${i};`);
	return `export function planted(x) {\n${lines.join('\n')}\n\treturn v0;\n}\n`;
}

/** Source of a one-statement function spanning `n` lines, `comments` comment lines not counted. */
function lines(n, comments = 0) {
	const items = Array.from({ length: n - 4 }, (_, i) => `\t\t${i},`);
	const notes = Array.from({ length: comments }, (_, i) => `\t// note ${i}`);
	const body = [...notes, '\treturn [', ...items, '\t];'];
	return `export function planted() {\n${body.join('\n')}\n}\n`;
}

let eslint;

/** The cap rules ESLint reports for `code` linted as `relPath`, sorted. */
async function capFindings(code, relPath = 'scripts/planted-cap.mjs') {
	const [result] = await eslint.lintText(code, { filePath: join(REPO_ROOT, relPath) });
	assert.equal(result.fatalErrorCount, 0, `planted source must parse: ${JSON.stringify(result)}`);
	return [
		...new Set(result.messages.map((m) => m.ruleId).filter((id) => CAP_RULES.includes(id))),
	].sort();
}

describe('HISS-04 caps on scripts/', { timeout: 120_000 }, () => {
	before(() => {
		eslint = new ESLint({ cwd: REPO_ROOT });
	});

	it('positive: cyclomatic complexity 11 fails complexity', async () => {
		assert.deepEqual(await capFindings(cyclomatic(11)), ['complexity']);
	});

	it('boundary: cyclomatic complexity 10 passes', async () => {
		assert.deepEqual(await capFindings(cyclomatic(10)), []);
	});

	it('positive: cognitive complexity 13 fails sonarjs/cognitive-complexity alone', async () => {
		assert.deepEqual(await capFindings(cognitive(3)), ['sonarjs/cognitive-complexity']);
	});

	it('boundary: cognitive complexity 12 passes', async () => {
		assert.deepEqual(await capFindings(cognitive(2)), []);
	});

	it('positive: 41 statements fail max-statements', async () => {
		assert.deepEqual(await capFindings(statements(41)), ['max-statements']);
	});

	it('boundary: 40 statements pass', async () => {
		assert.deepEqual(await capFindings(statements(40)), []);
	});

	it('positive: 61 counted lines fail max-lines-per-function', async () => {
		assert.deepEqual(await capFindings(lines(61)), ['max-lines-per-function']);
	});

	it('boundary: 60 counted lines pass, comment lines not counted', async () => {
		assert.deepEqual(await capFindings(lines(60, 5)), []);
	});

	it('positive: a nested scripts/ module is in scope', async () => {
		assert.deepEqual(await capFindings(cyclomatic(11), 'scripts/lib/planted-cap.mjs'), [
			'complexity',
		]);
	});

	it('negative: scripts/*.test.mjs stays out of the caps (#588)', async () => {
		const over = `${cyclomatic(11)}${statements(41).replace('planted', 'plantedStatements')}`;
		assert.deepEqual(await capFindings(over, 'scripts/planted-cap.test.mjs'), []);
	});
});
