import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	CHANGE_DETECTOR,
	CHANGE_SCOPED,
	EVENT_SCOPED,
	KNOWN_NEEDS,
	MUST_SUCCEED,
	evaluateGate,
	main,
} from './ci-gate.mjs';

const ciWorkflow = join(
	fileURLToPath(new URL('.', import.meta.url)),
	'..',
	'.github',
	'workflows',
	'ci.yml',
);

/** Needs of a run in which every job succeeded. */
function allSucceeded() {
	const needs = {};
	for (const job of KNOWN_NEEDS) needs[job] = { result: 'success', outputs: {} };
	needs[CHANGE_DETECTOR].outputs = { has_code_changes: 'true' };
	return needs;
}

/** Needs of a pull request run that changed documentation only. */
function docsOnlyPullRequest() {
	const needs = allSucceeded();
	needs[CHANGE_DETECTOR].outputs = { has_code_changes: 'false' };
	for (const job of CHANGE_SCOPED) needs[job] = { result: 'skipped', outputs: {} };
	return needs;
}

/** Needs of a push run, where the pull-request-only jobs skip. */
function pushRun() {
	const needs = allSucceeded();
	for (const job of Object.keys(EVENT_SCOPED)) needs[job] = { result: 'skipped', outputs: {} };
	return needs;
}

describe('evaluateGate: positive', () => {
	it('passes a pull request run in which every job succeeded', () => {
		assert.deepEqual(evaluateGate(allSucceeded(), 'pull_request').failures, []);
	});

	it('passes a docs-only pull request whose change-scoped jobs were skipped', () => {
		const { passed, failures } = evaluateGate(docsOnlyPullRequest(), 'pull_request');
		assert.deepEqual(failures, []);
		assert.ok(passed.includes('lint: skipped, detect-changes reported no code changes'));
	});

	it('passes a push run whose pull-request-only jobs were skipped', () => {
		const { passed, failures } = evaluateGate(pushRun(), 'push');
		assert.deepEqual(failures, []);
		assert.ok(passed.includes('pr-title: skipped, runs on pull_request only'));
	});
});

describe('evaluateGate: negative (each case passed the gate before this script)', () => {
	for (const job of MUST_SUCCEED) {
		it(`fails when ${job} was skipped`, () => {
			const needs = allSucceeded();
			needs[job] = { result: 'skipped', outputs: {} };
			assert.deepEqual(evaluateGate(needs, 'pull_request').failures, [`${job}: skipped`]);
		});
	}

	it('fails a change-scoped skip when the detector reported code changes', () => {
		const needs = allSucceeded();
		needs.test = { result: 'skipped', outputs: {} };
		assert.deepEqual(evaluateGate(needs, 'pull_request').failures, ['test: skipped']);
	});

	it('fails a change-scoped skip on push, where every job must run', () => {
		const needs = pushRun();
		needs.lint = { result: 'skipped', outputs: {} };
		assert.deepEqual(evaluateGate(needs, 'push').failures, ['lint: skipped']);
	});

	it('fails a change-scoped skip when the detector itself did not succeed', () => {
		const needs = docsOnlyPullRequest();
		needs[CHANGE_DETECTOR] = { result: 'failure', outputs: { has_code_changes: 'false' } };
		const { failures } = evaluateGate(needs, 'pull_request');
		assert.ok(failures.includes(`${CHANGE_DETECTOR}: failure`));
		assert.ok(failures.includes('build: skipped'));
	});

	it('fails a pull-request-only job skipped on a pull request', () => {
		const needs = allSucceeded();
		needs['docs-drift'] = { result: 'skipped', outputs: {} };
		assert.deepEqual(evaluateGate(needs, 'pull_request').failures, ['docs-drift: skipped']);
	});

	it('fails a failed or cancelled job', () => {
		const needs = allSucceeded();
		needs.e2e = { result: 'failure', outputs: {} };
		needs.audit = { result: 'cancelled', outputs: {} };
		assert.deepEqual(evaluateGate(needs, 'pull_request').failures, [
			'e2e: failure',
			'audit: cancelled',
		]);
	});
});

