#!/usr/bin/env node
// Fails if .github/workflows/portability.yml lacks a matrix leg for any
// required OS family (ubuntu-*, macos-*, windows-*), if its job name template
// is not 'Platform Neutrality (${{ matrix.name }})', if runs-on is not
// '${{ matrix.runner }}', or if its legs do not
// bijectively match the 'Platform Neutrality (...)' contexts required by
// .github/rulesets/main.json.
//
// HISS-21 platform neutrality: lint, type check, and tests run on Linux,
// macOS, and Windows. This script verifies the link between the workflow matrix
// and the branch protection ruleset so dropped legs fail immediately.
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const defaultRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export const EXPECTED_JOB_NAME = 'Platform Neutrality (${{ matrix.name }})';
export const IO_TIMEOUT_MS = 10_000;
export const EXPECTED_RUNS_ON = '${{ matrix.runner }}';
export const PLATFORM_CONTEXT_RE = /^Platform Neutrality \((.+)\)$/;
export const DRAFT_STEP_NAME = 'Stop on a draft pull request';
export const DRAFT_STEP_IF = 'github.event.pull_request.draft == true';

export const REQUIRED_LEGS = {
	Linux: 'ubuntu-',
	macOS: 'macos-',
	Windows: 'windows-',
};

export const REQUIRED_OS_FAMILIES = [
	{ family: 'ubuntu-*', matches: (r) => typeof r === 'string' && r.startsWith('ubuntu-') },
	{ family: 'macos-*', matches: (r) => typeof r === 'string' && r.startsWith('macos-') },
	{ family: 'windows-*', matches: (r) => typeof r === 'string' && r.startsWith('windows-') },
];

export function getPortabilityJob(
	doc,
	relWorkflow = '.github/workflows/portability.yml',
	findings = [],
) {
	if (
		!doc ||
		typeof doc !== 'object' ||
		!doc.jobs ||
		typeof doc.jobs !== 'object' ||
		!doc.jobs.portability ||
		typeof doc.jobs.portability !== 'object'
	) {
		findings.push(`${relWorkflow}: jobs.portability missing`);
		return null;
	}
	return doc.jobs.portability;
}

function draftStepFailsClosed(step) {
	if (typeof step?.run !== 'string') return false;
	const lines = step.run.split('\n').map((line) => line.trim());
	const nonEmpty = lines.filter((line) => line.length > 0);
	if (nonEmpty.at(-1) !== 'exit 1') return false;
	for (const line of lines) {
		if (/\bexit\b/.test(line) && line !== 'exit 1') {
			return false;
		}
	}
	return true;
}

function getStepDescriptor(step) {
	if (typeof step?.name === 'string' && step.name.trim() !== '') {
		return step.name.trim();
	}
	if (typeof step?.uses === 'string' && step.uses.trim() !== '') {
		return step.uses.trim();
	}
	if (typeof step?.run === 'string') {
		const firstLine = step.run.split('\n').find((line) => line.trim() !== '');
		if (firstLine) return firstLine.trim();
	}
	return '';
}

function checkDraftStep(step, i, relWorkflow, desc, findings) {
	if (typeof step.if !== 'string' || step.if.trim() !== DRAFT_STEP_IF) {
		findings.push(
			`${relWorkflow}: steps[${i}] ('${desc}') 'if' must be '${DRAFT_STEP_IF}', got ${JSON.stringify(step.if ?? null)}`,
		);
	}
	if (!draftStepFailsClosed(step)) {
		findings.push(
			`${relWorkflow}: steps[${i}] ('${desc}') draft-stop step must fail closed (last run line 'exit 1', no other exit codes)`,
		);
	}
}

function checkSingleStep(step, i, relWorkflow, findings) {
	if (!step || typeof step !== 'object') return;
	const desc = getStepDescriptor(step);
	if (step['continue-on-error'] !== undefined && step['continue-on-error'] !== false) {
		findings.push(`${relWorkflow}: steps[${i}] ('${desc}') continue-on-error prohibited`);
	}
	const isDraftStep = i === 0 && step.name === DRAFT_STEP_NAME;
	if (isDraftStep) {
		checkDraftStep(step, i, relWorkflow, desc, findings);
	} else if (step.if !== undefined) {
		findings.push(`${relWorkflow}: steps[${i}] ('${desc}') 'if' prohibited`);
	}
}

