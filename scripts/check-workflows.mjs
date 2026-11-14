#!/usr/bin/env node
// In PR 567 a review bot, not a check, found workflow jobs without steps: nothing
// in this repository ran actionlint.
// This check lints every workflow and first requires actionlint to refuse a planted
// workflow for missing steps, a shellcheck finding and a needs entry naming no job.
// Missing shellcheck or a silently weakened linter therefore fails closed.
//
// The check lists .github/workflows itself and names each file and the
// configuration to actionlint. Without a .git directory, actionlint finds no
// project: a run without arguments exits 3, and named files lose the
// configuration's runner labels.
//
// The image is pinned by digest; Renovate updates it through the customManagers
// entry matching this file. Docker is tried first, then Podman. Without either,
// CI=true fails; elsewhere the check prints SKIP with a reason. Containers run
// offline with a read-only mount and the checkout owner's identity.
//
// `pnpm check:workflows` runs this check; `pnpm test:scripts` runs its unit tests.
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	RUNTIMES,
	PROBE_TIMEOUT_MS,
	PULL_TIMEOUT_MS,
	currentIds,
	ensureImage,
	excerpt,
	findRuntime,
	mountArgument,
	removeStopped,
	run,
	stopProblem,
	userArgs,
} from './container-check.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export const ACTIONLINT_IMAGE =
	'docker.io/rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667';
export const PLANTED_FILE = 'scripts/check-workflows.planted.yml';
export const PLANTED_MARKERS = Object.freeze([
	'"steps" section is missing in job',
	'[shellcheck]',
	'[job-needs]',
]);
export const LINT_TIMEOUT_MS = 120_000;
export const WORKFLOW_DIR = '.github/workflows';
export const CONFIG_FILE = '.github/actionlint.yaml';
/** Entries one listing of WORKFLOW_DIR may hold (HISS-02). */
export const MAX_WORKFLOWS = 256;

/** Every child deadline, including two lint runs with cleanup; CI adds setup time. */
export const WORST_CASE_MS =
	(RUNTIMES.length + 1) * PROBE_TIMEOUT_MS +
	PULL_TIMEOUT_MS +
	2 * (LINT_TIMEOUT_MS + PROBE_TIMEOUT_MS);

/**
 * Every .yml or .yaml name directly in WORKFLOW_DIR, sorted. The extension match
 * ignores case, so a file GitHub might read is linted rather than skipped.
 */
export function workflowFiles(rootDir, list = readdirSync) {
	let names;
	try {
		names = list(join(rootDir, WORKFLOW_DIR));
	} catch (error) {
		return { problems: [`cannot list ${WORKFLOW_DIR}: ${error.message}`] };
	}
	if (names.length > MAX_WORKFLOWS) {
		return {
			problems: [
				`${WORKFLOW_DIR} holds ${names.length} entries, more than MAX_WORKFLOWS (${MAX_WORKFLOWS})`,
			],
		};
	}
	const files = names
		.filter((name) => /\.ya?ml$/i.test(name))
		.sort()
		.map((name) => `${WORKFLOW_DIR}/${name}`);
	if (files.length === 0) {
		return {
			problems: [`${WORKFLOW_DIR} holds no .yml or .yaml file, so nothing would be linted`],
		};
	}
	return { problems: [], files };
}

/** Runtime arguments linting the named files with the repository configuration. */
export function linterArgs(rootDir, name, files, user) {
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
		...user,
		'--mount',
		mountArgument(rootDir),
		'--workdir',
		'/repo',
		'--entrypoint',
		'/usr/local/bin/actionlint',
		ACTIONLINT_IMAGE,
		'-no-color',
		'-oneline',
		'-config-file',
		CONFIG_FILE,
		...files,
	];
}

/** Requires exit 1 and every planted diagnostic, including shellcheck. */
function plantedProblem(label, result) {
	const missing = PLANTED_MARKERS.filter(
		(marker) => result.status !== 1 || !result.output.includes(marker),
	);
	if (missing.length === 0) return [];
	return [
		`${label}: the planted workflow was not refused with ${missing.join(', ')} ` +
			`(exit ${result.status}), so this check would not catch the regression it exists for\n` +
			excerpt(result.output),
	];
}

/** Judges a repository lint or requires the planted workflow's exact failure class. */
export function judgeLint(label, expectClean, result) {
	const stopped = stopProblem(label, result);
	if (stopped) return [stopped];
	if (!expectClean) return plantedProblem(label, result);
	if (result.status === 0) return [];
	const reason =
		result.status === 1
			? 'actionlint reports problems in .github/workflows (exit 1)'
			: `actionlint failed (exit ${result.status}), so .github/workflows was not checked`;
	return [`${label}: ${reason}\n${excerpt(result.output)}`];
}

/** Lists the workflows, finds the runtime, prepares its image and lints the planted file first. */
function checkRepository(rootDir, runner, env, ids, list) {
	const listed = workflowFiles(rootDir, list);
	if (listed.problems.length > 0) return { problems: listed.problems };
	const runtime = findRuntime(runner);
	if (runtime === null) {
		const reason = `neither ${RUNTIMES.join(' nor ')} answers, so the pinned actionlint image cannot run`;
		return env.CI === 'true' ? { problems: [reason] } : { problems: [], skipped: reason };
	}
	const problems = ensureImage(runtime, ACTIONLINT_IMAGE, runner);
	if (problems.length > 0) return { problems };
	// Exactly two runs bound the fan-out and total deadline (HISS-02).
	for (const [files, expectClean] of [
		[[PLANTED_FILE], false],
		[listed.files, true],
	]) {
		const name = `workflow-lint-check-${process.pid}-${randomUUID().slice(0, 8)}`;
		const label = `actionlint ${expectClean ? WORKFLOW_DIR : PLANTED_FILE}`;
		const result = runner(runtime, linterArgs(rootDir, name, files, userArgs(runtime, ids)), {
			timeout: LINT_TIMEOUT_MS,
		});
		problems.push(...judgeLint(label, expectClean, result));
		problems.push(...removeStopped(runtime, name, label, result, runner));
	}
	return { problems, runtime, linted: listed.files.length };
}

/** Returns 0 only for clean workflows and refused planted diagnostics, or a stated local skip. */
export function main(
	rootDir = root,
	runner = run,
	env = process.env,
	ids = currentIds(),
	list = readdirSync,
) {
	const outcome = checkRepository(resolve(rootDir), runner, env, ids, list);
	for (const problem of outcome.problems) console.error(`FAIL: ${problem}`);
	if (outcome.problems.length > 0) return 1;
	if (outcome.skipped) {
		console.warn(`SKIP: workflows not linted: ${outcome.skipped}; CI runs it.`);
		return 0;
	}
	console.log(
		`OK: ${ACTIONLINT_IMAGE.split('@')[0]} (${outcome.runtime}) finds no problem in ` +
			`${outcome.linted} files in ${WORKFLOW_DIR} and refuses the planted workflow in ${PLANTED_FILE}.`,
	);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = main(process.argv[2] ?? root);
}