describe('evaluateGate: boundary', () => {
	it('fails when the detector output is missing rather than false', () => {
		const needs = docsOnlyPullRequest();
		needs[CHANGE_DETECTOR].outputs = {};
		assert.equal(evaluateGate(needs, 'pull_request').failures.length, CHANGE_SCOPED.length);
	});

	it('fails when the detector output is any other text than false', () => {
		const needs = docsOnlyPullRequest();
		needs[CHANGE_DETECTOR].outputs = { has_code_changes: '' };
		assert.equal(evaluateGate(needs, 'pull_request').failures.length, CHANGE_SCOPED.length);
	});

	it('fails a need the run does not report and a need the script does not list', () => {
		const needs = allSucceeded();
		delete needs['secret-scan'];
		needs['new-job'] = { result: 'success', outputs: {} };
		assert.deepEqual(evaluateGate(needs, 'pull_request').failures, [
			'new-job: not listed in scripts/ci-gate.mjs',
			'secret-scan: missing from the needs of this run',
		]);
	});
});

describe('main', () => {
	const quiet = (fn) => {
		const { log, error } = console;
		console.log = () => {};
		console.error = () => {};
		try {
			return fn();
		} finally {
			console.log = log;
			console.error = error;
		}
	};

	it('returns 0 for a passing run', () => {
		const env = { NEEDS: JSON.stringify(allSucceeded()), EVENT_NAME: 'pull_request' };
		assert.equal(
			quiet(() => main(env)),
			0,
		);
	});

	it('returns 1 when NEEDS is not JSON, not an object, or EVENT_NAME is unset', () => {
		const needs = JSON.stringify(allSucceeded());
		for (const env of [
			{ NEEDS: 'not json', EVENT_NAME: 'pull_request' },
			{ NEEDS: '[]', EVENT_NAME: 'pull_request' },
			{ NEEDS: 'null', EVENT_NAME: 'pull_request' },
			{ EVENT_NAME: 'pull_request' },
			{ NEEDS: needs },
		]) {
			assert.equal(
				quiet(() => main(env)),
				1,
				JSON.stringify(env),
			);
		}
	});
});

describe('ci.yml matches the lists', () => {
	const source = readFileSync(ciWorkflow, 'utf8');

	/** The text of one job, from its key to the next job key. */
	function jobBlock(job) {
		const start = source.indexOf(`\n  ${job}:\n`);
		assert.ok(start >= 0, `job ${job} not found in ci.yml`);
		const rest = source.slice(start + 1);
		const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
		return next < 0 ? rest : rest.slice(0, next + 1);
	}

	/** The job-level `if:` of one job, or undefined. */
	const jobIf = (job) => /\n {4}if: (.+)\n/.exec(jobBlock(job))?.[1].trim();

	it('the ci-gate job needs exactly the jobs the script lists', () => {
		const list = /\n {4}needs:\s*\[([^\]]*)\]/.exec(jobBlock('ci-gate'))?.[1];
		const names = (list ?? '')
			.split(',')
			.map((name) => name.trim())
			.filter((name) => name !== '');
		assert.deepEqual([...names].sort(), [...KNOWN_NEEDS].sort());
	});

	it('the ci-gate job runs the script with the needs and the event', () => {
		const gate = jobBlock('ci-gate');
		assert.match(gate, /\n {4}if: always\(\)\n/);
		assert.match(gate, /NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
		assert.match(gate, /EVENT_NAME: \$\{\{ github\.event_name \}\}/);
		assert.match(gate, /run: node scripts\/ci-gate\.mjs\n/);
	});

	it('every change-scoped job skips only on the detector output', () => {
		for (const job of CHANGE_SCOPED) {
			assert.equal(
				jobIf(job),
				"needs.detect-changes.outputs.has_code_changes == 'true' || github.event_name == 'push'",
				job,
			);
		}
	});

	it('every event-scoped job skips only on its event', () => {
		for (const [job, event] of Object.entries(EVENT_SCOPED)) {
			assert.equal(jobIf(job), `github.event_name == '${event}'`, job);
		}
	});

	it('every must-succeed job has no condition', () => {
		for (const job of MUST_SUCCEED) assert.equal(jobIf(job), undefined, job);
	});
});