function checkStepGuards(job, relWorkflow, findings) {
	if (!Array.isArray(job.steps) || job.steps.length === 0) {
		findings.push(`${relWorkflow}: jobs.portability.steps must be a non-empty list`);
		return;
	}
	for (let i = 0; i < job.steps.length; i++) {
		checkSingleStep(job.steps[i], i, relWorkflow, findings);
	}
}

function checkJobGuards(job, relWorkflow, findings) {
	if (job.name !== EXPECTED_JOB_NAME) {
		findings.push(
			`${relWorkflow}: job name template must be '${EXPECTED_JOB_NAME}', got ${JSON.stringify(job.name ?? null)}`,
		);
	}
	if (job['runs-on'] !== EXPECTED_RUNS_ON) {
		findings.push(
			`${relWorkflow}: runs-on must be '${EXPECTED_RUNS_ON}' so each leg runs on its own runner, got ${JSON.stringify(job['runs-on'] ?? null)}`,
		);
	}
	if (job.if !== undefined) {
		findings.push(
			`${relWorkflow}: job-level 'if' condition is prohibited on portability job (skipped required job counts as success)`,
		);
	}
	if (job['continue-on-error'] !== undefined && job['continue-on-error'] !== false) {
		findings.push(
			`${relWorkflow}: job-level 'continue-on-error' is prohibited on portability job, got ${JSON.stringify(job['continue-on-error'])}`,
		);
	}
	checkStepGuards(job, relWorkflow, findings);
}

function checkMatrixStructure(matrix, relWorkflow, findings) {
	if (!matrix || typeof matrix !== 'object') {
		findings.push(`${relWorkflow}: strategy.matrix must be an object`);
		return false;
	}
	if (matrix.exclude !== undefined) {
		findings.push(`${relWorkflow}: strategy.matrix.exclude is prohibited (can drop required legs)`);
	}
	for (const key of Object.keys(matrix)) {
		if (key !== 'include' && key !== 'exclude') {
			findings.push(
				`${relWorkflow}: strategy.matrix contains forbidden key '${key}' (only 'include' is allowed)`,
			);
		}
	}
	if (!Array.isArray(matrix.include)) {
		findings.push(`${relWorkflow}: matrix include must be an array of leg definitions`);
		return false;
	}
	return true;
}

function checkSingleLeg(leg, seenLegNames, relWorkflow, findings) {
	if (!leg || typeof leg !== 'object') {
		findings.push(`${relWorkflow}: matrix include leg must be an object`);
		return;
	}
	if (typeof leg.name !== 'string' || leg.name.trim() === '') {
		findings.push(`${relWorkflow}: matrix include leg missing non-empty string 'name'`);
		return;
	}
	if (seenLegNames.has(leg.name)) {
		findings.push(`${relWorkflow}: duplicate matrix leg name '${leg.name}'`);
		return;
	}
	seenLegNames.add(leg.name);
	if (!Object.hasOwn(REQUIRED_LEGS, leg.name)) {
		findings.push(
			`${relWorkflow}: unexpected matrix leg '${leg.name}', expected one of: ${Object.keys(REQUIRED_LEGS).join(', ')}`,
		);
		return;
	}
	const expectedPrefix = REQUIRED_LEGS[leg.name];
	if (typeof leg.runner !== 'string' || !leg.runner.startsWith(expectedPrefix)) {
		findings.push(
			`${relWorkflow}: matrix leg '${leg.name}' runner ${JSON.stringify(leg.runner ?? null)} must start with '${expectedPrefix}'`,
		);
	}
}

