// Workflow publisher expansion, filter semantics, and bounded discovery regressions.
import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { createTempRoot, fixture, jobSteps, removeTempRoot } from './check-ruleset.fixtures.mjs';
import {
	contextTriggerFindings,
	filterPatternMatches,
	matrixCombinations,
	publishedJobNames,
	publishesPullRequest,
	readContextWorkflows,
} from './check-ruleset-workflows.mjs';

before(createTempRoot);
after(removeTempRoot);

/** Supply the runner and step required by an ordinary job, with explicit overrides applied last. */
function runnable(job = {}) {
	return { name: 'Build', 'runs-on': 'ubuntu-26.04', steps: jobSteps, ...job };
}

/** Compare combinations independently of key order and expansion order. */
function canonical(combinations) {
	return combinations
		.map((entry) => JSON.stringify(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))))
		.sort();
}

/** Read publishers using repository fixture files and return their findings alongside names. */
async function publishersFor(workflows) {
	const root = await fixture({ workflow: null, workflows });
	const findings = [];
	const publishers = await readContextWorkflows(root, findings);
	return { publishers, findings };
}

/** Serialize one caller and one callee; overrides plant invalid call or target shapes. */
function reusableWorkflows(caller = {}, callee = {}) {
	return {
		'.github/workflows/caller.yml': JSON.stringify({
			on: 'pull_request',
			jobs: {
				call: { name: 'Reusable', uses: './.github/workflows/callee.yml', ...caller },
			},
		}),
		'.github/workflows/callee.yml': JSON.stringify({
			on: 'workflow_call',
			jobs: {
				build: runnable(),
				lint: runnable({
					name: 'Lint (${{ matrix.os }})',
					strategy: { matrix: { os: ['linux', 'windows'] } },
				}),
			},
			...callee,
		}),
	};
}

/** Judge one trigger using stable fixture path and context names. */
function triggerFindings(trigger) {
	return contextTriggerFindings(
		{ doc: { on: { pull_request: trigger } }, relPath: '.github/workflows/fixture.yml' },
		'Fixture',
	);
}

/** Spell expected filter findings independently of checker helpers. */
function filterFinding(message) {
	return `.github/workflows/fixture.yml: on.pull_request.${message}`;
}

const requiredSuffix = " for required status check 'Fixture'";
const mustIncludeMain = filterFinding(`branches must include main${requiredSuffix}`);
const ignoreMain = filterFinding(
	"branches-ignore can skip the workflow and leave 'Fixture' pending",
);

for (const pattern of [
	'*',
	'**',
	'**/main',
	'**/ma*',
	'main',
	'ma*',
	'm?ain',
	'mai+n',
	'ma[a-z]n',
	'm[a-z0-9]in',
]) {
	it(`G1 matches main with ${pattern}`, () => {
		assert.equal(filterPatternMatches(pattern, 'main'), true);
	});
}

for (const pattern of [
	'feature/*',
	'mainline',
	'main\\*',
	'master',
	'*/main',
	'**/ain',
	'x/**/main',
]) {
	it(`G2 does not match main with ${pattern}`, () => {
		assert.equal(filterPatternMatches(pattern, 'main'), false);
	});
}

it('G1 lets a double star and slash match zero or more leading path components', () => {
	for (const [pattern, subject] of [
		['**/main', 'a/b/main'],
		['a/**/b', 'a/b'],
		['a/**/b', 'a/x/y/b'],
		['**/?main', 'main'],
		['**/?main', '/main'],
	]) {
		assert.equal(filterPatternMatches(pattern, subject), true, `${pattern} ${subject}`);
	}
	for (const [pattern, subject] of [
		['**/main', 'notmain'],
		['a/**/b', 'ab'],
		['a/**/b', 'a/xb'],
	]) {
		assert.equal(filterPatternMatches(pattern, subject), false, `${pattern} ${subject}`);
	}
});

it('G2 distinguishes slash-crossing double stars from single stars', () => {
	assert.equal(filterPatternMatches('*', 'release/1'), false);
	assert.equal(filterPatternMatches('**', 'release/1'), true);
	assert.equal(filterPatternMatches('release/*', 'release/1'), true);
});

for (const pattern of ['[', '[a-', '[!a]', '+main', '?main', 'ma*+', 'ma??', 'main\\']) {
	it(`G3 refuses malformed pattern ${pattern}`, () => {
		assert.equal(filterPatternMatches(pattern, 'main'), null);
	});
}

