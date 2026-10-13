// Tests scripts/workflow-issue.sh against a stub `gh` recording calls,
// and asserts refresh-upstream-docs.yml configures the report job.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const issueScript = join(fileURLToPath(new URL('.', import.meta.url)), 'workflow-issue.sh');
const workflowPath = join(
	fileURLToPath(new URL('.', import.meta.url)),
	'..',
	'.github',
	'workflows',
	'refresh-upstream-docs.yml',
);

const dirs = [];

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Runs scripts/workflow-issue.sh with a stub `gh` and refresh-upstream env.
 * `open` is the issue number returned by `gh issue list`, or '' for none.
 */
function runIssue(status, open, envOverrides = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'workflow-issue-'));
	dirs.push(dir);
	const log = join(dir, 'calls');
	writeFileSync(
		join(dir, 'gh'),
		`#!/bin/bash\nprintf '%s\\n' "$*" >> "${log}"\nif [[ "$1 $2" == "issue list" ]]; then printf '%s' "${open}"; fi\n`,
	);
	chmodSync(join(dir, 'gh'), 0o755);
	const env = {
		PATH: `${dir}:${process.env.PATH ?? ''}`,
		GITHUB_REPOSITORY: 'o/r',
		TITLE: 'refresh-upstream-docs failed on main',
		LABEL: 'workflow-failure',
		LABEL_COLOR: 'd93f0b',
		LABEL_DESCRIPTION: 'A scheduled workflow failed on main',
		STATUS: status,
		RUN: 'https://example.invalid/run/1',
		FAIL_BODY:
			'The refresh-upstream-docs workflow failed in $RUN. The next passing run closes this issue.',
		REPEAT_COMMENT: 'The refresh-upstream-docs workflow failed again in $RUN.',
		PASS_COMMENT: 'The refresh-upstream-docs workflow succeeded in $RUN.',
		...envOverrides,
	};
	if (status === undefined) {
		delete env.STATUS;
	}
	const result = spawnSync('bash', [issueScript], {
		encoding: 'utf8',
		timeout: 10_000,
		env,
	});
	const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
	return {
		status: result.status,
		stderr: result.stderr,
		calls,
	};
}

describe('workflow-issue.sh with refresh-upstream env', () => {
	it('creates an issue on failure when none is open', () => {
		const { status, calls } = runIssue('failure', '');
		assert.equal(status, 0);
		assert.deepEqual(calls.slice(2), [
			'issue create --repo o/r --title refresh-upstream-docs failed on main --label workflow-failure --body The refresh-upstream-docs workflow failed in https://example.invalid/run/1. The next passing run closes this issue.',
		]);
	});

	it('comments on open issue on repeated failure', () => {
		const { status, calls } = runIssue('failure', '42');
		assert.equal(status, 0);
		assert.deepEqual(calls.slice(2), [
			'issue comment 42 --repo o/r --body The refresh-upstream-docs workflow failed again in https://example.invalid/run/1.',
		]);
	});

	it('closes open issue on success', () => {
		const { status, calls } = runIssue('success', '42');
		assert.equal(status, 0);
		assert.deepEqual(calls.slice(2), [
			'issue close 42 --repo o/r --comment The refresh-upstream-docs workflow succeeded in https://example.invalid/run/1.',
		]);
	});

	it('makes no issue calls on success when none is open', () => {
		const { status, calls } = runIssue('success', '');
		assert.equal(status, 0);
		assert.deepEqual(calls.slice(2), []);
	});

	it('exits non-zero with no issue calls when STATUS is empty', () => {
		const { status, calls } = runIssue('', '');
		assert.notEqual(status, 0);
		assert.deepEqual(calls, []);
	});

	it('exits non-zero with no issue calls when STATUS is other', () => {
		for (const bad of ['cancelled', 'other', 'unknown', 'skipped']) {
			const { status, calls } = runIssue(bad, '');
			assert.notEqual(status, 0, `expected non-zero for ${bad}`);
			assert.deepEqual(calls, [], `expected no calls for ${bad}`);
		}
	});

	it('exits non-zero with no issue calls when STATUS is unset', () => {
		const { status, calls } = runIssue(undefined, '');
		assert.notEqual(status, 0);
		assert.deepEqual(calls, []);
	});
});

describe('refresh-upstream-docs.yml report job', () => {
	it('runs scripts/workflow-issue.sh with if: always() guard', () => {
		const content = readFileSync(workflowPath, 'utf8');
		const start = content.indexOf('\n  report:\n');
		assert.ok(start >= 0, 'report job not found');
		const reportSection = content.slice(start);
		assert.match(reportSection, /needs:\s*drift-check/, 'report job must wait for drift-check');
		assert.match(
			reportSection,
			/STATUS:\s*\$\{\{\s*needs\.drift-check\.result\s*\}\}/,
			'report job must pass the drift-check result as STATUS',
		);
		assert.match(
			reportSection,
			/if:\s*always\(\)/,
			'report job must guard execution with always()',
		);
		assert.match(
			reportSection,
			/run:\s*bash\s+scripts\/workflow-issue\.sh/,
			'report job must run scripts/workflow-issue.sh',
		);
	});
});