function checkMatrixLegs(include, relWorkflow, findings) {
	const seenLegNames = new Set();
	for (const leg of include) {
		checkSingleLeg(leg, seenLegNames, relWorkflow, findings);
	}
	for (const [requiredName, expectedPrefix] of Object.entries(REQUIRED_LEGS)) {
		if (!seenLegNames.has(requiredName)) {
			findings.push(
				`${relWorkflow}: matrix include lacks a leg with runner on OS family ${expectedPrefix}* (required leg '${requiredName}')`,
			);
		}
	}
	return seenLegNames;
}

// GitHub ruleset ref conditions take fnmatch globs and the ~ALL token. This check
// covers exact match, ~ALL and a trailing '*' prefix; other glob forms pass unchecked.
function excludeMatchesRef(excludeEntry, ref) {
	if (excludeEntry === '~ALL') return true;
	if (excludeEntry === ref) return true;
	if (excludeEntry.endsWith('*')) {
		return ref.startsWith(excludeEntry.slice(0, -1));
	}
	return false;
}

function checkSingleExclude(excludeEntry, include, relRuleset, findings) {
	if (typeof excludeEntry !== 'string') return;
	for (const ref of include) {
		if (typeof ref === 'string' && excludeMatchesRef(excludeEntry, ref)) {
			findings.push(`${relRuleset}: exclude ${excludeEntry} removes included ref ${ref}`);
		}
	}
}

function checkRulesetExcludes(rulesetDoc, relRuleset, findings) {
	const include = rulesetDoc.conditions?.ref_name?.include;
	const exclude = rulesetDoc.conditions?.ref_name?.exclude;
	if (!Array.isArray(include) || !Array.isArray(exclude) || exclude.length === 0) {
		return;
	}
	for (const excludeEntry of exclude) {
		checkSingleExclude(excludeEntry, include, relRuleset, findings);
	}
}

function checkRulesetEnvelope(rulesetDoc, relRuleset, findings) {
	if (rulesetDoc.enforcement !== 'active') {
		findings.push(
			`${relRuleset}: ruleset enforcement must be 'active', got ${JSON.stringify(rulesetDoc.enforcement ?? null)}`,
		);
	}
	if (rulesetDoc.target !== 'branch') {
		findings.push(
			`${relRuleset}: ruleset target must be 'branch', got ${JSON.stringify(rulesetDoc.target ?? null)}`,
		);
	}
	const include = rulesetDoc.conditions?.ref_name?.include;
	if (!Array.isArray(include) || !include.includes('refs/heads/main')) {
		findings.push(
			`${relRuleset}: ruleset conditions.ref_name.include must contain 'refs/heads/main'`,
		);
	}
	checkRulesetExcludes(rulesetDoc, relRuleset, findings);
}

function checkBranchTrigger(workflowOn, eventName, pat, ref, relWorkflow, findings) {
	const eventConfig = workflowOn?.[eventName];
	const branches = Array.isArray(eventConfig?.branches) ? eventConfig.branches : [];
	if (!branches.includes(pat)) {
		findings.push(
			`${relWorkflow}: on.${eventName}.branches must contain '${pat}' (from ruleset include ref '${ref}')`,
		);
	}
}

function checkTriggerCoverage(workflowDoc, rulesetDoc, relWorkflow, findings) {
	const include = rulesetDoc.conditions?.ref_name?.include;
	if (!Array.isArray(include)) return;
	const workflowOn = workflowDoc.on ?? workflowDoc['on'];
	for (const ref of include) {
		if (typeof ref === 'string' && ref.startsWith('refs/heads/')) {
			const pat = ref.slice('refs/heads/'.length);
			checkBranchTrigger(workflowOn, 'pull_request', pat, ref, relWorkflow, findings);
			checkBranchTrigger(workflowOn, 'push', pat, ref, relWorkflow, findings);
		}
	}
}

function extractRulesetChecks(rulesetDoc) {
	if (!rulesetDoc || typeof rulesetDoc !== 'object' || !Array.isArray(rulesetDoc.rules)) {
		return null;
	}
	const rule = rulesetDoc.rules.find((r) => r && r.type === 'required_status_checks');
	const checks = rule?.parameters?.required_status_checks;
	if (!Array.isArray(checks)) {
		return [];
	}
	return checks.map((c) => c?.context).filter((c) => typeof c === 'string');
}