it('G4 bounds patterns and subjects at 255 characters', () => {
	assert.equal(filterPatternMatches('m'.repeat(255), 'main'), false);
	assert.equal(filterPatternMatches('m'.repeat(256), 'main'), null);
	assert.equal(filterPatternMatches('*', 'm'.repeat(255)), true);
	assert.equal(filterPatternMatches('*', 'm'.repeat(256)), null);
});

it('G3 rejects mixed-class or reversed ranges and repeated quantifiers', () => {
	for (const pattern of ['[a-Z]', '[9-0]', 'ma++', '**?', '[]']) {
		assert.equal(filterPatternMatches(pattern, 'main'), null);
	}
});

it('G1 handles zero repetitions, repeated classes, and escaped literals', () => {
	assert.equal(filterPatternMatches('maix?n', 'main'), true);
	assert.equal(filterPatternMatches('ma[a-z]+n', 'maiiin'), true);
	assert.equal(filterPatternMatches('main\\*', 'main*'), true);
});

it('M1 expands the documented include example into exactly six combinations', () => {
	const matrix = {
		fruit: ['apple', 'pear'],
		animal: ['cat', 'dog'],
		include: [
			{ color: 'green' },
			{ color: 'pink', animal: 'cat' },
			{ fruit: 'apple', shape: 'circle' },
			{ fruit: 'banana' },
			{ fruit: 'banana', animal: 'cat' },
		],
	};
	assert.deepEqual(
		canonical(matrixCombinations(matrix)),
		canonical([
			{ fruit: 'apple', animal: 'cat', color: 'pink', shape: 'circle' },
			{ fruit: 'apple', animal: 'dog', color: 'green', shape: 'circle' },
			{ fruit: 'pear', animal: 'cat', color: 'pink' },
			{ fruit: 'pear', animal: 'dog', color: 'green' },
			{ fruit: 'banana' },
			{ fruit: 'banana', animal: 'cat' },
		]),
	);
});

it('M2 removes combinations using partial exclude matches before include', () => {
	const matrix = { os: ['a', 'b'], node: [1, 2], exclude: [{ os: 'a' }] };
	assert.deepEqual(
		canonical(matrixCombinations(matrix)),
		canonical([
			{ os: 'b', node: 1 },
			{ os: 'b', node: 2 },
		]),
	);
	assert.deepEqual(matrixCombinations({ ...matrix, include: [{ os: 'a', node: 3 }] }), [
		{ os: 'b', node: 1 },
		{ os: 'b', node: 2 },
		{ os: 'a', node: 3 },
	]);
});

it('M3 bounds both the axis product and the final include expansion at 256', () => {
	const axis = Array.from({ length: 16 }, (_, index) => index);
	assert.equal(matrixCombinations({ os: axis, node: axis }).length, 256);
	assert.deepEqual(matrixCombinations({ os: axis, node: [...axis, 16] }), []);
	assert.deepEqual(matrixCombinations({ os: axis, node: axis, include: [{ os: 'extra' }] }), []);
});

it('M4 resolves case-insensitive axes and references while refusing colliding keys', () => {
	for (const [key, reference] of [
		['OS', 'os'],
		['os', 'OS'],
	]) {
		const job = runnable({
			name: 'Build (${{ matrix.' + reference + ' }})',
			strategy: { matrix: { [key]: ['linux'] } },
		});
		assert.deepEqual(publishedJobNames('build', job), ['Build (linux)']);
	}
	assert.deepEqual(matrixCombinations({ os: ['linux'], OS: ['windows'] }), []);
	assert.deepEqual(matrixCombinations({ include: [{ os: 'linux', OS: 'windows' }] }), []);
});

const invalidMatrices = [
	['empty axis', { os: [] }],
	['unknown exclude key', { os: ['linux'], exclude: [{ node: 1 }] }],
	['non-scalar include', { include: [{ os: ['linux'] }] }],
	['oversized include', { include: Array.from({ length: 257 }, () => ({ os: 'linux' })) }],
	['oversized exclude', { os: ['linux'], exclude: Array.from({ length: 257 }, () => ({})) }],
	['non-mapping matrix', '${{ fromJSON(inputs.matrix) }}'],
	['non-array exclude', { os: ['linux'], exclude: {} }],
	['colliding exclude keys', { os: ['linux'], exclude: [{ os: 'linux', OS: 'linux' }] }],
];

for (const [label, matrix] of invalidMatrices) {
	it(`M5 refuses ${label}`, () => {
		assert.deepEqual(matrixCombinations(matrix), []);
	});
}

it('M5 bounds matrix and include mapping keys at 256', () => {
	const entries = Array.from({ length: 257 }, (_, index) => [`axis-${index}`, [1]]);
	assert.equal(matrixCombinations(Object.fromEntries(entries.slice(0, 256))).length, 1);
	assert.deepEqual(matrixCombinations(Object.fromEntries(entries)), []);
	const include = Object.fromEntries(entries.map(([key]) => [key, 1]));
	assert.deepEqual(matrixCombinations({ include: [include] }), []);
});

