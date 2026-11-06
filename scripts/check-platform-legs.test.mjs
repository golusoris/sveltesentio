import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkPlatformLegs, main } from './check-platform-legs.mjs';

const ownRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const hissFixtures = join(ownRoot, '.config', 'hiss', 'testdata', 'HISS-21', 'internal');

function makeWorkflow({
	jobName = 'Platform Neutrality (${{ matrix.name }})',
	runsOn = '${{ matrix.runner }}',
	legs = [
		{ name: 'Linux', runner: 'ubuntu-26.04' },
		{ name: 'macOS', runner: 'macos-26' },
		{ name: 'Windows', runner: 'windows-2025' },
	],
} = {}) {
	const legLines = legs
		.map((l) => `          - name: ${l.name}\n            runner: ${l.runner}`)
		.join('\n');
	return [
		'name: Platform Neutrality',
		'on: [push]',
		'jobs:',
		'  portability:',
		`    name: ${jobName}`,
		`    runs-on: ${runsOn}`,
		'    strategy:',
		'      matrix:',
		'        include:',
		legLines,
		'    steps:',
		"      - run: 'true'",
		'',
	].join('\n');
}

function makeRuleset(
	contexts = [
		'Platform Neutrality (Linux)',
		'Platform Neutrality (macOS)',
		'Platform Neutrality (Windows)',
	],
) {
	return JSON.stringify(
		{
			rules: [
				{
					parameters: {
						required_status_checks: contexts.map((context) => ({ context })),
					},
					type: 'required_status_checks',
				},
			],
		},
		null,
		2,
	);
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
	});

	describe('negative cases', () => {
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
