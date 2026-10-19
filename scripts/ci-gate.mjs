#!/usr/bin/env node
// Decides the CI Gate: the one required check that stands for every job in ci.yml.
//
// The gate used to fail only when a need had failed or was cancelled, so a need
// that was skipped counted as passed whatever skipped it: a typo in an `if:`, a
// change detector that wrote no output, a scan job switched off. Here every need
// must succeed, and a skip is accepted only for the jobs listed below and only
// when the reason it was skipped is visible in the same run:
//
//   - CHANGE_SCOPED jobs run when Detect Changes reports code changes, and on
//     every push. A skip counts only on a non-push event, with Detect Changes
//     succeeded and its output `has_code_changes` exactly `false`.
//   - EVENT_SCOPED jobs run on one event only. A skip counts only on another
//     event.
//   - Every other need must succeed.
//
// The lists must name exactly the needs of the ci-gate job, and each job's `if:`
// must match its list; scripts/ci-gate.test.mjs reads ci.yml and fails when
// they drift apart.
//
// Input: NEEDS = `${{ toJSON(needs) }}`, EVENT_NAME = `${{ github.event_name }}`.
// Input that cannot be read fails the gate.
import { pathToFileURL } from 'node:url';

export const CHANGE_DETECTOR = 'detect-changes';

export const CHANGE_SCOPED = Object.freeze([
	'lint',
	'typecheck',
	'test',
	'build',
	'stories',
	'e2e',
	'audit',
]);

export const EVENT_SCOPED = Object.freeze({
	'pr-title': 'pull_request',
	'docs-drift': 'pull_request',
});

export const MUST_SUCCEED = Object.freeze([
	CHANGE_DETECTOR,
	'secret-scan',
	'dependency-scan',
	'semgrep',
]);

/** Every need the gate knows, in the order the lists above name them. */
export const KNOWN_NEEDS = Object.freeze([
	...MUST_SUCCEED,
	...CHANGE_SCOPED,
	...Object.keys(EVENT_SCOPED),
]);

/** Why a skipped CHANGE_SCOPED job is accepted, or null when it is not. */
function changeScopedSkipReason(needs, event) {
	if (event === 'push') return null;
	const detector = needs[CHANGE_DETECTOR];
	if (detector?.result !== 'success') return null;
	if (detector.outputs?.has_code_changes !== 'false') return null;
	return `${CHANGE_DETECTOR} reported no code changes`;
}

/** Why a skipped job is accepted, or null when it is not. */
function skipReason(job, needs, event) {
	if (CHANGE_SCOPED.includes(job)) return changeScopedSkipReason(needs, event);
	const runsOn = EVENT_SCOPED[job];
	if (runsOn !== undefined && event !== runsOn) return `runs on ${runsOn} only`;
	return null;
}

/**
 * Judges the needs of one run.
 *
 * @param {Record<string, { result?: string, outputs?: Record<string, string> }>} needs
 * @param {string} event
 * @returns {{ passed: string[], failures: string[] }}
 */
export function evaluateGate(needs, event) {
	const passed = [];
	const failures = [];
	for (const job of Object.keys(needs)) {
		if (!KNOWN_NEEDS.includes(job)) failures.push(`${job}: not listed in scripts/ci-gate.mjs`);
	}
	for (const job of KNOWN_NEEDS) {
		const result = needs[job]?.result;
		if (result === undefined) {
			failures.push(`${job}: missing from the needs of this run`);
		} else if (result === 'success') {
			passed.push(`${job}: success`);
		} else if (result === 'skipped' && skipReason(job, needs, event) !== null) {
			passed.push(`${job}: skipped, ${skipReason(job, needs, event)}`);
		} else {
			failures.push(`${job}: ${result}`);
		}
	}
	return { passed, failures };
}

/** Returns the exit code: 0 when every need succeeded or was skipped for a stated reason. */
export function main(env = process.env) {
	const event = env.EVENT_NAME ?? '';
	let needs;
	try {
		needs = JSON.parse(env.NEEDS ?? '');
	} catch (error) {
		console.error(`::error::NEEDS is not JSON: ${error.message}`);
		return 1;
	}
	if (event === '' || needs === null || typeof needs !== 'object' || Array.isArray(needs)) {
		console.error('::error::NEEDS must be a JSON object and EVENT_NAME must be set.');
		return 1;
	}
	const { passed, failures } = evaluateGate(needs, event);
	for (const line of passed) console.log(line);
	for (const line of failures) console.error(`::error::${line}`);
	return failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = main();
}