it('J1 requires a non-null runner for ordinary jobs', () => {
	assert.deepEqual(publishedJobNames('build', { name: 'Build' }), []);
	assert.deepEqual(publishedJobNames('build', runnable({ 'runs-on': null })), []);
	for (const runner of ['ubuntu-26.04', ['self-hosted', 'linux'], { group: 'linux' }]) {
		assert.deepEqual(publishedJobNames('build', runnable({ 'runs-on': runner })), ['Build']);
	}
});

for (const condition of [false, 'false', '${{ false }}', ' ${{  false }} ']) {
	it(`J2 keeps a skipped job with constant-false condition ${JSON.stringify(condition)}`, () => {
		assert.deepEqual(publishedJobNames('build', runnable({ if: condition })), ['Build']);
	});

	it(`J2 refuses a matrix job with constant-false condition ${JSON.stringify(condition)}`, () => {
		const job = runnable({
			name: 'Test (${{ matrix.os }})',
			if: condition,
			strategy: { matrix: { os: ['linux'] } },
		});
		assert.deepEqual(publishedJobNames('test', job), []);
		assert.deepEqual(publishedJobNames('test', { ...job, if: 'always()' }), ['Test (linux)']);
	});
}

it('J2 retains ordinary successful skipped-job conditions', () => {
	const conditions = [
		'always()',
		"needs.detect-changes.outputs.has_code_changes == 'true' || github.event_name == 'push'",
	];
	for (const condition of conditions) {
		assert.deepEqual(publishedJobNames('build', runnable({ if: condition })), ['Build']);
	}
});

for (const total of [256, 257]) {
	it(`J3 bounds publisher and callee jobs at ${total}`, async () => {
		const jobs = Object.fromEntries(
			Array.from({ length: total }, (_, index) => [`job-${index}`, runnable({ name: `${index}` })]),
		);
		const workflows = reusableWorkflows({}, { on: ['workflow_call', 'pull_request'], jobs });
		const { publishers, findings } = await publishersFor(workflows);
		assert.deepEqual(
			findings,
			total === 256
				? []
				: [
						'.github/workflows/callee.yml: holds 257 jobs, more than the limit of 256; ' +
							'its jobs were not matched',
					],
		);
		assert.deepEqual(
			publishers.map(({ names }) => names.size),
			total === 256 ? [256, 256] : [0, 0],
		);
	});
}

it('R1 prefixes callee literal and matrix job names with the reusable caller name', async () => {
	const { publishers, findings } = await publishersFor(reusableWorkflows());
	assert.deepEqual(findings, []);
	assert.equal(publishers.length, 1);
	assert.deepEqual([...publishers[0].names].sort(), [
		'Reusable / Build',
		'Reusable / Lint (linux)',
		'Reusable / Lint (windows)',
	]);
	assert.equal(publishers[0].names.has('Reusable'), false);
});

const invalidReusableCalls = [
	['callee without workflow_call', {}, { on: 'pull_request' }],
	['caller without name', { name: undefined }, {}],
	['caller with matrix', { strategy: { matrix: { os: ['linux'] } } }, {}],
	['constant-false caller', { if: false }, {}],
	['remote call', { uses: 'owner/repo/.github/workflows/x.yml@v1' }, {}],
	['JSON workflow call', { uses: './.github/workflows/callee.json' }, {}],
	['nested callee call', {}, { jobs: { nested: { uses: './.github/workflows/x.yml' } } }],
];

for (const [label, caller, callee] of invalidReusableCalls) {
	it(`R2 refuses ${label}`, async () => {
		const { publishers, findings } = await publishersFor(reusableWorkflows(caller, callee));
		assert.deepEqual(findings, []);
		const publisher = publishers.find(({ relPath }) => relPath.endsWith('/caller.yml'));
		assert.deepEqual([...publisher.names], []);
	});
}

it('R2 keeps a callee job skipped by a constant-false condition', async () => {
	const workflows = reusableWorkflows({}, { jobs: { build: runnable({ if: false }) } });
	const { publishers, findings } = await publishersFor(workflows);
	assert.deepEqual(findings, []);
	assert.deepEqual([...publishers[0].names], ['Reusable / Build']);
});

