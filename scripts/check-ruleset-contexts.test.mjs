// Required contexts must resolve to jobs published for pull requests targeting main.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, it } from 'node:test';
import { parse } from 'yaml';
import { IO_TIMEOUT_MS } from './check-platform-legs.mjs';
import {
	createTempRoot,
	fixture,
	makeRuleset,
	ownRoot,
	removeTempRoot,
	validWorkflow,
} from './check-ruleset.fixtures.mjs';
import { checkRuleset } from './check-ruleset.mjs';
import { withTimeout } from './check-template-labels.mjs';

before(createTempRoot);
after(removeTempRoot);

/** Add required contexts while preserving the default CI Gate contract. */
function requiring(...contexts) {
	const ruleset = makeRuleset();
	ruleset.rules[1].parameters.required_status_checks.push(
		...contexts.map((context) => ({ context })),
	);
	return ruleset;
}

/** Serialize a workflow with one named job and an explicit trigger shape. */
function namedWorkflow(name, trigger = 'pull_request', job = {}) {
	return JSON.stringify({ on: trigger, jobs: { check: { name, ...job } } });
}

/** Spell the public diagnostic independently of the checker implementation. */
function unpublished(context) {
	return (
		`.github/rulesets/main.json: required status check '${context}' is not published ` +
		'by any job of a pull_request workflow in .github/workflows, ' +
		'so it never reports and main cannot merge'
	);
}

/** Read repository fixture inputs with the same explicit I/O deadline as other script tests. */
async function repositoryFile(relPath) {
	return readFile(join(ownRoot, relPath), {
		encoding: 'utf8',
		signal: AbortSignal.timeout(IO_TIMEOUT_MS),
	});
}

/** Copy the live ruleset, all workflow files, and CODEOWNERS before planting retired contexts. */
async function plantedRepository(contexts) {
	const ruleset = JSON.parse(await repositoryFile('.github/rulesets/main.json'));
	const rule = ruleset.rules.find((entry) => entry.type === 'required_status_checks');
	rule.parameters.required_status_checks.push(...contexts.map((context) => ({ context })));
	const entries = await withTimeout(
		readdir(join(ownRoot, '.github/workflows'), { withFileTypes: true }),
		IO_TIMEOUT_MS,
		'readdir repository workflows',
	);
	assert.ok(entries.length <= 100, 'repository workflow fixtures must fit the scanner limit');
	const workflows = {};
	for (let i = 0; i < entries.length; i++) {
		if (!entries[i].isFile()) continue;
		const relPath = `.github/workflows/${entries[i].name}`;
		workflows[relPath] = await repositoryFile(relPath);
	}
	return fixture({
		ruleset,
		workflow: null,
		workflows,
		owners: { '.github/CODEOWNERS': await repositoryFile('.github/CODEOWNERS') },
	});
}

it('P1 accepts every required context in the repository', async () => {
	assert.deepEqual(await checkRuleset(ownRoot), { findings: [] });
});

it('P2 accepts literals, job ids, both matrix shapes, and unfiltered base branches', async () => {
	const workflow =
		validWorkflow
			.replace('  lint:\n', '  lint:\n    name: Lint\n')
			.replace('needs: [lint]', 'needs: [lint, lint-by-id]') +
		'\n  lint-by-id:\n    runs-on: ubuntu-26.04';
	const root = await fixture({
		workflow,
		ruleset: requiring(
			'Lint',
			'lint-by-id',
			'Platform Neutrality (Linux)',
			'Platform Neutrality (macOS)',
			'Fixture (kit3)',
			'REUSE lint',
		),
		workflows: {
			'.github/workflows/platforms.yml': namedWorkflow(
				'Platform Neutrality (${{ matrix.name }})',
				{ pull_request: { branches: ['main'] } },
				{ strategy: { matrix: { include: [{ name: 'Linux' }, { name: 'macOS' }] } } },
			),
			'.github/workflows/fixture.yml': namedWorkflow(
				'Fixture (${{matrix.kit}})',
				['push', 'pull_request'],
				{ strategy: { matrix: { kit: ['kit3'] } } },
			),
			'.github/workflows/reuse.yml': namedWorkflow('REUSE lint', {
				pull_request: { types: ['opened', 'synchronize', 'reopened'] },
			}),
		},
	});
	assert.deepEqual(await checkRuleset(root), { findings: [] });
});

