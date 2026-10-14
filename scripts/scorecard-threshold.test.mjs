// Runs scorecard-threshold.mjs against planted Scorecard API results, and the
// issue step of scorecard.yml against a stub `gh` that records its calls.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { judge, runThreshold } from './scorecard-threshold.mjs';

const SHA = 'c6012c019fcde69fed2f64c05471db47d285879c';
const OLD = '27bbf93000000000000000000000000000000000';
const published = (score, commit = SHA) => ({ score, repo: { name: 'github.com/o/r', commit } });
const env = (threshold = '7') => ({
	REPOSITORY: 'github.com/o/r',
	COMMIT: SHA,
	THRESHOLD: threshold,
});

/** Runs the script with results served in order; the last one repeats. */
async function run(results, threshold) {
	const urls = [];
	const lines = [];
	const code = await runThreshold(env(threshold), {
		fetchResult: async (url) => {
			urls.push(url);
			return results[Math.min(urls.length, results.length) - 1];
		},
		delayMs: 0,
		log: (line) => lines.push(line),
	});
	return { code, urls, lines };
}

describe('judge', () => {
	it('passes a score above the threshold', () => {
		assert.equal(judge(published(7.4), { commit: SHA, threshold: 7 }).verdict, 'pass');
	});

	it('passes a score equal to the threshold', () => {
		assert.equal(judge(published(7), { commit: SHA, threshold: 7 }).verdict, 'pass');
	});

	it('fails a score just below the threshold', () => {
		assert.deepEqual(judge(published(6.9), { commit: SHA, threshold: 7 }), {
			verdict: 'fail',
			message: `Scorecard score 6.9 is below 7 at ${SHA}`,
		});
	});

	it('calls a result for another commit stale', () => {
		assert.equal(judge(published(9, OLD), { commit: SHA, threshold: 7 }).verdict, 'stale');
	});

	it('fails a result without a commit, a score, or any object', () => {
		assert.equal(judge({ score: 8 }, { commit: SHA, threshold: 7 }).verdict, 'fail');
		assert.equal(judge(published('8'), { commit: SHA, threshold: 7 }).verdict, 'fail');
		assert.equal(judge(published(Number.NaN), { commit: SHA, threshold: 7 }).verdict, 'fail');
		assert.equal(judge(null, { commit: SHA, threshold: 7 }).verdict, 'fail');
	});
});

describe('runThreshold', () => {
	it('exits 0 on the published 7.4 with threshold 7', async () => {
		const { code, urls } = await run([published(7.4)], '7');
		assert.equal(code, 0);
		assert.deepEqual(urls, ['https://api.scorecard.dev/projects/github.com/o/r']);
	});

	it('exits 1 on the same result with a planted threshold of 9', async () => {
		const { code, lines } = await run([published(7.4)], '9');
		assert.equal(code, 1);
		assert.match(lines.at(-1) ?? '', /score 7\.4 is below 9/);
	});

	it('fetches again while the result is for another commit', async () => {
		const { code, urls } = await run([published(9, OLD), published(9, OLD), published(7.4)], '7');
		assert.equal(code, 0);
		assert.equal(urls.length, 3);
	});

	it('gives up after six stale results and fails', async () => {
		const { code, urls, lines } = await run([published(9, OLD)], '7');
		assert.equal(code, 1);
		assert.equal(urls.length, 6);
		assert.match(lines.at(-1) ?? '', /is for 27bbf93/);
	});

	it('exits 2 without a usable threshold, commit or repository', async () => {
		for (const bad of [
			{ ...env(), THRESHOLD: undefined },
			{ ...env(), THRESHOLD: '' },
			{ ...env(), THRESHOLD: 'seven' },
			{ ...env(), THRESHOLD: '11' },
			{ ...env(), COMMIT: '' },
			{ ...env(), REPOSITORY: undefined },
		]) {
			const code = await runThreshold(bad, {
				fetchResult: () => assert.fail('no fetch without usable input'),
				log: () => {},
			});
			assert.equal(code, 2, JSON.stringify(bad));
		}
	});
});

const issueScript = join(fileURLToPath(new URL('.', import.meta.url)), 'workflow-issue.sh');
const dirs = [];

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Runs scripts/workflow-issue.sh with a stub `gh` on PATH and scorecard env.
 * `open` is the issue number the stub's `issue list` prints, or '' for none.
 * Returns the recorded calls after label creation and issue list.
 */
function runIssueStep(status, open) {
	const dir = mkdtempSync(join(tmpdir(), 'scorecard-issue-'));
	dirs.push(dir);
	const log = join(dir, 'calls');
	writeFileSync(
		join(dir, 'gh'),
		`#!/bin/bash\nprintf '%s\\n' "$*" >> "${log}"\nif [[ "$1 $2" == "issue list" ]]; then printf '%s' "${open}"; fi\n`,
	);
	chmodSync(join(dir, 'gh'), 0o755);
	const result = spawnSync('bash', [issueScript], {
		encoding: 'utf8',
		timeout: 10_000,
		env: {
			PATH: `${dir}:${process.env.PATH ?? ''}`,
			GITHUB_REPOSITORY: 'o/r',
			TITLE: 'OpenSSF Scorecard score below 7 on main',
			LABEL: 'scorecard',
			LABEL_COLOR: 'd93f0b',
			LABEL_DESCRIPTION:
				'The OpenSSF Scorecard score on main is below the threshold in scorecard.yml',
			STATUS: status,
			RUN: 'https://example.invalid/run/1',
			FAIL_BODY:
				'The threshold job in scorecard.yml failed in $RUN: the published score is below 7, or no published result matches the commit. The next passing run closes this issue.',
			REPEAT_COMMENT: 'Still below the threshold, or no result for this commit: $RUN',
			PASS_COMMENT: 'Score back at or above the threshold: $RUN',
		},
	});
	assert.equal(result.status, 0, result.stderr);
	return readFileSync(log, 'utf8').trim().split('\n').slice(2);
}

describe('scorecard.yml issue step', () => {
	it('opens one issue on a failure with none open', () => {
		const calls = runIssueStep('failure', '');
		assert.equal(calls.length, 1);
		assert.match(
			calls[0],
			/^issue create --repo o\/r --title OpenSSF Scorecard score below 7 on main --label scorecard /,
		);
	});

	it('comments on the open issue on a repeated failure', () => {
		assert.deepEqual(runIssueStep('failure', '41'), [
			'issue comment 41 --repo o/r --body Still below the threshold, or no result for this commit: https://example.invalid/run/1',
		]);
	});

	it('closes the open issue on a pass', () => {
		assert.deepEqual(runIssueStep('success', '41'), [
			'issue close 41 --repo o/r --comment Score back at or above the threshold: https://example.invalid/run/1',
		]);
	});

	it('does nothing more on a pass with no issue open', () => {
		assert.deepEqual(runIssueStep('success', ''), []);
	});
});
