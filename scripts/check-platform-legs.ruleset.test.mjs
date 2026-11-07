import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { checkPlatformLegs, main } from './check-platform-legs.mjs';
import { makeRuleset, makeWorkflow, setupFixture } from './check-platform-legs.fixtures.mjs';

describe('check-platform-legs ruleset checks', () => {
	let tempRoot;

	before(async () => {
		tempRoot = await mkdtemp(join(tmpdir(), 'cpl-ruleset-test-'));
	});

	after(async () => {
		if (tempRoot) {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	describe('envelope and structure', () => {
		it('fails when ruleset file is missing', async () => {
			const dir = await setupFixture(tempRoot, 'missing-ruleset', {
				workflow: makeWorkflow(),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.equal(findings.length, 1);
			assert.match(findings[0], /main\.json: cannot read file/);
			assert.equal(await main(dir), 1);
		});

		it('fails when ruleset enforcement is not active', async () => {
			const dir = await setupFixture(tempRoot, 'ruleset-enforcement-inactive', {
				workflow: makeWorkflow(),
				ruleset: makeRuleset(undefined, { enforcement: 'disabled' }),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(findings.some((f) => /ruleset enforcement must be 'active'/.test(f)));
			assert.equal(await main(dir), 1);
		});

		it('fails when ruleset target is not branch', async () => {
			const dir = await setupFixture(tempRoot, 'ruleset-target-not-branch', {
				workflow: makeWorkflow(),
				ruleset: makeRuleset(undefined, { target: 'tag' }),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.ok(findings.some((f) => /ruleset target must be 'branch'/.test(f)));
			assert.equal(await main(dir), 1);
		});

		it('fails when ruleset conditions do not include refs/heads/main', async () => {
			const dir = await setupFixture(tempRoot, 'ruleset-missing-main-include', {
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
	});

	describe('ref excludes', () => {
		it('fails when ruleset exclude removes included ref refs/heads/main', async () => {
			const dir = await setupFixture(tempRoot, 'ruleset-exclude-main', {
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
			const dir = await setupFixture(tempRoot, 'ruleset-exclude-all', {
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

		it('allows empty ruleset exclude array', async () => {
			const dir = await setupFixture(tempRoot, 'ruleset-empty-exclude', {
				workflow: makeWorkflow(),
				ruleset: makeRuleset(undefined, { exclude: [] }),
			});
			const { findings } = await checkPlatformLegs(dir);
			assert.deepEqual(findings, []);
			assert.equal(await main(dir), 0);
		});

		it('allows ruleset exclude matching non-included refs', async () => {
			const dir = await setupFixture(tempRoot, 'ruleset-feature-exclude', {
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
	});

	describe('trigger coverage', () => {
		it('fails when pull_request.branches misses ruleset branch pattern', async () => {
			const dir = await setupFixture(tempRoot, 'missing-pr-trigger-branch', {
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
			const dir = await setupFixture(tempRoot, 'missing-push-trigger-branch', {
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
	});

	describe('context coverage', () => {
		it('fails when macOS context is removed from ruleset', async () => {
			const dir = await setupFixture(tempRoot, 'no-macos-context', {
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
			const dir = await setupFixture(tempRoot, 'extra-ruleset-context', {
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
	});
});
