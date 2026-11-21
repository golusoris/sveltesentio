#!/usr/bin/env node
// Fails unless renovate-config-validator, from the Renovate image pinned by
// digest below, accepts renovate.json and refuses the planted rule in
// scripts/check-renovate-config.planted.json.
//
// Renovate refuses a configuration it cannot validate, and it does so only on
// its own server. From 2026-10-22 it refused renovate.json because
// packageRules[0] matched the update type `vulnerability`, which Renovate does
// not accept (issue 447). For three weeks no update or security pull request
// opened, and nothing in this repository failed. This check runs the same
// validator before merge.
//
// It fails closed. A planted rule the validator accepts means this validator
// would not catch that regression either. A validator that reports
// `RE2 not usable` checks regular expressions with RegExp instead, which
// refuses the `(?m)` customManagers patterns Renovate's server accepts.
//
// The validator runs from Renovate's own image rather than an npm install: a
// committed lockfile for the renovate package would put its transitive tree,
// which carries advisories Renovate has not fixed, in front of Dependabot as
// alerts against this repository. The image is pinned by digest, runs with no
// network and a read-only mount, and Renovate updates the pin through the
// customManagers entry in renovate.json that matches this file.
//
// The image runs as uid 12021, which cannot read the bind mount of an
// owner-only (mode 700) checkout; the validator then reports `File does not
// exist` and exits 1, which reads as a refused configuration. Every container
// of this check therefore runs as the caller through `userArgs` from
// container-check.mjs (`--user uid:gid` for Docker, `--userns=keep-id` for
// Podman), as the workflow check does. A read probe before the validations is
// the second barrier: when the validator still cannot read both files, the
// check fails naming the checkout, its mode, the runtime and the validator uid,
// and runs no validation.
//
// Docker is tried first, then Podman. Without either, the check fails in CI
// (`CI=true`) and is skipped with a stated reason elsewhere; the CI job
// `Renovate configuration` runs it on every pull request.
//
// `pnpm test:scripts` runs the unit tests; `pnpm check:renovate-config` runs
// this check.
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	RUNTIMES,
	PROBE_TIMEOUT_MS,
	PULL_TIMEOUT_MS,
	currentIds,
	ensureImage as ensureContainerImage,
	excerpt,
	findRuntime,
	mountArgument,
	removeStopped,
	run,
	stopProblem,
	userArgs,
} from './container-check.mjs';

// Every name this module exported before the helpers moved stays exported.
export {
	EXCERPT_LINES,
	OUTPUT_LIMIT_BYTES,
	PROBE_TIMEOUT_MS,
	PULL_TIMEOUT_MS,
	RUNTIMES,
	excerpt,
	findRuntime,
	mountArgument,
	removeStopped,
	run,
	stopProblem,
} from './container-check.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export const RENOVATE_IMAGE =
	'ghcr.io/renovatebot/renovate:44.252.7@sha256:da2082c34a7e8aee0fbf50122d71a052ba32ea5f51aeded502b742ad7bc9d5a2';

export const CONFIG_FILE = 'renovate.json',
	PLANTED_FILE = 'scripts/check-renovate-config.planted.json',
	PLANTED_MESSAGE = 'Invalid packageRules[0].matchUpdateTypes',
	ACCEPTED_MESSAGE = 'Config validated successfully',
	RE2_FALLBACK_MESSAGE = 'RE2 not usable';

export const VALIDATE_TIMEOUT_MS = 120_000;

// These container runs do trivial work (read probe, uid run), so cold start dominates.
// Measured 46 882 ms at load 43 on 32 cores (2026-11-19); allow about twice that.
// PROBE_TIMEOUT_MS stays for runtime client calls; every child keeps a deadline (HISS-02).
export const CONTAINER_PROBE_TIMEOUT_MS = 100_000;