it('P3 accepts an unfiltered publisher alongside a paths-filtered publisher', async () => {
	const root = await fixture({
		ruleset: requiring('Shared'),
		workflows: {
			'.github/workflows/filtered.yml': namedWorkflow('Shared', {
				pull_request: { paths: ['src/**'] },
			}),
			'.github/workflows/unfiltered.yml': namedWorkflow('Shared'),
		},
	});
	assert.deepEqual(await checkRuleset(root), { findings: [] });
});

it('N1 rejects the three retired contexts from the 6fa7595 regression', async () => {
	const contexts = [
		'verify',
		'Standards & Invariant Verification Gate',
		'DCO 1.1 & REUSE Compliance Gate',
	];
	const root = await plantedRepository(contexts);
	assert.deepEqual(await checkRuleset(root), { findings: contexts.map(unpublished) });
});

it('N2 rejects a context published only on push', async () => {
	const root = await fixture({
		ruleset: requiring('Push only'),
		workflows: {
			'.github/workflows/push.yml': namedWorkflow('Push only', { push: { branches: ['main'] } }),
		},
	});
	assert.deepEqual(await checkRuleset(root), { findings: [unpublished('Push only')] });
});

it('N3 rejects a context published only on pull_request_target', async () => {
	const root = await fixture({
		ruleset: requiring('Target only'),
		workflows: {
			'.github/workflows/target.yml': namedWorkflow('Target only', 'pull_request_target'),
		},
	});
	assert.deepEqual(await checkRuleset(root), { findings: [unpublished('Target only')] });
});

it('N4 rejects a publisher with pull_request paths', async () => {
	const root = await fixture({
		ruleset: requiring('Filtered'),
		workflows: {
			'.github/workflows/filtered.yml': namedWorkflow('Filtered', {
				pull_request: { paths: ['src/**'] },
			}),
		},
	});
	assert.deepEqual(await checkRuleset(root), {
		findings: [
			'.github/workflows/filtered.yml: on.pull_request.paths can skip the workflow ' +
				"and leave 'Filtered' pending",
		],
	});
});

it('N5 rejects a publisher whose branches omit main', async () => {
	const root = await fixture({
		ruleset: requiring('LTS only'),
		workflows: {
			'.github/workflows/lts.yml': namedWorkflow('LTS only', {
				pull_request: { branches: ['lts-*'] },
			}),
		},
	});
	assert.deepEqual(await checkRuleset(root), {
		findings: [
			'.github/workflows/lts.yml: on.pull_request.branches must include main ' +
				"for required status check 'LTS only'",
		],
	});
});

it('N6 rejects a publisher missing synchronize and reopened types', async () => {
	const root = await fixture({
		ruleset: requiring('Opened only'),
		workflows: {
			'.github/workflows/opened.yml': namedWorkflow('Opened only', {
				pull_request: { types: ['opened'] },
			}),
		},
	});
	assert.deepEqual(await checkRuleset(root), {
		findings: [
			'.github/workflows/opened.yml: on.pull_request.types must include opened, ' +
				"synchronize and reopened for required status check 'Opened only'",
		],
	});
});

it('N7 rejects the bare name of a reusable workflow call', async () => {
	const root = await fixture({
		ruleset: requiring('Reusable'),
		workflows: {
			'.github/workflows/caller.yml': namedWorkflow('Reusable', 'pull_request', {
				uses: './.github/workflows/callee.yml',
			}),
		},
	});
	assert.deepEqual(await checkRuleset(root), { findings: [unpublished('Reusable')] });
});

