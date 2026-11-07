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

export const PLAYWRIGHT_IMAGE_PREFIX = 'mcr.microsoft.com/playwright:',
	REQUIRED_CONTAINER_USER = '--user 1001',
	CONTAINER_USER_REGEX = /(^|\s)--user[=\s]+1001(:\S+)?(?=\s|$)/,
	REQUIRED_BROWSERS_PATH = '/ms-playwright',
	REDUNDANT_INSTALL_CMD = 'playwright install --with-deps',
	DIGEST_REGEX = /@sha256:[0-9a-fA-F]{64}$/;

// Upper bounds (HISS-02): directory entries one scan reads, jobs per workflow,
// documents/packages in lockfile, steps per job, and I/O deadline.
export const ENTRY_LIMIT = 1_000,
	JOB_LIMIT = 100,
	LOCK_DOC_LIMIT = 10,
	LOCK_PACKAGE_LIMIT = 10_000,
	STEP_LIMIT = 100,
	IO_TIMEOUT_MS = 10_000;

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
	promise?.catch?.(() => {});
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
function extractPkgVersions(pkgs, versions) {
	for (const key of Object.keys(pkgs)) {
		if (key.startsWith('playwright@')) {
			versions.add(key.slice('playwright@'.length).split('(')[0]);
		}
	}
}

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
		if (doc.errors?.length > 0) throw doc.errors[0];
		const pkgs = doc.toJSON()?.packages;
		if (isMapping(pkgs)) {
			totalPackages += Object.keys(pkgs).length;
			if (totalPackages > packageLimit) {
				throw new Error(
					`pnpm-lock.yaml exceeds limit of ${packageLimit} packages, got ${totalPackages}`,
				);
			}
			extractPkgVersions(pkgs, versions);
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
	if (versions.size !== 1) {
		const msg =
			versions.size === 0
				? 'no resolved playwright package found in pnpm-lock.yaml'
				: `expected exactly one playwright version in pnpm-lock.yaml, found ${Array.from(versions).sort().join(', ')}`;
		return { version: null, finding: { file: 'pnpm-lock.yaml', message: msg } };
	}
	return { version: Array.from(versions)[0], finding: null };
}

