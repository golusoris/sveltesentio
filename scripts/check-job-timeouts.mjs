#!/usr/bin/env node
// Fails if a job in a workflow under .github/workflows declares no
// timeout-minutes, or an out-of-range / non-integer timeout.
//
// GitHub Actions jobs default to a timeout of 360 minutes (6 hours). When a
// job hangs (for example in `playwright install --with-deps`), runners stay
// occupied until cancelled manually or hitting the 6-hour ceiling.
//
// Every standard job must declare an integer `timeout-minutes` between 1 and
// 120. Jobs calling a reusable workflow (`jobs.<job_id>.uses`) do not and
// cannot declare `timeout-minutes` because the GitHub Actions workflow syntax
// for reusable workflow calls supports only `name`, `uses`, `with`, `secrets`,
// `needs`, `if`, `permissions`, and `strategy`:
// https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_iduses
//
// The `jobs` mapping is parsed with the `yaml` package with duplicate keys
// refused.
//
// `pnpm test:scripts` runs the unit tests; `pnpm check:job-timeouts` runs this
// check against the repository's workflows.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const workflowsDir = join(root, '.github', 'workflows');

export const MIN_TIMEOUT_MINUTES = 1;
export const MAX_TIMEOUT_MINUTES = 120;

// Upper bounds (HISS-02): directory entries one scan reads, jobs per workflow,
// and I/O deadline.
export const ENTRY_LIMIT = 1_000;
export const JOB_LIMIT = 100;
export const IO_TIMEOUT_MS = 10_000;

/** GitHub reads workflow files with either extension. */
export const WORKFLOW_FILE = /\.ya?ml$/;

/**
 * Races a promise against a timer, clearing the timer so no timer or floating
 * promise leaks.
 */
export async function withTimeout(
	promise,
	timeoutMs = IO_TIMEOUT_MS,
	description = 'fs operation',
) {
	let timer;
	const noop = () => {};
	if (typeof promise?.catch === 'function') {
		promise.catch(noop);
	}
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => {
					reject(new Error(`${description} timed out after ${timeoutMs}ms`));
				}, timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

const REUSABLE_DOCS =
	'https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_iduses';

function isMapping(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parses one workflow source and returns its job entries, or a finding when the
 * document or its `jobs` key is not a mapping. Throws on duplicate keys, YAML
 * syntax errors and more than JOB_LIMIT jobs.
 */
function parseWorkflowJobs(source, file) {
	let doc;
	try {
		doc = parse(source, { uniqueKeys: true });
	} catch (error) {
		throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}
	if (!isMapping(doc)) {
		return { finding: { file, job: null, message: `${file}: workflow must be a YAML mapping` } };
	}
	if (!('jobs' in doc) || !isMapping(doc.jobs)) {
		return { finding: { file, job: null, message: `${file}: 'jobs' must be a YAML mapping` } };
	}
	const entries = Object.entries(doc.jobs);
	if (entries.length > JOB_LIMIT) {
		throw new Error(`${file}: exceeds limit of ${JOB_LIMIT} jobs, got ${entries.length}`);
	}
	return { entries };
}

/**
 * Returns the finding message for one job, or null when the job is valid.
 * A job calling a reusable workflow (`uses:`) cannot take timeout-minutes
 * (only name, uses, with, secrets, needs, if, permissions, strategy are allowed:
 * REUSABLE_DOCS), so it is valid only without the key.
 */
function jobTimeoutMessage(file, jobId, jobDef) {
	if (!isMapping(jobDef)) {
		return `${file}: job '${jobId}' must be a YAML mapping`;
	}
	const isReusableCall = typeof jobDef.uses === 'string' && jobDef.uses.trim().length > 0;
	if (isReusableCall) {
		return 'timeout-minutes' in jobDef
			? `${file}: job '${jobId}' calls a reusable workflow and cannot declare timeout-minutes (unsupported key per GitHub Actions syntax: ${REUSABLE_DOCS})`
			: null;
	}
	const timeout = jobDef['timeout-minutes'];
	if (timeout === null || timeout === undefined) {
		return `${file}: job '${jobId}' missing required integer 'timeout-minutes' (${MIN_TIMEOUT_MINUTES}..${MAX_TIMEOUT_MINUTES})`;
	}
	if (typeof timeout !== 'number' || !Number.isInteger(timeout)) {
		const repr = typeof timeout === 'string' ? JSON.stringify(timeout) : String(timeout);
		return `${file}: job '${jobId}' timeout-minutes must be an integer, got ${repr}`;
	}
	if (timeout < MIN_TIMEOUT_MINUTES || timeout > MAX_TIMEOUT_MINUTES) {
		return `${file}: job '${jobId}' timeout-minutes must be between ${MIN_TIMEOUT_MINUTES} and ${MAX_TIMEOUT_MINUTES}, got ${timeout}`;
	}
	return null;
}

/**
 * Validates the timeout-minutes configuration of all jobs in one workflow source.
 * Throws on duplicate keys or YAML syntax errors.
 * Returns an array of finding objects: { file, job, message }.
 */
export function findJobTimeoutViolations(source, file = 'workflow') {
	const parsed = parseWorkflowJobs(source, file);
	if (parsed.finding) {
		return [parsed.finding];
	}
	const findings = [];
	for (const [jobId, jobDef] of parsed.entries) {
		const message = jobTimeoutMessage(file, jobId, jobDef);
		if (message !== null) {
			findings.push({ file, job: jobId, message });
		}
	}
	return findings;
}

/** Reads every workflow file in `dir` and returns what was read and what was found. */
export async function scanWorkflows(dir) {
	const entries = await withTimeout(
		readdir(dir, { withFileTypes: true }),
		IO_TIMEOUT_MS,
		`readdir ${dir}`,
	);
	if (entries.length > ENTRY_LIMIT) {
		throw new Error(`${dir} holds more than ${ENTRY_LIMIT} entries`);
	}
	const files = entries
		.filter((entry) => entry.isFile() && WORKFLOW_FILE.test(entry.name))
		.map((entry) => entry.name)
		.sort();

	const findings = [];
	for (const file of files) {
		const source = await readFile(join(dir, file), {
			encoding: 'utf8',
			signal: AbortSignal.timeout(IO_TIMEOUT_MS),
		});
		for (const finding of findJobTimeoutViolations(source, file)) {
			findings.push(finding);
		}
	}
	return { files, findings };
}

/** Returns the exit code: 0 when workflows were read and none violates timeout-minutes rules. */
export async function main(dir = workflowsDir) {
	const { files, findings } = await scanWorkflows(dir);
	const where = relative(root, dir) || dir;

	if (files.length === 0) {
		console.error(`No workflow file found in ${where}; nothing was checked.`);
		return 1;
	}
	if (findings.length > 0) {
		console.error(`Found ${findings.length} job-timeout violation(s) in ${where}:\n`);
		for (const { file, job, message } of findings) {
			console.error(`  ${file}${job ? ` (job: ${job})` : ''}: ${message}`);
		}
		console.error(
			`\nEvery standard job must declare integer 'timeout-minutes' (${MIN_TIMEOUT_MINUTES}..${MAX_TIMEOUT_MINUTES}).`,
		);
		console.error(
			'Reusable workflow calls (jobs with uses:) must not declare timeout-minutes (unsupported by GitHub Actions).',
		);
		return 1;
	}
	console.log(`OK: all ${files.length} workflows in ${where} declare valid job timeout-minutes.`);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	// An optional directory argument checks another folder, such as the HISS-02 fixtures.
	process.exitCode = await main(process.argv[2] ?? workflowsDir);
}
