import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
	checkPlatformLegs,
	DRAFT_STEP_IF,
	DRAFT_STEP_NAME,
	main,
	REQUIRED_LEGS,
} from './check-platform-legs.mjs';
import {
	hissFixtures,
	makeRuleset,
	makeWorkflow,
	ownRoot,
	setupFixture,
} from './check-platform-legs.fixtures.mjs';

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

		it('exports DRAFT_STEP constants', () => {
			assert.equal(DRAFT_STEP_NAME, 'Stop on a draft pull request');
			assert.equal(DRAFT_STEP_IF, 'github.event.pull_request.draft == true');
		});
	});

	describe('matrix and job structure', () => {
		it('fails when jobs.portability is missing', async () => {
			const dir = await setupFixture(tempRoot, 'missing-portability-job', {
				workflow: makeWorkflow({ jobKey: 'other_job' }),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.equal(findings.length, 1);
			assert.match(findings[0], /jobs\.portability missing/);
			assert.equal(await main(dir), 1);
		});

		it('fails when matrix leg is unnamed or empty', async () => {
			const dir = await setupFixture(tempRoot, 'unnamed-leg', {
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
			const dir = await setupFixture(tempRoot, 'duplicate-leg-name', {
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
			const dir = await setupFixture(tempRoot, 'unexpected-leg-name', {
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
			const dir = await setupFixture(tempRoot, 'swapped-runners', {
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

		it('fails when Windows leg is removed from matrix', async () => {
			const dir = await setupFixture(tempRoot, 'no-windows-leg', {
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

		it('fails when strategy.matrix.exclude is present', async () => {
			const dir = await setupFixture(tempRoot, 'matrix-exclude', {
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
			const dir = await setupFixture(tempRoot, 'matrix-extra-axes', {
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
			const dir = await setupFixture(tempRoot, 'job-level-if', {
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
			const dir = await setupFixture(tempRoot, 'job-continue-on-error', {
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

		it('fails when portability job steps is not a non-empty list', async () => {
			const dir = await setupFixture(tempRoot, 'steps-empty', {
				workflow: makeWorkflow({ steps: [] }),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(findings.some((f) => /jobs\.portability\.steps must be a non-empty list/.test(f)));
			assert.equal(await main(dir), 1);
		});
	});

	describe('step guards and draft stop', () => {
		it('fails when step declares continue-on-error true', async () => {
			const dir = await setupFixture(tempRoot, 'step-continue-on-error', {
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

		it('fails when step declares if on lint step even when ending with exit 1', async () => {
			const dir = await setupFixture(tempRoot, 'step-if-lint-exit-1', {
				workflow: makeWorkflow({
					steps: [
						'      - name: Lint',
						'        if: false',
						'        run: |',
						'          pnpm lint',
						'          exit 1',
					],
				}),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(findings.some((f) => /steps\[0\] \('Lint'\) 'if' prohibited/.test(f)));
			assert.equal(await main(dir), 1);
		});

		it('fails when draft step declares exit 0 before exit 1', async () => {
			const dir = await setupFixture(tempRoot, 'draft-step-exit-0', {
				workflow: makeWorkflow({
					steps: [
						'      - name: Stop on a draft pull request',
						'        if: github.event.pull_request.draft == true',
						'        run: |',
						'          echo "Draft PR"',
						'          exit 0',
						'          exit 1',
					],
				}),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(
				findings.some((f) =>
					/steps\[0\] \('Stop on a draft pull request'\) draft-stop step must fail closed/.test(f),
				),
			);
			assert.equal(await main(dir), 1);
		});

		it('fails when draft step is placed at step index 1', async () => {
			const dir = await setupFixture(tempRoot, 'draft-step-index-1', {
				workflow: makeWorkflow({
					steps: [
						"      - run: 'true'",
						'      - name: Stop on a draft pull request',
						'        if: github.event.pull_request.draft == true',
						'        run: |',
						'          echo "Draft PR"',
						'          exit 1',
					],
				}),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(
				findings.some((f) =>
					/steps\[1\] \('Stop on a draft pull request'\) 'if' prohibited/.test(f),
				),
			);
			assert.equal(await main(dir), 1);
		});

		it('fails when draft step declares different if condition', async () => {
			const dir = await setupFixture(tempRoot, 'draft-step-different-if', {
				workflow: makeWorkflow({
					steps: [
						'      - name: Stop on a draft pull request',
						"        if: github.event_name == 'pull_request'",
						'        run: |',
						'          echo "Draft PR"',
						'          exit 1',
					],
				}),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(
				findings.some((f) =>
					/steps\[0\] \('Stop on a draft pull request'\) 'if' must be 'github\.event\.pull_request\.draft == true'/.test(
						f,
					),
				),
			);
			assert.equal(await main(dir), 1);
		});
	});

	describe('runner boundary and job attributes', () => {
		it('allows draft stop step with if when it fails closed with exit 1', async () => {
			const dir = await setupFixture(tempRoot, 'draft-stop-step-allowed', {
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

		it('counts ubuntu-latest as Linux OS family', async () => {
			const dir = await setupFixture(tempRoot, 'ubuntu-latest-leg', {
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
			const dir = await setupFixture(tempRoot, 'ubuntu-26-leg', {
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

		it('fails when job name template is renamed', async () => {
			const dir = await setupFixture(tempRoot, 'renamed-job-template', {
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
			const dir = await setupFixture(tempRoot, 'hardcoded-runs-on', {
				workflow: makeWorkflow({ runsOn: 'ubuntu-26.04' }),
				ruleset: makeRuleset(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.equal(findings.length, 1);
			assert.match(findings[0], /runs-on must be '\$\{\{ matrix\.runner \}\}'/);
			assert.equal(await main(dir), 1);
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
