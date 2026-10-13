// Runs the coverage threshold step of the reusable ci-sveltekit.yml workflow
// against planted coverage summaries. The step runs in the calling
// repository's checkout, where no script of this repository exists, so its
// code stays inline in the workflow; this test reads that inline block and
// runs it as the runner would, with bash in a directory holding the summary.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workflow = join(
	fileURLToPath(new URL('.', import.meta.url)),
	'..',
	'.github',
	'workflows',
	'ci-sveltekit.yml',
);

const STEP_NAME = '      - name: Check coverage threshold\n';

/** The `run: |` block of the coverage step, with its indentation removed. */
function coverageStepScript(source) {
	const start = source.indexOf(STEP_NAME);
	assert.ok(start >= 0, 'coverage step not found in ci-sveltekit.yml');
	const lines = source.slice(start + STEP_NAME.length).split('\n');
	const runAt = lines.findIndex((line) => line === '        run: |');
	assert.ok(runAt >= 0, 'coverage step has no `run: |` block');
	for (const line of lines.slice(0, runAt)) {
		assert.match(line, /^ {8,}\S/, `line outside the step before run: ${line}`);
	}
	const body = [];
	for (const line of lines.slice(runAt + 1)) {
		if (line !== '' && !line.startsWith(' '.repeat(10))) break;
		body.push(line.slice(10));
	}
	return body.join('\n');
}

const script = coverageStepScript(readFileSync(workflow, 'utf8'));
const dirs = [];

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Runs the step in a fresh directory. `summary` is written to
 * coverage/coverage-summary.json as given (string) or as JSON (object);
 * undefined writes no file. `threshold` defaults to 70 when the option is
 * absent; an explicit undefined leaves THRESHOLD unset.
 */
function runStep(options) {
	const { summary } = options;
	const threshold = 'threshold' in options ? options.threshold : '70';
	const dir = mkdtempSync(join(tmpdir(), 'ci-sveltekit-coverage-'));
	dirs.push(dir);
	if (summary !== undefined) {
		mkdirSync(join(dir, 'coverage'));
		const text = typeof summary === 'string' ? summary : JSON.stringify(summary);
		writeFileSync(join(dir, 'coverage', 'coverage-summary.json'), text);
	}
	const env = { PATH: process.env.PATH };
	if (threshold !== undefined) env.THRESHOLD = threshold;
	const run = spawnSync('bash', ['-e', '-c', script], {
		cwd: dir,
		env,
		encoding: 'utf8',
		timeout: 30_000,
	});
	assert.equal(run.error, undefined);
	return run;
}

const lines = (pct) => ({ total: { lines: { total: 10, covered: 7, skipped: 0, pct } } });

describe('ci-sveltekit.yml coverage step: positive', () => {
	it('passes when line coverage is above the threshold', () => {
		const run = runStep({ summary: lines(85.5) });
		assert.equal(run.status, 0, run.stderr);
		assert.match(run.stdout, /Coverage: 85\.5% \(threshold: 70%\)/);
	});
});

describe('ci-sveltekit.yml coverage step: negative (all but the threshold case passed the step before this fix)', () => {
	it('fails when the coverage summary is missing', () => {
		const run = runStep({ summary: undefined });
		assert.equal(run.status, 1);
		assert.match(run.stderr, /::error::coverage\/coverage-summary\.json is missing or unreadable/);
	});

	it('fails when the coverage summary is not JSON', () => {
		const run = runStep({ summary: '{ not json' });
		assert.equal(run.status, 1);
		assert.match(run.stderr, /missing or unreadable/);
	});

	it('fails when the summary has no line total', () => {
		const run = runStep({ summary: { total: {} } });
		assert.equal(run.status, 1);
		assert.match(run.stderr, /missing or unreadable/);
	});

	it('fails when the line figure is not a number', () => {
		// istanbul writes "Unknown" when no line was instrumented.
		const run = runStep({ summary: lines('Unknown') });
		assert.equal(run.status, 1);
		assert.match(run.stderr, /total\.lines\.pct .* is not a number: "Unknown"/);
	});

	it('fails when the threshold is not a number', () => {
		for (const threshold of ['seventy', '', undefined]) {
			const run = runStep({ summary: lines(85), threshold });
			assert.equal(run.status, 1, String(threshold));
			assert.match(run.stderr, /coverage-threshold is not a number/);
		}
	});
});

describe('ci-sveltekit.yml coverage step: boundary', () => {
	it('fails just below the threshold', () => {
		const run = runStep({ summary: lines(69.99) });
		assert.equal(run.status, 1);
		assert.match(run.stderr, /Coverage 69\.99% is below the threshold of 70%/);
	});

	it('passes exactly at the threshold', () => {
		assert.equal(runStep({ summary: lines(70) }).status, 0);
	});

	it('passes a threshold of 0 with 0% coverage', () => {
		assert.equal(runStep({ summary: lines(0), threshold: '0' }).status, 0);
	});
});

describe('ci-sveltekit.yml coverage step: wiring', () => {
	it('reads the threshold from the workflow input through env, not by expansion', () => {
		const source = readFileSync(workflow, 'utf8');
		const step = source.slice(
			source.indexOf(STEP_NAME),
			source.indexOf('        run: |', source.indexOf(STEP_NAME)),
		);
		assert.match(step, /\n {10}THRESHOLD: \$\{\{ inputs\.coverage-threshold \}\}\n/);
		assert.doesNotMatch(script, /\$\{\{/);
	});
});