/**
 * Every child deadline one run can reach: a probe per runtime, the image inspect, the pull,
 * and the read probe. After the read probe, success runs two validations with cleanup
 * (2 x (VALIDATE + PROBE) = 280 s); a stopped probe runs only its cleanup (PROBE = 20 s);
 * a nonzero exit runs the uid check and its cleanup (CONTAINER_PROBE + PROBE = 120 s).
 * The validations are longest, so the bound is (RUNTIMES.length + 1) x PROBE + PULL +
 * CONTAINER_PROBE + 2 x (VALIDATE + PROBE). The CI job's timeout-minutes must cover it.
 */
export const WORST_CASE_MS =
	(RUNTIMES.length + 1) * PROBE_TIMEOUT_MS +
	PULL_TIMEOUT_MS +
	2 * (VALIDATE_TIMEOUT_MS + PROBE_TIMEOUT_MS) +
	CONTAINER_PROBE_TIMEOUT_MS;

/** The runtime arguments that validate one repository-relative file. */
export function validatorArgs(rootDir, file, name, user = []) {
	return [
		'run',
		'--rm',
		'--name',
		name,
		'--network',
		'none',
		'--read-only',
		'--tmpfs',
		'/tmp',
		'--security-opt',
		'label=disable',
		'--env',
		'LOG_LEVEL=info',
		'--env',
		'NO_COLOR=1',
		...user,
		'--mount',
		mountArgument(rootDir),
		'--workdir',
		'/repo',
		'--entrypoint',
		'renovate-config-validator',
		RENOVATE_IMAGE,
		'--strict',
		'--no-global',
		file,
	];
}

/** Tests readability under the same mount and user as the validator. */
export function probeArgs(rootDir, name, user = []) {
	return [
		'run',
		'--rm',
		'--name',
		name,
		'--network',
		'none',
		'--read-only',
		'--security-opt',
		'label=disable',
		...user,
		'--mount',
		mountArgument(rootDir),
		'--workdir',
		'/repo',
		'--entrypoint',
		'/usr/bin/test',
		RENOVATE_IMAGE,
		'-r',
		`/repo/${CONFIG_FILE}`,
		'-a',
		'-r',
		`/repo/${PLANTED_FILE}`,
	];
}

/** Explains a mount that the image user cannot read. */
export function mountProblem(rootDir, runtime, uid, stat = statSync) {
	let mode;
	try {
		mode = (stat(rootDir).mode & 0o777).toString(8);
	} catch (error) {
		// The diagnostic stays useful without the mode; it names why stat failed instead.
		mode = `unknown (${error?.code ?? error?.message ?? String(error)})`;
	}
	return `renovate-config-validator cannot read the repository mounted at /repo: ${rootDir} has mode ${mode} and the validator runs as uid ${uid} under ${runtime}, so it would report "File does not exist" rather than validate; give that uid read access to the checkout, e.g. mode 755, or run where the runtime maps the caller's IDs`;
}

function validatorUid(runtime, user, runner) {
	const name = `renovate-config-id-${process.pid}-${randomUUID().slice(0, 8)}`;
	const args = [
		'run',
		'--rm',
		'--name',
		name,
		'--network',
		'none',
		'--read-only',
		'--entrypoint',
		'/usr/bin/id',
		...user,
		RENOVATE_IMAGE,
		'-u',
	];
	const result = runner(runtime, args, { timeout: CONTAINER_PROBE_TIMEOUT_MS });
	const cleanup = removeStopped(runtime, name, 'validator uid', result, runner);
	const output = result.output.trim();
	const uid =
		!stopProblem('validator uid', result) && result.status === 0 && /^\d+$/.test(output)
			? output
			: 'unknown';
	return { uid, cleanup };
}

