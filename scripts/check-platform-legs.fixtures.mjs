import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ownRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
export const hissFixtures = join(ownRoot, '.config', 'hiss', 'testdata', 'HISS-21', 'internal');

export const WORKFLOW_DEFAULTS = {
	jobName: 'Platform Neutrality (${{ matrix.name }})',
	runsOn: '${{ matrix.runner }}',
	jobKey: 'portability',
	jobIf: undefined,
	continueOnError: undefined,
	extraMatrix: '',
	pullRequestBranches: ['main'],
	pushBranches: ['main'],
	legs: [
		{ name: 'Linux', runner: 'ubuntu-26.04' },
		{ name: 'macOS', runner: 'macos-26' },
		{ name: 'Windows', runner: 'windows-2025' },
	],
	steps: undefined,
};

export function legLine(leg) {
	const parts = [];
	if (leg.name !== undefined) parts.push(`name: ${leg.name}`);
	if (leg.runner !== undefined) parts.push(`runner: ${leg.runner}`);
	return '          - ' + parts.join('\n            ');
}

export function branchLines(branches) {
	return branches.map((b) => `      - '${b}'`).join('\n');
}

export function jobGuardLines({ jobIf, continueOnError }) {
	const lines = [];
	if (jobIf !== undefined) lines.push(`    if: ${jobIf}`);
	if (continueOnError !== undefined) lines.push(`    continue-on-error: ${continueOnError}`);
	return lines;
}

export function formatSteps(steps) {
	if (steps === undefined) {
		return ['    steps:', "      - run: 'true'"];
	}
	if (steps === null) {
		return [];
	}
	if (Array.isArray(steps) && steps.length === 0) {
		return ['    steps: []'];
	}
	if (typeof steps === 'string') {
		return [steps];
	}
	return ['    steps:', ...steps];
}

export function makeWorkflow(overrides = {}) {
	const o = { ...WORKFLOW_DEFAULTS, ...overrides };
	return [
		'name: Platform Neutrality',
		'on:',
		'  pull_request:',
		'    branches:',
		branchLines(o.pullRequestBranches),
		'  push:',
		'    branches:',
		branchLines(o.pushBranches),
		'jobs:',
		`  ${o.jobKey}:`,
		`    name: ${o.jobName}`,
		`    runs-on: ${o.runsOn}`,
		...jobGuardLines(o),
		'    strategy:',
		'      matrix:',
		'        include:',
		o.legs.map(legLine).join('\n'),
		...(o.extraMatrix ? [o.extraMatrix] : []),
		...formatSteps(o.steps),
		'',
	].join('\n');
}

/** Copy of `fields` without the keys whose value is undefined. */
export function definedOnly(fields) {
	return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

export function makeRuleset(
	contexts = [
		'Platform Neutrality (Linux)',
		'Platform Neutrality (macOS)',
		'Platform Neutrality (Windows)',
	],
	{ enforcement = 'active', target = 'branch', include = ['refs/heads/main'], exclude } = {},
) {
	const doc = {
		rules: [
			{
				parameters: {
					required_status_checks: contexts.map((context) => ({ context })),
				},
				type: 'required_status_checks',
			},
		],
	};
	Object.assign(doc, definedOnly({ enforcement, target }));
	const refName = definedOnly({ include, exclude });
	if (Object.keys(refName).length > 0) doc.conditions = { ref_name: refName };
	return JSON.stringify(doc, null, 2);
}

export async function setupFixture(baseDir, name, { workflow, ruleset } = {}) {
	const dir = join(baseDir, name);
	if (workflow !== undefined) {
		const wfDir = join(dir, '.github', 'workflows');
		await mkdir(wfDir, { recursive: true });
		await writeFile(join(wfDir, 'portability.yml'), workflow);
	}
	if (ruleset !== undefined) {
		const rsDir = join(dir, '.github', 'rulesets');
		await mkdir(rsDir, { recursive: true });
		await writeFile(join(rsDir, 'main.json'), ruleset);
	}
	return dir;
}
