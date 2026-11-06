import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkPlatformLegs, main, REQUIRED_LEGS } from './check-platform-legs.mjs';

const ownRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const hissFixtures = join(ownRoot, '.config', 'hiss', 'testdata', 'HISS-21', 'internal');

const WORKFLOW_DEFAULTS = {
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

function legLine(leg) {
	const parts = [];
	if (leg.name !== undefined) parts.push(`name: ${leg.name}`);
	if (leg.runner !== undefined) parts.push(`runner: ${leg.runner}`);
	return '          - ' + parts.join('\n            ');
}

function branchLines(branches) {
	return branches.map((b) => `      - '${b}'`).join('\n');
}

function jobGuardLines({ jobIf, continueOnError }) {
	const lines = [];
	if (jobIf !== undefined) lines.push(`    if: ${jobIf}`);
	if (continueOnError !== undefined) lines.push(`    continue-on-error: ${continueOnError}`);
	return lines;
}

function formatSteps(steps) {
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

function makeWorkflow(overrides = {}) {
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
function definedOnly(fields) {
	return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function makeRuleset(
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

describe('check-platform-legs', () => {
	let tempRoot;

	before(async () => {
		tempRoot = await mkdtemp(join(tmpdir(), 'cpl-test-'));
	});

	after(async () => {
		if (tempRoot) {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	async function setupFixture(name, { workflow, ruleset } = {}) {
		const dir = join(tempRoot, name);
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

	describe('positive cases', () => {
		it('accepts current repository setup', async () => {
			assert.equal(await main(ownRoot), 0);
		});

		it('exports REQUIRED_LEGS mapping', () => {
			assert.deepEqual(REQUIRED_LEGS, {
				Linux: 'ubuntu-',
				macOS: 'macos-',
				Windows: 'windows-',
			});
		});
	});

	describe('negative cases', () => {
		it('fails when jobs.portability is missing', async () => {
			const dir = await setupFixture('missing-portability-job', {
				workflow: makeWorkflow({ jobKey: 'other_job' }),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.equal(findings.length, 1);
			assert.match(findings[0], /jobs\.portability missing/);
			assert.equal(await main(dir), 1);
		});

		it('fails when matrix leg is unnamed or empty', async () => {
			const dir = await setupFixture('unnamed-leg', {
				workflow: makeWorkflow({
					legs: [
						{ runner: 'ubuntu-26.04' },
						{ name: 'macOS', runner: 'macos-26' },
						{ name: 'Windows', runner: 'windows-2025' },
					],
				}),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(findings.some((f) => /matrix include leg missing non-empty string 'name'/.test(f)));
			assert.equal(await main(dir), 1);
		});

		it('fails when matrix has duplicate leg names', async () => {
			const dir = await setupFixture('duplicate-leg-name', {
				workflow: makeWorkflow({
					legs: [
						{ name: 'Linux', runner: 'ubuntu-26.04' },
						{ name: 'Linux', runner: 'ubuntu-24.04' },
						{ name: 'macOS', runner: 'macos-26' },
						{ name: 'Windows', runner: 'windows-2025' },
					],
				}),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(findings.some((f) => /duplicate matrix leg name 'Linux'/.test(f)));
			assert.equal(await main(dir), 1);
		});

		it('fails when matrix leg name is not in REQUIRED_LEGS', async () => {
			const dir = await setupFixture('unexpected-leg-name', {
				workflow: makeWorkflow({
					legs: [
						{ name: 'Linux', runner: 'ubuntu-26.04' },
						{ name: 'macOS', runner: 'macos-26' },
						{ name: 'Windows', runner: 'windows-2025' },
						{ name: 'FreeBSD', runner: 'freebsd-14' },
					],
				}),
				ruleset: makeRuleset([
					'Platform Neutrality (Linux)',
					'Platform Neutrality (macOS)',
					'Platform Neutrality (Windows)',
					'Platform Neutrality (FreeBSD)',
				]),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(findings.some((f) => /unexpected matrix leg 'FreeBSD'/.test(f)));
			assert.equal(await main(dir), 1);
		});

		it('fails when runners are swapped between OS families', async () => {
			const dir = await setupFixture('swapped-runners', {
				workflow: makeWorkflow({
					legs: [
						{ name: 'Linux', runner: 'windows-2025' },
						{ name: 'macOS', runner: 'macos-26' },
						{ name: 'Windows', runner: 'ubuntu-26.04' },
					],
				}),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(
				findings.some((f) =>
					/matrix leg 'Linux' runner "windows-2025" must start with 'ubuntu-'/.test(f),
				),
			);
			assert.ok(
				findings.some((f) =>
					/matrix leg 'Windows' runner "ubuntu-26.04" must start with 'windows-'/.test(f),
				),
			);
			assert.equal(await main(dir), 1);
		});

		it('fails when strategy.matrix.exclude is present', async () => {
			const dir = await setupFixture('matrix-exclude', {
				workflow: makeWorkflow({
					extraMatrix:
						'        exclude:\n          - name: Windows\n            runner: windows-2025',
				}),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(findings.some((f) => /strategy\.matrix\.exclude is prohibited/.test(f)));
			assert.equal(await main(dir), 1);
		});

		it('fails when strategy.matrix defines extra axes', async () => {
			const dir = await setupFixture('matrix-extra-axes', {
				workflow: makeWorkflow({
					extraMatrix: '        os: [ubuntu-latest]',
				}),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(findings.some((f) => /strategy\.matrix contains forbidden key 'os'/.test(f)));
			assert.equal(await main(dir), 1);
		});

		it('fails when portability job declares job-level if', async () => {
			const dir = await setupFixture('job-level-if', {
				workflow: makeWorkflow({ jobIf: "github.event_name == 'push'" }),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(
				findings.some((f) => /job-level 'if' condition is prohibited on portability job/.test(f)),
			);
			assert.equal(await main(dir), 1);
		});

		it('fails when portability job declares continue-on-error true', async () => {
			const dir = await setupFixture('job-continue-on-error', {
				workflow: makeWorkflow({ continueOnError: true }),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(
				findings.some((f) =>
					/job-level 'continue-on-error' is prohibited on portability job/.test(f),
				),
			);
			assert.equal(await main(dir), 1);
		});

		it('fails when step declares if on lint step without failing closed', async () => {
			const dir = await setupFixture('step-if-lint', {
				workflow: makeWorkflow({
					steps: ['      - name: Lint', '        if: false', '        run: pnpm lint'],
				}),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(
				findings.some((f) =>
					/steps\[0\] 'if' prohibited unless step fails closed \(last run line 'exit 1'\)/.test(f),
				),
			);
			assert.equal(await main(dir), 1);
		});

		it('fails when step declares continue-on-error true', async () => {
			const dir = await setupFixture('step-continue-on-error', {
				workflow: makeWorkflow({
					steps: [
						'      - name: Lint',
						'        continue-on-error: true',
						'        run: pnpm lint',
					],
				}),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(findings.some((f) => /steps\[0\] \('Lint'\) continue-on-error prohibited/.test(f)));
			assert.equal(await main(dir), 1);
		});

		it('fails when portability job steps is not a non-empty list', async () => {
			const dir = await setupFixture('steps-empty', {
				workflow: makeWorkflow({ steps: [] }),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(findings.some((f) => /jobs\.portability\.steps must be a non-empty list/.test(f)));
			assert.equal(await main(dir), 1);
		});

		it('fails when ruleset exclude removes included ref refs/heads/main', async () => {
			const dir = await setupFixture('ruleset-exclude-main', {
				workflow: makeWorkflow(),
				ruleset: makeRuleset(undefined, {
					exclude: ['refs/heads/main'],
				}),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(
				findings.some((f) =>
					/exclude refs\/heads\/main removes included ref refs\/heads\/main/.test(f),
				),
			);
			assert.equal(await main(dir), 1);
		});

		it('fails when ruleset exclude contains ~ALL', async () => {
			const dir = await setupFixture('ruleset-exclude-all', {
				workflow: makeWorkflow(),
				ruleset: makeRuleset(undefined, {
					exclude: ['~ALL'],
				}),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(
				findings.some((f) => /exclude ~ALL removes included ref refs\/heads\/main/.test(f)),
			);
			assert.equal(await main(dir), 1);
		});

		it('fails when ruleset enforcement is not active', async () => {
			const dir = await setupFixture('ruleset-enforcement-inactive', {
				workflow: makeWorkflow(),
				ruleset: makeRuleset(undefined, { enforcement: 'disabled' }),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(findings.some((f) => /ruleset enforcement must be 'active'/.test(f)));
			assert.equal(await main(dir), 1);
		});

		it('fails when ruleset target is not branch', async () => {
			const dir = await setupFixture('ruleset-target-not-branch', {
				workflow: makeWorkflow(),
				ruleset: makeRuleset(undefined, { target: 'tag' }),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(findings.some((f) => /ruleset target must be 'branch'/.test(f)));
			assert.equal(await main(dir), 1);
		});

		it('fails when ruleset conditions do not include refs/heads/main', async () => {
			const dir = await setupFixture('ruleset-missing-main-include', {
				workflow: makeWorkflow(),
				ruleset: makeRuleset(undefined, { include: ['refs/heads/develop'] }),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(
				findings.some((f) =>
					/ruleset conditions\.ref_name\.include must contain 'refs\/heads\/main'/.test(f),
				),
			);
			assert.equal(await main(dir), 1);
		});

		it('fails when pull_request.branches misses ruleset branch pattern', async () => {
			const dir = await setupFixture('missing-pr-trigger-branch', {
				workflow: makeWorkflow({ pullRequestBranches: ['main'] }),
				ruleset: makeRuleset(undefined, {
					include: ['refs/heads/main', 'refs/heads/lts-*'],
				}),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(findings.some((f) => /on\.pull_request\.branches must contain 'lts-\*'/.test(f)));
			assert.equal(await main(dir), 1);
		});

		it('fails when push.branches misses ruleset branch pattern', async () => {
			const dir = await setupFixture('missing-push-trigger-branch', {
				workflow: makeWorkflow({
					pullRequestBranches: ['main', 'lts-*'],
					pushBranches: ['main'],
				}),
				ruleset: makeRuleset(undefined, {
					include: ['refs/heads/main', 'refs/heads/lts-*'],
				}),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(findings.some((f) => /on\.push\.branches must contain 'lts-\*'/.test(f)));
			assert.equal(await main(dir), 1);
		});

		it('fails when Windows leg is removed from matrix', async () => {
			const dir = await setupFixture('no-windows-leg', {
				workflow: makeWorkflow({
					legs: [
						{ name: 'Linux', runner: 'ubuntu-26.04' },
						{ name: 'macOS', runner: 'macos-26' },
					],
				}),
				ruleset: makeRuleset(['Platform Neutrality (Linux)', 'Platform Neutrality (macOS)']),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.equal(findings.length, 1);
			assert.match(findings[0], /matrix include lacks a leg with runner on OS family windows-\*/);
			assert.equal(await main(dir), 1);
		});

		it('fails when macOS context is removed from ruleset', async () => {
			const dir = await setupFixture('no-macos-context', {
				workflow: makeWorkflow(),
				ruleset: makeRuleset(['Platform Neutrality (Linux)', 'Platform Neutrality (Windows)']),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.equal(findings.length, 1);
			assert.match(
				findings[0],
				/required_status_checks lacks 'Platform Neutrality \(macOS\)' for matrix leg 'macOS'/,
			);
			assert.equal(await main(dir), 1);
		});

		it('fails when extra ruleset context has no matching leg', async () => {
			const dir = await setupFixture('extra-ruleset-context', {
				workflow: makeWorkflow(),
				ruleset: makeRuleset([
					'Platform Neutrality (Linux)',
					'Platform Neutrality (macOS)',
					'Platform Neutrality (Windows)',
					'Platform Neutrality (Solaris)',
				]),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.equal(findings.length, 1);
			assert.match(
				findings[0],
				/required status check 'Platform Neutrality \(Solaris\)' has no matching leg in matrix/,
			);
			assert.equal(await main(dir), 1);
		});

		it('fails when job name template is renamed', async () => {
			const dir = await setupFixture('renamed-job-template', {
				workflow: makeWorkflow({ jobName: 'Platform (${{ matrix.name }})' }),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.equal(findings.length, 1);
			assert.match(
				findings[0],
				/job name template must be 'Platform Neutrality \(\${{ matrix.name }}\)'/,
			);
			assert.equal(await main(dir), 1);
		});

		it('fails when runs-on is hardcoded instead of the matrix runner', async () => {
			const dir = await setupFixture('hardcoded-runs-on', {
				workflow: makeWorkflow({ runsOn: 'ubuntu-26.04' }),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.equal(findings.length, 1);
			assert.match(findings[0], /runs-on must be '\$\{\{ matrix\.runner \}\}'/);
			assert.equal(await main(dir), 1);
		});

		it('fails when ruleset file is missing', async () => {
			const dir = await setupFixture('missing-ruleset', {
				workflow: makeWorkflow(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.equal(findings.length, 1);
			assert.match(findings[0], /main\.json: cannot read file/);
			assert.equal(await main(dir), 1);
		});
	});

	describe('boundary cases', () => {
		it('allows draft stop step with if when it fails closed with exit 1', async () => {
			const dir = await setupFixture('draft-stop-step-allowed', {
				workflow: makeWorkflow({
					steps: [
						'      - name: Stop on a draft pull request',
						'        if: github.event.pull_request.draft == true',
						'        run: |',
						'          echo "Draft PR"',
						'          exit 1',
						"      - run: 'true'",
					],
				}),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.deepEqual(findings, []);
			assert.equal(await main(dir), 0);
		});

		it('allows empty ruleset exclude array', async () => {
			const dir = await setupFixture('ruleset-empty-exclude', {
				workflow: makeWorkflow(),
				ruleset: makeRuleset(undefined, { exclude: [] }),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.deepEqual(findings, []);
			assert.equal(await main(dir), 0);
		});

		it('allows ruleset exclude matching non-included refs', async () => {
			const dir = await setupFixture('ruleset-feature-exclude', {
				workflow: makeWorkflow(),
				ruleset: makeRuleset(undefined, {
					include: ['refs/heads/main'],
					exclude: ['refs/heads/feature/*'],
				}),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.deepEqual(findings, []);
			assert.equal(await main(dir), 0);
		});

		it('counts ubuntu-latest as Linux OS family', async () => {
			const dir = await setupFixture('ubuntu-latest-leg', {
				workflow: makeWorkflow({
					legs: [
						{ name: 'Linux', runner: 'ubuntu-latest' },
						{ name: 'macOS', runner: 'macos-26' },
						{ name: 'Windows', runner: 'windows-2025' },
					],
				}),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.deepEqual(findings, []);
			assert.equal(await main(dir), 0);
		});

		it('counts ubuntu-26.04 as Linux OS family', async () => {
			const dir = await setupFixture('ubuntu-26-leg', {
				workflow: makeWorkflow({
					legs: [
						{ name: 'Linux', runner: 'ubuntu-26.04' },
						{ name: 'macOS', runner: 'macos-26' },
						{ name: 'Windows', runner: 'windows-2025' },
					],
				}),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.deepEqual(findings, []);
			assert.equal(await main(dir), 0);
		});
	});

	describe('HISS-21 coverage fixtures', () => {
		it('refuses the positive fixture (matrix lacking Windows leg)', async () => {
			assert.equal(await main(join(hissFixtures, 'positive')), 1);
		});

		it('accepts the negative fixture (all three legs + ruleset)', async () => {
			assert.equal(await main(join(hissFixtures, 'negative')), 0);
		});
	});
});
