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

export const REQUIRED_OS_FAMILIES = [
	{ family: 'ubuntu-*', matches: (r) => typeof r === 'string' && r.startsWith('ubuntu-') },
	{ family: 'macos-*', matches: (r) => typeof r === 'string' && r.startsWith('macos-') },
	{ family: 'windows-*', matches: (r) => typeof r === 'string' && r.startsWith('windows-') },
];

function getPortabilityJob(doc) {
	if (!doc || typeof doc !== 'object') return null;
	if (!doc.jobs || typeof doc.jobs !== 'object') return null;
	return doc.jobs.portability ?? Object.values(doc.jobs)[0] ?? null;
}

function checkMatrixFamilies(include, relWorkflow, findings) {
	if (!Array.isArray(include)) {
		findings.push(`${relWorkflow}: matrix include must be an array of leg definitions`);
		return;
	}
	for (const { family, matches } of REQUIRED_OS_FAMILIES) {
		const hasLeg = include.some((leg) => matches(leg?.runner));
		if (!hasLeg) {
			findings.push(
				`${relWorkflow}: matrix include lacks a leg with runner on OS family ${family}`,
			);
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

function checkLegRulesetConsistency(include, rulesetChecks, relRuleset, findings) {
	const checkSet = new Set(rulesetChecks);
	const legNames = new Set();
	if (Array.isArray(include)) {
		for (const leg of include) {
			if (typeof leg?.name === 'string') {
				legNames.add(leg.name);
				const expectedContext = `Platform Neutrality (${leg.name})`;
				if (!checkSet.has(expectedContext)) {
					findings.push(
						`${relRuleset}: required_status_checks lacks '${expectedContext}' for matrix leg '${leg.name}'`,
					);
				}
			}
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

async function readDocument(filePath, relPath, kind, parseSource) {
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

	const job = getPortabilityJob(workflowRes.doc);
	if (!job || typeof job !== 'object') {
		findings.push(`${relWorkflow}: workflow defines no valid jobs`);
		return { findings };
	}

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

	const include = job.strategy?.matrix?.include;
	checkMatrixFamilies(include, relWorkflow, findings);

	const rulesetChecks = extractRulesetChecks(rulesetRes.doc);
	if (rulesetChecks === null) {
		findings.push(`${relRuleset}: invalid ruleset structure (missing rules array)`);
		return { findings };
	}

	checkLegRulesetConsistency(include, rulesetChecks, relRuleset, findings);
	return { findings };
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
