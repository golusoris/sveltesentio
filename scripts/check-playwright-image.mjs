#!/usr/bin/env node
// Fails if a job in a workflow under .github/workflows declares a Playwright
// container image that drifts from the lockfile Playwright version, lacks
// a sha256 digest, lacks --user 1001 in options, lacks PLAYWRIGHT_BROWSERS_PATH
// set to /ms-playwright, or if a step still runs `playwright install --with-deps`.
//
// Playwright container images include browser binaries and OS dependencies.
// The image version must equal the project's Playwright version so tests find
// compatible browsers without re-installing them.
//
// `pnpm test:scripts` runs the unit tests; `pnpm check:playwright-image` runs
// this check against the repository's workflows.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, parseAllDocuments } from 'yaml';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export const PLAYWRIGHT_IMAGE_PREFIX = 'mcr.microsoft.com/playwright:';
export const REQUIRED_CONTAINER_USER = '--user 1001';
export const CONTAINER_USER_REGEX = /(^|\s)--user[=\s]+1001(:\S+)?(?=\s|$)/;
export const REQUIRED_BROWSERS_PATH = '/ms-playwright';
export const REDUNDANT_INSTALL_CMD = 'playwright install --with-deps';
export const DIGEST_REGEX = /@sha256:[0-9a-fA-F]{64}$/;

// Upper bounds (HISS-02): directory entries one scan reads, jobs per workflow,
// documents/packages in lockfile, steps per job, and I/O deadline.
export const ENTRY_LIMIT = 1_000;
export const JOB_LIMIT = 100;
export const LOCK_DOC_LIMIT = 10;
export const LOCK_PACKAGE_LIMIT = 10_000;
export const STEP_LIMIT = 100;
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

