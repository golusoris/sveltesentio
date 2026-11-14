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
// Docker is tried first, then Podman. Without either, the check fails in CI
// (`CI=true`) and is skipped with a stated reason elsewhere; the CI job
// `Renovate configuration` runs it on every pull request.
//
// `pnpm test:scripts` runs the unit tests; `pnpm check:renovate-config` runs
// this check.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export const RENOVATE_IMAGE =
	'ghcr.io/renovatebot/renovate:44.227.4@sha256:fe058db9710840a4821f20190b3769e3ce709a049b8640aa2bf5f044969fe702';

export const CONFIG_FILE = 'renovate.json',
	PLANTED_FILE = 'scripts/check-renovate-config.planted.json',
	PLANTED_MESSAGE = 'Invalid packageRules[0].matchUpdateTypes',
	ACCEPTED_MESSAGE = 'Config validated successfully',
	RE2_FALLBACK_MESSAGE = 'RE2 not usable',
	RUNTIMES = Object.freeze(['docker', 'podman']);

// Deadlines on every child process, and bounds on what one run keeps (HISS-02).
export const PROBE_TIMEOUT_MS = 20_000,
	PULL_TIMEOUT_MS = 600_000,
	VALIDATE_TIMEOUT_MS = 120_000,
	OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024,
	EXCERPT_LINES = 40;

/** Runs one child process with a deadline; output is stdout and stderr joined. */
export function run(file, args, { timeout }) {
	const result = spawnSync(file, args, {
		env: { ...process.env, NO_COLOR: '1' },
		timeout,
		encoding: 'utf8',
		maxBuffer: OUTPUT_LIMIT_BYTES,
		windowsHide: true,
	});
	return {
		status: result.status,
		signal: result.signal,
		error: result.error,
		output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
	};
}

/** The last lines of a run's output, enough to read the validator's verdict. */
export function excerpt(output) {
	return output.trimEnd().split('\n').slice(-EXCERPT_LINES).join('\n');
}

/** Why a child process did not finish on its own, or null when it did. */
export function stopProblem(label, result) {
	if (result.error) return `${label} did not run: ${result.error.message}`;
	if (result.signal) return `${label} was stopped by ${result.signal} before it finished`;
	return null;
}

/** The first container runtime whose engine answers, or null when none does. */
export function findRuntime(runner = run) {
	for (const runtime of RUNTIMES) {
		const format = runtime === 'docker' ? '{{.Server.Version}}' : '{{.Version}}';
		const result = runner(runtime, ['version', '--format', format], { timeout: PROBE_TIMEOUT_MS });
		if (stopProblem(runtime, result) === null && result.status === 0) return runtime;
	}
	return null;
}

/**
 * The `--mount` value binding the repository read-only at /repo. The value is
 * comma-separated, so a source path holding a comma or quote is quoted the
 * way that format reads it.
 */
export function mountArgument(rootDir) {
	const source = /[",]/.test(rootDir)
		? `"source=${rootDir.replaceAll('"', '""')}"`
		: `source=${rootDir}`;
	return `type=bind,${source},target=/repo,readonly`;
}

/** The runtime arguments that validate one repository-relative file. */
export function validatorArgs(rootDir, file) {
	return [
		'run',
		'--rm',
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

/** Pulls the pinned image unless the runtime already holds it. */
export function ensureImage(runtime, runner = run) {
	const inspect = runner(runtime, ['image', 'inspect', '--format', '{{.Id}}', RENOVATE_IMAGE], {
		timeout: PROBE_TIMEOUT_MS,
	});
	if (stopProblem('inspect', inspect) === null && inspect.status === 0) return [];
	const label = `${runtime} pull ${RENOVATE_IMAGE}`;
	const pull = runner(runtime, ['pull', '--quiet', RENOVATE_IMAGE], { timeout: PULL_TIMEOUT_MS });
	const stopped = stopProblem(label, pull);
	if (stopped) return [stopped];
	if (pull.status !== 0) return [`${label} exited ${pull.status}\n${excerpt(pull.output)}`];
	return [];
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

function checkRepository(rootDir, runner, env) {
	const runtime = findRuntime(runner);
	if (runtime === null) {
		const reason = `neither ${RUNTIMES.join(' nor ')} answers, so the pinned Renovate image cannot run`;
		return env.CI === 'true' ? { problems: [reason] } : { problems: [], skipped: reason };
	}
	const problems = ensureImage(runtime, runner);
	if (problems.length > 0) return { problems };
	for (const [file, expectAccepted] of [
		[CONFIG_FILE, true],
		[PLANTED_FILE, false],
	]) {
		const result = runner(runtime, validatorArgs(rootDir, file), { timeout: VALIDATE_TIMEOUT_MS });
		problems.push(...judgeValidation(file, expectAccepted, result));
	}
	return { problems, runtime };
}

/** Returns the exit code: 0 when renovate.json validates and the planted rule is refused. */
export function main(rootDir = root, runner = run, env = process.env) {
	const outcome = checkRepository(rootDir, runner, env);
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