it('N8 rejects a bare matrix job name without a matrix expression', async () => {
	const root = await fixture({
		ruleset: requiring('Matrix'),
		workflows: {
			'.github/workflows/matrix.yml': namedWorkflow('Matrix', 'pull_request', {
				strategy: { matrix: { os: ['linux'] } },
			}),
		},
	});
	assert.deepEqual(await checkRuleset(root), { findings: [unpublished('Matrix')] });
});

it('N9 rejects a non-gate context pinned to another integration', async () => {
	const ruleset = requiring('lint');
	ruleset.rules[1].parameters.required_status_checks[1].integration_id = 57789;
	const root = await fixture({ ruleset });
	assert.deepEqual(await checkRuleset(root), {
		findings: [
			".github/rulesets/main.json: required status check 'lint' is pinned to " +
				'integration 57789; only GitHub Actions contexts can be matched against workflow jobs',
		],
	});
});

it('N10 reports an unparsable workflow without losing a valid publisher', async () => {
	const source = 'on: [';
	let expected;
	assert.throws(
		() => parse(source),
		(error) => {
			expected = `.github/workflows/bad.yml: unparsable YAML (${error.message})`;
			return true;
		},
	);
	const root = await fixture({
		ruleset: requiring('lint'),
		workflows: { '.github/workflows/bad.yml': source },
	});
	assert.deepEqual(await checkRuleset(root), { findings: [expected] });
});

for (const total of [100, 101]) {
	it(`B1 handles exactly ${total} workflow directory entries`, async () => {
		const workflows = Object.fromEntries(
			Array.from({ length: total - 1 }, (_, index) => [
				`.github/workflows/ignored-${index}.txt`,
				'ignored',
			]),
		);
		const root = await fixture({ ruleset: requiring('lint'), workflows });
		const findings =
			total === 100
				? []
				: [
						'.github/workflows: holds 101 entries, more than the limit of 100; ' +
							'required status checks were not matched',
					];
		assert.deepEqual(await checkRuleset(root), { findings });
	});
}

for (const total of [256, 257]) {
	it(`B2 handles exactly ${total} include matrix entries`, async () => {
		const include = Array.from({ length: total }, (_, index) => ({ name: `leg-${index}` }));
		const root = await fixture({
			ruleset: requiring('Matrix (leg-255)'),
			workflows: {
				'.github/workflows/matrix.yml': namedWorkflow(
					'Matrix (${{ matrix.name }})',
					'pull_request',
					{ strategy: { matrix: { include } } },
				),
			},
		});
		const findings = total === 256 ? [] : [unpublished('Matrix (leg-255)')];
		assert.deepEqual(await checkRuleset(root), { findings });
	});
}

for (const extension of ['yml.bak', 'json', 'yaml']) {
	it(`B3 handles the ${extension} workflow extension`, async () => {
		const root = await fixture({
			ruleset: requiring('Extension'),
			workflows: {
				[`.github/workflows/x.${extension}`]: namedWorkflow('Extension'),
			},
		});
		const findings = extension === 'yaml' ? [] : [unpublished('Extension')];
		assert.deepEqual(await checkRuleset(root), { findings });
	});
}

it('B4 preserves the gate-only missing-workflow diagnostic exactly', async () => {
	const root = await fixture({ workflow: null });
	let expected;
	await assert.rejects(
		readFile(join(root, '.github/workflows/ci.yml'), {
			encoding: 'utf8',
			signal: AbortSignal.timeout(IO_TIMEOUT_MS),
		}),
		(error) => {
			expected = `.github/workflows/ci.yml: cannot read file (${error.message})`;
			return true;
		},
	);
	assert.deepEqual(await checkRuleset(root), { findings: [expected] });
});