function isMapping(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Adds resolved playwright versions found in a packages dictionary.
 */
function addPackageVersions(packages, versions) {
	for (const key of Object.keys(packages)) {
		if (key.startsWith('playwright@')) {
			const rawVer = key.slice('playwright@'.length);
			versions.add(rawVer.split('(')[0]);
		}
	}
}

/**
 * Extracts unique resolved playwright package versions from parsed lockfile documents.
 */
function collectPlaywrightVersions(
	docs,
	docLimit = LOCK_DOC_LIMIT,
	packageLimit = LOCK_PACKAGE_LIMIT,
) {
	if (docs.length > docLimit) {
		throw new Error(`pnpm-lock.yaml exceeds limit of ${docLimit} documents, got ${docs.length}`);
	}
	const versions = new Set();
	let totalPackages = 0;
	for (const doc of docs) {
		if (doc.errors && doc.errors.length > 0) {
			throw doc.errors[0];
		}
		const data = doc.toJSON();
		if (isMapping(data?.packages)) {
			totalPackages += Object.keys(data.packages).length;
			if (totalPackages > packageLimit) {
				throw new Error(
					`pnpm-lock.yaml exceeds limit of ${packageLimit} packages, got ${totalPackages}`,
				);
			}
			addPackageVersions(data.packages, versions);
		}
	}
	return versions;
}

/**
 * Parses lockfile source and returns the resolved playwright version or a finding.
 */
export function getPlaywrightLockVersion(lockfileSource, limits = {}) {
	const docLimit = typeof limits === 'number' ? limits : (limits.docLimit ?? LOCK_DOC_LIMIT);
	const packageLimit = limits.packageLimit ?? LOCK_PACKAGE_LIMIT;
	let versions;
	try {
		const docs = parseAllDocuments(lockfileSource, { uniqueKeys: true });
		versions = collectPlaywrightVersions(docs, docLimit, packageLimit);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		return { version: null, finding: { file: 'pnpm-lock.yaml', message: msg } };
	}
	if (versions.size === 0) {
		return {
			version: null,
			finding: {
				file: 'pnpm-lock.yaml',
				message: 'no resolved playwright package found in pnpm-lock.yaml',
			},
		};
	}
	if (versions.size > 1) {
		const list = Array.from(versions).sort().join(', ');
		return {
			version: null,
			finding: {
				file: 'pnpm-lock.yaml',
				message: `expected exactly one playwright version in pnpm-lock.yaml, found ${list}`,
			},
		};
	}
	return { version: Array.from(versions)[0], finding: null };
}

/**
 * Reads pnpm-lock.yaml from rootDir and resolves its playwright version.
 */
export async function readLockfileVersion(rootDir, limits = {}) {
	const lockfilePath = join(rootDir, 'pnpm-lock.yaml');
	let source;
	try {
		source = await readFile(lockfilePath, {
			encoding: 'utf8',
			signal: AbortSignal.timeout(IO_TIMEOUT_MS),
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		return {
			version: null,
			finding: { file: 'pnpm-lock.yaml', message: `failed to read ${lockfilePath}: ${msg}` },
		};
	}
	return getPlaywrightLockVersion(source, limits);
}

/**
 * Parses one workflow source and returns its job entries.
 */
function parseWorkflowJobs(source, file, jobLimit = JOB_LIMIT) {
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
	if (entries.length > jobLimit) {
		throw new Error(`${file}: exceeds limit of ${jobLimit} jobs, got ${entries.length}`);
	}
	return { entries };
}

function checkImageTag(image, lockfileVersion) {
	const ref = image.slice(PLAYWRIGHT_IMAGE_PREFIX.length);
	const tag = ref.split('@')[0];
	const tagVersion = tag.replace(/^v/, '').split('-')[0];
	if (tagVersion !== lockfileVersion) {
		return `tag version '${tag}' (${tagVersion}) does not match lockfile Playwright version '${lockfileVersion}'`;
	}
	return null;
}

function checkImageDigest(image) {
	if (!DIGEST_REGEX.test(image)) {
		return `container image '${image}' is missing required '@sha256:<64 hex>' digest`;
	}
	return null;
}

function checkContainerOptions(container) {
	const options = isMapping(container) ? container.options : undefined;
	if (typeof options !== 'string' || !CONTAINER_USER_REGEX.test(options)) {
		return `container options lacks required '${REQUIRED_CONTAINER_USER}'`;
	}
	return null;
}

function checkBrowsersPath(jobDef, container) {
	const jobVal = isMapping(jobDef.env) ? jobDef.env.PLAYWRIGHT_BROWSERS_PATH : undefined;
	const containerVal =
		isMapping(container) && isMapping(container.env)
			? container.env.PLAYWRIGHT_BROWSERS_PATH
			: undefined;
	if (jobVal === REQUIRED_BROWSERS_PATH || containerVal === REQUIRED_BROWSERS_PATH) {
		return null;
	}
	if (jobVal === undefined && containerVal === undefined) {
		return `missing required env.PLAYWRIGHT_BROWSERS_PATH: '${REQUIRED_BROWSERS_PATH}'`;
	}
	const actual = jobVal !== undefined ? jobVal : containerVal;
	return `env.PLAYWRIGHT_BROWSERS_PATH must be '${REQUIRED_BROWSERS_PATH}', got '${actual}'`;
}

function checkRedundantSteps(steps, stepLimit = STEP_LIMIT) {
	if (!Array.isArray(steps)) {
		return null;
	}
	if (steps.length > stepLimit) {
		throw new Error(`exceeds limit of ${stepLimit} steps, got ${steps.length}`);
	}
	for (const step of steps) {
		if (typeof step?.run === 'string' && step.run.includes(REDUNDANT_INSTALL_CMD)) {
			return `contains redundant '${REDUNDANT_INSTALL_CMD}' inside Playwright container`;
		}
	}
	return null;
}

function collectJobChecks(image, lockfileVersion, container, jobDef, stepLimit) {
	return [
		lockfileVersion ? checkImageTag(image, lockfileVersion) : null,
		checkImageDigest(image),
		checkContainerOptions(container),
		checkBrowsersPath(jobDef, container),
		checkRedundantSteps(jobDef.steps, stepLimit),
	];
}

function getPlaywrightImage(container) {
	if (typeof container === 'string') {
		return container;
	}
	if (isMapping(container) && typeof container.image === 'string') {
		return container.image;
	}
	return null;
}

function ensureStepLimit(file, jobId, steps, stepLimit) {
	if (Array.isArray(steps) && steps.length > stepLimit) {
		throw new Error(
			`${file}: job '${jobId}' exceeds limit of ${stepLimit} steps, got ${steps.length}`,
		);
	}
}

/**
 * Validates a single workflow job container definition and steps.
 */
function checkJob(file, jobId, jobDef, lockfileVersion, stepLimit = STEP_LIMIT) {
	if (!isMapping(jobDef)) {
		return [];
	}
	const image = getPlaywrightImage(jobDef.container);
	if (image === null || !image.startsWith(PLAYWRIGHT_IMAGE_PREFIX)) {
		return [];
	}
	ensureStepLimit(file, jobId, jobDef.steps, stepLimit);
	const findings = [];
	for (const msg of collectJobChecks(image, lockfileVersion, jobDef.container, jobDef, stepLimit)) {
		if (msg !== null) {
			findings.push({ file, job: jobId, message: `${file}: job '${jobId}' ${msg}` });
		}
	}
	return findings;
}

/**
 * Validates Playwright container usage across all jobs in one workflow source.
 */
export function findPlaywrightImageViolations(
	source,
	file = 'workflow',
	lockfileVersion,
	options = {},
) {
	const { jobLimit = JOB_LIMIT, stepLimit = STEP_LIMIT } = options;
	const parsed = parseWorkflowJobs(source, file, jobLimit);
	if (parsed.finding) {
		return [parsed.finding];
	}
	const findings = [];
	for (const [jobId, jobDef] of parsed.entries) {
		for (const finding of checkJob(file, jobId, jobDef, lockfileVersion, stepLimit)) {
			findings.push(finding);
		}
	}
	return findings;
}

/**
 * Reads every workflow in rootDir/.github/workflows and checks for Playwright container violations.
 */
export async function scanWorkflows(rootDir, lockfileVersion, options = {}) {
	const dir = join(rootDir, '.github', 'workflows');
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
		for (const finding of findPlaywrightImageViolations(source, file, lockfileVersion, options)) {
			findings.push(finding);
		}
	}
	return { files, findings };
}

function reportFindings(files, findings, where, lockfileVersion) {
	if (files.length === 0) {
		console.error(`No workflow file found in ${where}; nothing was checked.`);
		return 1;
	}
	if (findings.length > 0) {
		console.error(`Found ${findings.length} Playwright container violation(s) in ${where}:\n`);
		for (const { file, job, message } of findings) {
			console.error(`  ${file}${job ? ` (job: ${job})` : ''}: ${message}`);
		}
		return 1;
	}
	console.log(
		`OK: Playwright container images across ${files.length} workflows match lockfile version ${lockfileVersion}.`,
	);
	return 0;
}

/**
 * Returns the exit code: 0 when all Playwright containers match the lockfile and rules.
 */
export async function main(rootDir = root) {
	const lockResult = await readLockfileVersion(rootDir);
	const findings = lockResult.finding ? [lockResult.finding] : [];

	let workflowResult;
	try {
		workflowResult = await scanWorkflows(rootDir, lockResult.version);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`Workflow scan failed: ${msg}`);
		return 1;
	}

	for (const finding of workflowResult.findings) {
		findings.push(finding);
	}
	const where = relative(root, rootDir) || rootDir;
	return reportFindings(workflowResult.files, findings, where, lockResult.version);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main(process.argv[2] ?? root);
}