function checkLegRulesetConsistency(legNames, rulesetChecks, relRuleset, findings) {
	const checkSet = new Set(rulesetChecks);
	for (const legName of legNames) {
		const expectedContext = `Platform Neutrality (${legName})`;
		if (!checkSet.has(expectedContext)) {
			findings.push(
				`${relRuleset}: required_status_checks lacks '${expectedContext}' for matrix leg '${legName}'`,
			);
		}
	}
	for (const context of checkSet) {
		const match = PLATFORM_CONTEXT_RE.exec(context);
		if (match) {
			const legName = match[1];
			if (!legNames.has(legName)) {
				findings.push(
					`${relRuleset}: required status check '${context}' has no matching leg in matrix`,
				);
			}
		}
	}
}

export async function readDocument(filePath, relPath, kind, parseSource) {
	let source;
	try {
		source = await readFile(filePath, {
			encoding: 'utf8',
			signal: AbortSignal.timeout(IO_TIMEOUT_MS),
		});
	} catch (error) {
		return { error: `${relPath}: cannot read file (${error.message})` };
	}
	try {
		return { doc: parseSource(source) };
	} catch (error) {
		return { error: `${relPath}: unparsable ${kind} (${error.message})` };
	}
}

export async function checkPlatformLegs(rootDir = defaultRoot) {
	const workflowPath = join(rootDir, '.github', 'workflows', 'portability.yml');
	const rulesetPath = join(rootDir, '.github', 'rulesets', 'main.json');
	const relWorkflow = relative(rootDir, workflowPath) || workflowPath;
	const relRuleset = relative(rootDir, rulesetPath) || rulesetPath;
	const findings = [];

	const [workflowRes, rulesetRes] = await Promise.all([
		readDocument(workflowPath, relWorkflow, 'YAML', (src) => parse(src, { uniqueKeys: true })),
		readDocument(rulesetPath, relRuleset, 'JSON', (src) => JSON.parse(src)),
	]);

	if (workflowRes.error) findings.push(workflowRes.error);
	if (rulesetRes.error) findings.push(rulesetRes.error);
	if (findings.length > 0) return { findings };

	const legNames = checkWorkflowSide(workflowRes.doc, relWorkflow, findings);
	if (legNames === null) return { findings };
	checkRulesetSide(
		workflowRes.doc,
		rulesetRes.doc,
		{ relWorkflow, relRuleset },
		legNames,
		findings,
	);
	return { findings };
}

function checkWorkflowSide(workflowDoc, relWorkflow, findings) {
	const job = getPortabilityJob(workflowDoc, relWorkflow, findings);
	if (!job) return null;
	checkJobGuards(job, relWorkflow, findings);
	const matrix = job.strategy?.matrix;
	const matrixValid = checkMatrixStructure(matrix, relWorkflow, findings);
	return matrixValid ? checkMatrixLegs(matrix.include, relWorkflow, findings) : new Set();
}

function checkRulesetSide(
	workflowDoc,
	rulesetDoc,
	{ relWorkflow, relRuleset },
	legNames,
	findings,
) {
	if (!rulesetDoc || typeof rulesetDoc !== 'object') {
		findings.push(`${relRuleset}: invalid ruleset structure (not an object)`);
		return;
	}
	checkRulesetEnvelope(rulesetDoc, relRuleset, findings);
	checkTriggerCoverage(workflowDoc, rulesetDoc, relWorkflow, findings);
	const rulesetChecks = extractRulesetChecks(rulesetDoc);
	if (rulesetChecks === null) {
		findings.push(`${relRuleset}: invalid ruleset structure (missing rules array)`);
		return;
	}
	checkLegRulesetConsistency(legNames, rulesetChecks, relRuleset, findings);
}

export async function main(rootDir = defaultRoot) {
	const { findings } = await checkPlatformLegs(rootDir);
	if (findings.length > 0) {
		for (const finding of findings) {
			console.error(finding);
		}
		return 1;
	}
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main(process.argv[2] ?? defaultRoot);
}