const unsupportedMatrices = [
	['several axes', { kit: ['kit3'], os: ['linux'] }],
	['exclude entries', { kit: ['kit3'], exclude: [{ kit: 'kit3' }] }],
	['dynamic matrix', '${{ fromJSON(inputs.matrix) }}'],
	['non-scalar axis', { kit: [{ name: 'kit3' }] }],
	['missing referenced key', { include: [{ other: 'kit3' }] }],
	['non-object include entry', { include: ['kit3'] }],
];

for (let i = 0; i < unsupportedMatrices.length; i++) {
	const [name, matrix] = unsupportedMatrices[i];
	it(`A1 rejects ${name}`, async () => {
		const root = await fixture({
			ruleset: requiring('Fixture (kit3)'),
			workflows: {
				'.github/workflows/matrix.yml': namedWorkflow(
					'Fixture (${{ matrix.kit }})',
					'pull_request',
					{ strategy: { matrix } },
				),
			},
		});
		assert.deepEqual(await checkRuleset(root), { findings: [unpublished('Fixture (kit3)')] });
	});
}

it('A2 rejects expressions outside the matrix name allow-list', async () => {
	const name = 'Fixture (${{ matrix.kit }}) ${{ github.job }}';
	const root = await fixture({
		ruleset: requiring('Fixture (kit3) ${{ github.job }}'),
		workflows: {
			'.github/workflows/expression.yml': namedWorkflow(name, 'pull_request', {
				strategy: { matrix: { kit: ['kit3'] } },
			}),
		},
	});
	assert.deepEqual(await checkRuleset(root), {
		findings: [unpublished('Fixture (kit3) ${{ github.job }}')],
	});
});

it('A3 resolves repeated keys, hyphenated keys, numbers, and booleans', async () => {
	const root = await fixture({
		ruleset: requiring('Scalar (1/1)', 'Scalar (true/true)'),
		workflows: {
			'.github/workflows/scalars.yml': namedWorkflow(
				'Scalar (${{matrix.axis-key}}/${{ matrix.axis-key }})',
				'pull_request',
				{ strategy: { matrix: { 'axis-key': [1, true] } } },
			),
		},
	});
	assert.deepEqual(await checkRuleset(root), { findings: [] });
});

it('A4 checks contexts from every required_status_checks rule', async () => {
	const ruleset = makeRuleset();
	ruleset.rules.push({
		type: 'required_status_checks',
		parameters: { required_status_checks: [{ context: 'Retired' }] },
	});
	assert.deepEqual(await checkRuleset(await fixture({ ruleset })), {
		findings: [unpublished('Retired')],
	});
});

it('A5 accepts a non-gate context pinned to GitHub Actions', async () => {
	const ruleset = requiring('lint');
	ruleset.rules[1].parameters.required_status_checks[1].integration_id = 15368;
	assert.deepEqual(await checkRuleset(await fixture({ ruleset })), { findings: [] });
});

for (const filter of ['paths-ignore', 'branches-ignore']) {
	it(`A6 rejects a publisher with ${filter}`, async () => {
		const root = await fixture({
			ruleset: requiring('Filtered'),
			workflows: {
				'.github/workflows/filtered.yml': namedWorkflow('Filtered', {
					pull_request: { [filter]: ['other'] },
				}),
			},
		});
		assert.deepEqual(await checkRuleset(root), {
			findings: [
				`.github/workflows/filtered.yml: on.pull_request.${filter} can skip ` +
					"the workflow and leave 'Filtered' pending",
			],
		});
	});
}

it('A7 reuses branch negation matching for additional workflow paths', async () => {
	const root = await fixture({
		ruleset: requiring('Excluded'),
		workflows: {
			'.github/workflows/excluded.yml': namedWorkflow('Excluded', {
				pull_request: { branches: ['main', '!ma*'] },
			}),
		},
	});
	assert.deepEqual(await checkRuleset(root), {
		findings: [
			'.github/workflows/excluded.yml: on.pull_request.branches must include main ' +
				"for required status check 'Excluded'",
		],
	});
});
