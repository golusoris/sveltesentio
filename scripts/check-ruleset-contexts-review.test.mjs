// Review cases E1-E7: required contexts judged through the whole checker.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, it } from 'node:test';
import { IO_TIMEOUT_MS } from './check-platform-legs.mjs';
import {
	createTempRoot,
	fixture,
	makeRuleset,
	namedWorkflow,
	publishing,
	removeTempRoot,
	requiring,
	unpublished,
} from './check-ruleset.fixtures.mjs';
import { checkRuleset } from './check-ruleset.mjs';
import { withTimeout } from './check-template-labels.mjs';

before(createTempRoot);
after(removeTempRoot);

it('E1 reports gate-read and workflow-list errors for a regular file', async () => {
	const root = await fixture({
		ruleset: requiring('lint'),
		workflow: null,
		workflows: { '.github/workflows': 'regular file' },
	});
	const findings = [];
	await assert.rejects(
		readFile(join(root, '.github/workflows/ci.yml'), {
			encoding: 'utf8',
			signal: AbortSignal.timeout(IO_TIMEOUT_MS),
		}),
		(error) => {
			findings.push(`.github/workflows/ci.yml: cannot read file (${error.message})`);
			return true;
		},
	);
	await assert.rejects(
		withTimeout(
			readdir(join(root, '.github/workflows'), { withFileTypes: true }),
			IO_TIMEOUT_MS,
			'readdir .github/workflows',
		),
		(error) => {
			findings.push(`.github/workflows: cannot list workflows (${error.message})`);
			return true;
		},
	);
	assert.deepEqual(await checkRuleset(root), { findings });
});

for (const total of [100, 101]) {
	it(`E2 bounds the combined non-gate context count at ${total}`, async () => {
		const contexts = Array.from({ length: total }, (_, index) => `Context ${index}`);
		const ruleset = makeRuleset();
		for (let i = 0; i < total; i += 100) {
			ruleset.rules.push({
				type: 'required_status_checks',
				parameters: {
					required_status_checks: contexts.slice(i, i + 100).map((context) => ({ context })),
				},
			});
		}
		const root = await fixture({ ruleset, workflows: publishing(...contexts) });
		const findings =
			total === 100
				? []
				: [
						'.github/rulesets/main.json: requires 102 status checks, more than the limit of 100; ' +
							'required status checks were not matched',
					];
		assert.deepEqual(await checkRuleset(root), { findings });
	});
}

it('E2 rejects a single oversized check array before matching its contexts', async () => {
	const contexts = Array.from({ length: 100 }, (_, index) => `Context ${index}`);
	const root = await fixture({
		ruleset: requiring(...contexts),
		workflows: publishing(...contexts),
	});
	assert.deepEqual(await checkRuleset(root), {
		findings: [
			'.github/rulesets/main.json: requires 101 status checks, more than the limit of 100; ' +
				'required status checks were not matched',
		],
	});
});

/** Serialize the measured caller/callee naming contract for end-to-end matching. */
function reusableFixture() {
	return {
		'.github/workflows/caller.yml': namedWorkflow('Reusable', 'pull_request', {
			uses: './.github/workflows/callee.yml',
			'runs-on': undefined,
		}),
		'.github/workflows/callee.yml': JSON.stringify({
			on: 'workflow_call',
			jobs: {
				build: { name: 'Build', 'runs-on': 'ubuntu-26.04' },
				lint: {
					name: 'Lint (${{ matrix.os }})',
					'runs-on': 'ubuntu-26.04',
					strategy: { matrix: { os: ['linux', 'windows'] } },
				},
			},
		}),
	};
}

for (const context of ['Reusable / Build', 'Reusable']) {
	it(`E3 matches only the qualified reusable context ${context}`, async () => {
		const root = await fixture({
			ruleset: requiring(context),
			workflows: reusableFixture(),
		});
		const findings = context === 'Reusable' ? [unpublished(context)] : [];
		assert.deepEqual(await checkRuleset(root), { findings });
	});
}

for (const excluded of [false, true]) {
	it(`E4 expands several axes with excluded kit4 set to ${excluded}`, async () => {
		const context = excluded ? 'Fixture (kit4, linux)' : 'Fixture (kit3, linux)';
		const matrix = {
			kit: ['kit3', 'kit4'],
			os: ['linux'],
			...(excluded ? { exclude: [{ kit: 'kit4' }] } : {}),
		};
		const root = await fixture({
			ruleset: requiring(context),
			workflows: {
				'.github/workflows/matrix.yml': namedWorkflow(
					'Fixture (${{ matrix.kit }}, ${{ matrix.os }})',
					'pull_request',
					{ strategy: { matrix } },
				),
			},
		});
		assert.deepEqual(await checkRuleset(root), {
			findings: excluded ? [unpublished(context)] : [],
		});
	});
}

/** Spell the refusal of a job outside GitHub's two job forms. */
function invalidJob(file, id) {
	return (
		`.github/workflows/${file}: job '${id}' needs either runs-on or a reusable uses, ` +
		'not both or neither, so GitHub refuses the workflow; its jobs were not matched'
	);
}

it('E5 accepts a skipped publisher with a constant-false condition', async () => {
	const root = await fixture({
		ruleset: requiring('Build'),
		workflows: {
			'.github/workflows/build.yml': namedWorkflow('Build', 'pull_request', { if: false }),
		},
	});
	assert.deepEqual(await checkRuleset(root), { findings: [] });
});

it('E5 rejects a publisher without a runner', async () => {
	const root = await fixture({
		ruleset: requiring('Build'),
		workflows: {
			'.github/workflows/build.yml': namedWorkflow('Build', 'pull_request', {
				'runs-on': undefined,
			}),
		},
	});
	assert.deepEqual(await checkRuleset(root), {
		findings: [invalidJob('build.yml', 'check'), unpublished('Build')],
	});
});

const callee = JSON.stringify({
	on: { workflow_call: {} },
	jobs: { run: { 'runs-on': 'ubuntu-26.04', steps: [] } },
});

for (const [label, sibling, refused] of [
	['without a runner', { name: 'Broken' }, true],
	[
		'with both a runner and a reusable call',
		{ name: 'Reuse', uses: './.github/workflows/x.yml', 'runs-on': 'ubuntu-26.04' },
		true,
	],
	['with a reusable call only', { name: 'Reuse', uses: './.github/workflows/x.yml' }, false],
]) {
	it(`E7 judges a valid publisher beside a sibling job ${label}`, async () => {
		const workflow = JSON.stringify({
			on: 'pull_request',
			jobs: { check: { name: 'Build', 'runs-on': 'ubuntu-26.04' }, broken: sibling },
		});
		const root = await fixture({
			ruleset: requiring('Build', 'Reuse / run'),
			workflows: { '.github/workflows/build.yml': workflow, '.github/workflows/x.yml': callee },
		});
		const findings = refused
			? [invalidJob('build.yml', 'broken'), unpublished('Build'), unpublished('Reuse / run')]
			: [];
		assert.deepEqual(await checkRuleset(root), { findings });
	});
}

for (const trigger of [
	{ branches: ['*'] },
	{ branches: ['**/main'] },
	{ 'branches-ignore': ['release/*'] },
]) {
	it(`E6 accepts main covered by ${JSON.stringify(trigger)}`, async () => {
		const root = await fixture({
			ruleset: requiring('Build'),
			workflows: {
				'.github/workflows/build.yml': namedWorkflow('Build', { pull_request: trigger }),
			},
		});
		assert.deepEqual(await checkRuleset(root), { findings: [] });
	});
}