for (const [label, build] of [
	['without runner', { name: 'Build' }],
	['with a runner and a reusable call', runnable({ uses: './.github/workflows/x.yml' })],
]) {
	it(`R2 refuses a callee whose job is ${label}`, async () => {
		const workflows = reusableWorkflows({}, { jobs: { build, lint: runnable({ name: 'Lint' }) } });
		const { publishers, findings } = await publishersFor(workflows);
		assert.deepEqual(findings, [
			".github/workflows/callee.yml: job 'build' needs either runs-on or a reusable uses, " +
				'not both or neither, so GitHub refuses the workflow; its jobs were not matched',
		]);
		assert.deepEqual([...publishers[0].names], []);
	});
}

for (const trigger of ['workflow_call', ['workflow_call'], { workflow_call: null }]) {
	it(`R1 accepts workflow_call shape ${JSON.stringify(trigger)}`, async () => {
		const { publishers } = await publishersFor(reusableWorkflows({}, { on: trigger }));
		assert.equal(publishers[0].names.has('Reusable / Build'), true);
	});
}

for (const value of ['main', ['main'], true]) {
	it(`T8 rejects pull_request map value ${JSON.stringify(value)}`, () => {
		assert.equal(publishesPullRequest({ on: { pull_request: value } }), false);
	});
}

it('T8 accepts null pull_request values and bounds event arrays', () => {
	assert.equal(publishesPullRequest({ on: { pull_request: null } }), true);
	assert.equal(publishesPullRequest({ on: ['pull_request', ...Array(99).fill('push')] }), true);
	assert.equal(publishesPullRequest({ on: ['pull_request', ...Array(100).fill('push')] }), false);
});

const branchCases = [
	['star', { branches: ['*'] }, []],
	['prefix', { branches: ['ma*'] }, []],
	['positive after negative', { branches: ['!main', 'main'] }, []],
	['negative after positive', { branches: ['*', '!main'] }, [mustIncludeMain]],
	['unrelated branch', { branches: ['feature/*'] }, [mustIncludeMain]],
	[
		'malformed branch',
		{ branches: ['[x'] },
		[
			filterFinding(`branches entry '[x' cannot be judged against main${requiredSuffix}`),
			mustIncludeMain,
		],
	],
	['unrelated ignore', { 'branches-ignore': ['release/*'] }, []],
	['matching ignore', { 'branches-ignore': ['m*'] }, [ignoreMain]],
	[
		'negated ignore',
		{ 'branches-ignore': ['!x'] },
		[filterFinding(`branches-ignore entry '!x' cannot be judged against main${requiredSuffix}`)],
	],
	[
		'both keys',
		{ branches: ['main'], 'branches-ignore': ['main'] },
		[
			'.github/workflows/fixture.yml: on.pull_request sets both branches and ' +
				`branches-ignore, which GitHub refuses,${requiredSuffix}`,
		],
	],
	['100 branches', { branches: ['main', ...Array(99).fill('other')] }, []],
	[
		'101 branches',
		{ branches: ['main', ...Array(100).fill('other')] },
		[filterFinding(`branches holds 101 entries, more than the limit of 100,${requiredSuffix}`)],
	],
];

for (const [label, trigger, findings] of branchCases) {
	it(`F1 judges ${label} against main`, () => {
		assert.deepEqual(triggerFindings(trigger), findings);
	});
}

it('F1 rejects non-array filters and unjudgeable ignore entries', () => {
	assert.deepEqual(triggerFindings({ branches: 'main' }), [mustIncludeMain]);
	assert.deepEqual(triggerFindings({ 'branches-ignore': 'other' }), [ignoreMain]);
	assert.deepEqual(triggerFindings({ 'branches-ignore': [true, '[x'] }), [
		filterFinding(`branches-ignore entry 'true' cannot be judged against main${requiredSuffix}`),
		filterFinding(`branches-ignore entry '[x' cannot be judged against main${requiredSuffix}`),
	]);
});

it('F1 bounds activity and ignore filter lists before traversal', () => {
	for (const key of ['types', 'branches-ignore']) {
		assert.deepEqual(triggerFindings({ [key]: Array(101).fill('other') }), [
			filterFinding(`${key} holds 101 entries, more than the limit of 100,${requiredSuffix}`),
		]);
	}
});

it('F1 keeps diagnostic order for branches, types, paths, and ignore filters', () => {
	assert.deepEqual(
		triggerFindings({
			branches: ['feature/*'],
			types: ['opened'],
			paths: ['src/**'],
			'paths-ignore': ['docs/**'],
		}),
		[
			mustIncludeMain,
			filterFinding(`types must include opened, synchronize and reopened${requiredSuffix}`),
			filterFinding("paths can skip the workflow and leave 'Fixture' pending"),
			filterFinding("paths-ignore can skip the workflow and leave 'Fixture' pending"),
		],
	);
});