async function readTextFile(path) {
	try {
		const content = await readFile(path, {
			encoding: 'utf8',
			signal: AbortSignal.timeout(IO_TIMEOUT_MS),
		});
		return { content, error: null };
	} catch (err) {
		return { content: null, error: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Reads pnpm-lock.yaml from rootDir and resolves its playwright version.
 */
export async function readLockfileVersion(rootDir, limits = {}) {
	const lockfilePath = join(rootDir, 'pnpm-lock.yaml');
	const { content, error } = await readTextFile(lockfilePath);
	if (error) {
		return {
			version: null,
			finding: { file: 'pnpm-lock.yaml', message: `failed to read ${lockfilePath}: ${error}` },
		};
	}
	return getPlaywrightLockVersion(content, limits);
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
	if (!isMapping(doc) || !isMapping(doc.jobs)) {
		const prop = isMapping(doc) ? "'jobs'" : 'workflow';
		return { finding: { file, job: null, message: `${file}: ${prop} must be a YAML mapping` } };
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
	return tagVersion === lockfileVersion
		? null
		: `tag version '${tag}' (${tagVersion}) does not match lockfile Playwright version '${lockfileVersion}'`;
}

function checkImageDigest(image) {
	return DIGEST_REGEX.test(image)
		? null
		: `container image '${image}' is missing required '@sha256:<64 hex>' digest`;
}

function checkContainerOptions(container) {
	const options = isMapping(container) ? container.options : undefined;
	return typeof options === 'string' && CONTAINER_USER_REGEX.test(options)
		? null
		: `container options lacks required '${REQUIRED_CONTAINER_USER}'`;
}

function checkBrowsersPath(jobDef, container) {
	const jobVal = isMapping(jobDef.env) ? jobDef.env.PLAYWRIGHT_BROWSERS_PATH : undefined;
	const containerVal =
		isMapping(container) && isMapping(container.env)
			? container.env.PLAYWRIGHT_BROWSERS_PATH
			: undefined;
	if (jobVal === REQUIRED_BROWSERS_PATH || containerVal === REQUIRED_BROWSERS_PATH) return null;
	if (jobVal === undefined && containerVal === undefined) {
		return `missing required env.PLAYWRIGHT_BROWSERS_PATH: '${REQUIRED_BROWSERS_PATH}'`;
	}
	return `env.PLAYWRIGHT_BROWSERS_PATH must be '${REQUIRED_BROWSERS_PATH}', got '${jobVal ?? containerVal}'`;
}

function checkRedundantSteps(steps, stepLimit = STEP_LIMIT) {
	if (!Array.isArray(steps)) return null;
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
	if (typeof container === 'string') return container;
	return isMapping(container) && typeof container.image === 'string' ? container.image : null;
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
	if (!isMapping(jobDef)) return [];
	const image = getPlaywrightImage(jobDef.container);
	if (image === null || !image.startsWith(PLAYWRIGHT_IMAGE_PREFIX)) return [];
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
	if (parsed.finding) return [parsed.finding];
	const findings = [];
	for (const [jobId, jobDef] of parsed.entries) {
		findings.push(...checkJob(file, jobId, jobDef, lockfileVersion, stepLimit));
	}
	return findings;
}

export const REQUIRED_BROWSERS_VAR = 'PLAYWRIGHT_BROWSERS_PATH';
const TURBO_RUN_REGEX =
	/(?:^|[\s;&|])(?:(?:pnpm|npx|yarn)\s+(?:exec\s+)?)?turbo\s+run\s+([^\n#;&|]+)/g;
const TURBO_VALUE_FLAGS = new Set([
	'--filter',
	'-F',
	'--concurrency',
	'--cache-dir',
	'--output-logs',
	'--log-order',
	'--log-prefix',
	'--cache',
	'--cache-workers',
	'--global-deps',
]);
const TURBO_OPTIONAL_VALUE_FLAGS = new Set(['--env-mode']);

function listHasVar(list, varName) {
	return Array.isArray(list) && list.includes(varName);
}

function taskHasVar(taskDef, varName) {
	return (
		isMapping(taskDef) &&
		(listHasVar(taskDef.passThroughEnv, varName) || listHasVar(taskDef.env, varName))
	);
}

export function extractTurboTasks(run) {
	if (typeof run !== 'string') return [];
	const tasks = [];
	let match;
	while ((match = TURBO_RUN_REGEX.exec(run)) !== null) {
		const toks = match[1].trim().split(/\s+/);
		for (let i = 0; i < toks.length; i++) {
			const tok = toks[i];
			if (tok === '--') break;
			if (TURBO_VALUE_FLAGS.has(tok)) {
				i++;
				continue;
			}
			if (TURBO_OPTIONAL_VALUE_FLAGS.has(tok)) {
				const next = toks[i + 1];
				if (next !== undefined && !next.startsWith('-')) i++;
				continue;
			}
			if (!tok.startsWith('-') && !tok.startsWith('$') && /^[a-zA-Z0-9_:-]+$/.test(tok)) {
				tasks.push(tok);
			}
		}
	}
	return tasks;
}

export function checkTurboPassThrough(turboConfig, tasks) {
	if (!isMapping(turboConfig)) {
		return [{ file: 'turbo.json', message: 'turbo.json: must be a JSON object' }];
	}
	if (
		listHasVar(turboConfig.globalPassThroughEnv, REQUIRED_BROWSERS_VAR) ||
		listHasVar(turboConfig.globalEnv, REQUIRED_BROWSERS_VAR)
	) {
		return [];
	}
	const configured = isMapping(turboConfig.tasks) ? turboConfig.tasks : {};
	const findings = [];
	for (const task of tasks) {
		if (!taskHasVar(configured[task], REQUIRED_BROWSERS_VAR)) {
			findings.push({
				file: 'turbo.json',
				task,
				message: `turbo.json: task '${task}' must list ${REQUIRED_BROWSERS_VAR} in passThroughEnv, env, or globalPassThroughEnv`,
			});
		}
	}
	return findings;
}

export async function readTurboConfig(rootDir) {
	const turboPath = join(rootDir, 'turbo.json');
	const { content, error } = await readTextFile(turboPath);
	if (error) {
		return {
			config: null,
			finding: { file: 'turbo.json', message: `failed to read ${turboPath}: ${error}` },
		};
	}
	try {
		return { config: JSON.parse(content), finding: null };
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		return {
			config: null,
			finding: { file: 'turbo.json', message: `failed to parse ${turboPath}: ${msg}` },
		};
	}
}

export function getPlaywrightContainerJobs(source, file = 'workflow', jobLimit = JOB_LIMIT) {
	const parsed = parseWorkflowJobs(source, file, jobLimit);
	if (parsed.finding) return [];
	const containerJobs = [];
	for (const [jobId, jobDef] of parsed.entries) {
		const image = isMapping(jobDef) ? getPlaywrightImage(jobDef.container) : null;
		if (image !== null && image.startsWith(PLAYWRIGHT_IMAGE_PREFIX)) {
			containerJobs.push({ jobId, jobDef });
		}
	}
	return containerJobs;
}

function collectJobsTurboTasks(containerJobs, turboTasks) {
	for (const { jobDef } of containerJobs) {
		if (Array.isArray(jobDef.steps)) {
			for (const step of jobDef.steps) {
				for (const task of extractTurboTasks(step?.run)) {
					turboTasks.add(task);
				}
			}
		}
	}
}

async function verifyTurboForContainers(rootDir, turboTasks) {
	turboTasks.add('test:e2e');
	const turboResult = await readTurboConfig(rootDir);
	if (turboResult.finding) {
		return [turboResult.finding];
	}
	return checkTurboPassThrough(turboResult.config, turboTasks);
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
	let hasPlaywrightContainer = false;
	const turboTasks = new Set();
	for (const file of files) {
		const { content: source, error } = await readTextFile(join(dir, file));
		if (error) {
			findings.push({ file, job: null, message: `${file}: failed to read: ${error}` });
			continue;
		}
		findings.push(...findPlaywrightImageViolations(source, file, lockfileVersion, options));
		const containers = getPlaywrightContainerJobs(source, file, options.jobLimit);
		if (containers.length > 0) {
			hasPlaywrightContainer = true;
			collectJobsTurboTasks(containers, turboTasks);
		}
	}
	if (hasPlaywrightContainer) {
		findings.push(...(await verifyTurboForContainers(rootDir, turboTasks)));
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

	findings.push(...workflowResult.findings);
	const where = relative(root, rootDir) || rootDir;
	return reportFindings(workflowResult.files, findings, where, lockResult.version);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main(process.argv[2] ?? root);
}
