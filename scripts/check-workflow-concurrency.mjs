#!/usr/bin/env node
// A shared pending slot can cancel a tip run even with cancel-in-progress false.
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { ENTRY_LIMIT, JOB_LIMIT, scanWorkflows } from './check-job-timeouts.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const workflowsDir = join(root, '.github', 'workflows');
const PR_CANCELLATION = "${{ github.event_name == 'pull_request' }}";
const EXCEPTION_LIMIT = 1;

export const CONCURRENCY_EXCEPTIONS = new Map([
	[
		'release-please.yml#format-release-pr',
		'A newer release-branch push supersedes the older formatting run.',
	],
]);

function isMapping(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseWorkflow(source, file) {
	try {
		return parse(source, { uniqueKeys: true });
	} catch (error) {
		throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}
}

function eventNames(trigger) {
	if (typeof trigger === 'string') return [trigger];
	if (Array.isArray(trigger)) return trigger;
	return isMapping(trigger) ? Object.keys(trigger) : [];
}

function workflowMessage(doc, file) {
	if (!isMapping(doc)) return `${file}: workflow must be a YAML mapping`;
	if (!isMapping(doc.jobs)) return `${file}: 'jobs' must be a YAML mapping`;
	const events = eventNames(doc.on);
	if (events.length === 0 || events.length > ENTRY_LIMIT) {
		return `${file}: 'on' must name between 1 and ${ENTRY_LIMIT} events`;
	}
	if (events.some((event) => typeof event !== 'string' || event.trim().length === 0)) {
		return `${file}: 'on' event names must be non-blank strings`;
	}
	return null;
}

function hasPerRunGroup(group) {
	if (typeof group !== 'string') return false;
	const expressions = group.match(/\$\{\{[^{}]*\}\}/g) ?? [];
	if (expressions.length > ENTRY_LIMIT) return false;
	for (const expression of expressions) {
		// A quoted context name is literal text, so cannot distinguish runs.
		const unquoted = expression.replace(/'(?:[^']|'')*'/g, "''");
		if (/(?:^|[^\w.])github\.(?:run_id|sha)\b/.test(unquoted)) return true;
	}
	return false;
}

function concurrencyMessage(block) {
	const config = typeof block === 'string' ? { group: block } : block;
	if (!isMapping(config)) return 'concurrency must be a group string or YAML mapping';
	if (!hasPerRunGroup(config.group)) {
		return 'concurrency group must contain github.run_id or github.sha in an expression';
	}
	if (!('cancel-in-progress' in config)) return null;
	const cancel = config['cancel-in-progress'];
	return cancel === false || cancel === PR_CANCELLATION
		? null
		: `cancel-in-progress must be absent, false, or exactly ${PR_CANCELLATION}`;
}

function finding(file, job, message) {
	const context = job === null ? file : `${file}: job '${job}'`;
	return { file, job, message: `${context}: ${message}` };
}

function blockFindings(definition, file, job, required) {
	if (!isMapping(definition)) return [finding(file, job, 'must be a YAML mapping')];
	if (!required || !('concurrency' in definition)) return [];
	if (CONCURRENCY_EXCEPTIONS.has(`${file}#${job}`)) return [];
	const message = concurrencyMessage(definition.concurrency);
	return message === null ? [] : [finding(file, job, message)];
}

function exceptionEntries() {
	if (CONCURRENCY_EXCEPTIONS.size > EXCEPTION_LIMIT) {
		throw new Error(`Concurrency exceptions exceed limit of ${EXCEPTION_LIMIT}`);
	}
	return [...CONCURRENCY_EXCEPTIONS.keys()].map((key) => key.split('#'));
}

function staleExceptions(doc, file, required) {
	const findings = [];
	for (const [exceptionFile, job] of exceptionEntries()) {
		if (exceptionFile !== file) continue;
		const definition = doc.jobs[job];
		const block = isMapping(definition) ? definition.concurrency : undefined;
		if (!required || block === undefined || concurrencyMessage(block) === null) {
			findings.push(finding(file, job, 'stale concurrency exception; remove the unused entry'));
		}
	}
	return findings;
}

/** Malformed YAML must fail with context rather than silently bypassing the policy. */
export function findConcurrencyViolations(source, file = 'workflow') {
	const doc = parseWorkflow(source, file);
	const message = workflowMessage(doc, file);
	if (message !== null) return [{ file, job: null, message }];
	const jobs = Object.entries(doc.jobs);
	if (jobs.length > JOB_LIMIT) {
		throw new Error(`${file}: exceeds limit of ${JOB_LIMIT} jobs, got ${jobs.length}`);
	}
	const required = eventNames(doc.on).some((event) => event !== 'pull_request');
	const findings = blockFindings(doc, file, null, required);
	for (const [job, definition] of jobs) {
		findings.push(...blockFindings(definition, file, job, required));
	}
	findings.push(...staleExceptions(doc, file, required));
	return findings;
}

function missingExceptionFiles(files) {
	const findings = [];
	for (const [file, job] of exceptionEntries()) {
		if (!files.includes(file)) {
			findings.push(finding(file, job, 'stale concurrency exception; workflow file is missing'));
		}
	}
	return findings;
}

/** Empty scans and stale exceptions must fail so removed workflows cannot disable the check. */
export async function main(dir = workflowsDir) {
	const { files, findings } = await scanWorkflows(dir, findConcurrencyViolations);
	const where = relative(root, dir) || dir;
	if (files.length === 0) {
		console.error(`No workflow file found in ${where}; nothing was checked.`);
		return 1;
	}
	findings.push(...missingExceptionFiles(files));
	if (findings.length === 0) {
		console.log(`OK: all ${files.length} workflows in ${where} keep per-run concurrency groups.`);
		return 0;
	}
	console.error(`Found ${findings.length} workflow-concurrency violation(s) in ${where}:`);
	// scanWorkflows bounds both files and findings per file; exceptions add at most one.
	for (const { message } of findings) console.error(`  ${message}`);
	return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main(process.argv[2] ?? workflowsDir);
}