function checkMount(rootDir, runtime, user, runner, stat) {
	const name = `renovate-config-probe-${process.pid}-${randomUUID().slice(0, 8)}`;
	const result = runner(runtime, probeArgs(rootDir, name, user), {
		timeout: CONTAINER_PROBE_TIMEOUT_MS,
	});
	const stopped = stopProblem('renovate-config read probe', result, CONTAINER_PROBE_TIMEOUT_MS);
	const cleanup = removeStopped(runtime, name, 'renovate-config read probe', result, runner);
	if (stopped) return [stopped, ...cleanup];
	if (result.status === 0) return cleanup;
	const { uid, cleanup: idCleanup } = validatorUid(runtime, user, runner);
	return [mountProblem(rootDir, runtime, uid, stat), ...cleanup, ...idCleanup];
}

/** Pulls the pinned image unless the runtime already holds it. */
export function ensureImage(runtime, runner = run) {
	return ensureContainerImage(runtime, RENOVATE_IMAGE, runner);
}

function acceptedProblem(label, result) {
	if (result.status === 0 && result.output.includes(ACCEPTED_MESSAGE)) return null;
	return `${label}: Renovate refuses this configuration (exit ${result.status})\n${excerpt(result.output)}`;
}

function refusedProblem(label, result) {
	if (result.status !== 0 && result.output.includes(PLANTED_MESSAGE)) return null;
	return (
		`${label}: the planted rule was not refused with "${PLANTED_MESSAGE}" (exit ${result.status}), ` +
		`so this validator would not catch the regression the check exists for\n${excerpt(result.output)}`
	);
}

/**
 * Judges one validator run. `expectAccepted` true: the file must validate;
 * false: the planted rule must be refused for the reason it was planted.
 */
export function judgeValidation(file, expectAccepted, result) {
	const label = `renovate-config-validator ${file}`;
	const stopped = stopProblem(label, result);
	if (stopped) return [stopped];
	const problems = [];
	if (result.output.includes(RE2_FALLBACK_MESSAGE)) {
		problems.push(
			`${label}: the validator ran without RE2 and checks regular expressions with RegExp, ` +
				`which Renovate's server does not`,
		);
	}
	const verdict = expectAccepted ? acceptedProblem(label, result) : refusedProblem(label, result);
	if (verdict) problems.push(verdict);
	return problems;
}

function checkRepository(rootDir, runner, env, ids, stat) {
	const runtime = findRuntime(runner);
	if (runtime === null) {
		const reason = `neither ${RUNTIMES.join(' nor ')} answers, so the pinned Renovate image cannot run`;
		return env.CI === 'true' ? { problems: [reason] } : { problems: [], skipped: reason };
	}
	const problems = ensureImage(runtime, runner);
	if (problems.length > 0) return { problems };
	const user = userArgs(runtime, ids);
	problems.push(...checkMount(rootDir, runtime, user, runner, stat));
	if (problems.length > 0) return { problems };
	for (const [file, expectAccepted] of [
		[CONFIG_FILE, true],
		[PLANTED_FILE, false],
	]) {
		const name = `renovate-config-check-${process.pid}-${randomUUID().slice(0, 8)}`;
		const result = runner(runtime, validatorArgs(rootDir, file, name, user), {
			timeout: VALIDATE_TIMEOUT_MS,
		});
		problems.push(...judgeValidation(file, expectAccepted, result));
		problems.push(...removeStopped(runtime, name, file, result, runner));
	}
	return { problems, runtime };
}

/** Returns the exit code: 0 when renovate.json validates and the planted rule is refused. */
export function main(
	rootDir = root,
	runner = run,
	env = process.env,
	ids = currentIds(),
	stat = statSync,
) {
	const outcome = checkRepository(resolve(rootDir), runner, env, ids, stat);
	for (const problem of outcome.problems) console.error(`FAIL: ${problem}`);
	if (outcome.problems.length > 0) return 1;
	if (outcome.skipped) {
		console.warn(`SKIP: Renovate configuration not checked: ${outcome.skipped}; CI runs it.`);
		return 0;
	}
	console.log(
		`OK: ${RENOVATE_IMAGE.split('@')[0]} (${outcome.runtime}) accepts ${CONFIG_FILE} and refuses the planted rule in ${PLANTED_FILE}.`,
	);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = main(process.argv[2] ?? root);
}
