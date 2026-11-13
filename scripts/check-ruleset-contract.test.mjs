// Effective CODEOWNERS rules, owner tokens, workflow and integration contract.
// Ruleset validation and basic CODEOWNERS cases: check-ruleset.test.mjs.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
	createTempRoot,
	fixture,
	makeRuleset,
	removeTempRoot,
	validWorkflow,
} from './check-ruleset.fixtures.mjs';
import {
	CODEOWNERS_LINE_LIMIT,
	EMAIL_OWNER_RE,
	GATE_EVENT_EXPR,
	GATE_NEEDS_EXPR,
	GATE_RESULT_RUN,
	GITHUB_ACTIONS_APP_ID,
	TEAM_OWNER_RE,
	USER_OWNER_RE,
	checkRuleset,
	parseCodeowners,
} from './check-ruleset.mjs';

before(createTempRoot);
after(removeTempRoot);

describe('parseCodeowners effective rules', () => {
	it('keeps only the last identical catch-all owner', () => {
		const parsed = parseCodeowners('* @previous\n* @owner');
		assert.deepEqual(parsed.users, new Set(['@owner']));
		assert.deepEqual(parsed.rules, [
			{ pattern: '*', users: new Set(['@owner']), others: new Set() },
		]);
	});

	it('clears a narrower pattern with an owner-less identical rule', () => {
		const parsed = parseCodeowners('/apps/ @octocat\n/apps/');
		assert.equal(parsed.users.size, 0);
		assert.equal(parsed.others.size, 0);
		assert.deepEqual(parsed.rules, [{ pattern: '/apps/', users: new Set(), others: new Set() }]);
	});

	it('preserves rule order and contents for distinct patterns', () => {
		const parsed = parseCodeowners('* @Owner\n/docs/ @org/team\n/apps/');
		assert.deepEqual(parsed.rules, [
			{ pattern: '*', users: new Set(['@owner']), others: new Set() },
			{ pattern: '/docs/', users: new Set(), others: new Set(['@org/team']) },
			{ pattern: '/apps/', users: new Set(), others: new Set() },
		]);
		assert.deepEqual(parsed.users, new Set(['@owner']));
		assert.deepEqual(parsed.others, new Set(['@org/team']));
	});

	it('moves a repeated narrower pattern after the remaining rules', () => {
		const parsed = parseCodeowners('/apps/ @previous\n/docs/ @team/user\n/apps/ @owner');
		assert.deepEqual(parsed.rules, [
			{ pattern: '/docs/', users: new Set(), others: new Set(['@team/user']) },
			{ pattern: '/apps/', users: new Set(['@owner']), others: new Set() },
		]);
		assert.deepEqual(parsed.users, new Set(['@owner']));
	});
});

describe('parseCodeowners owner-token allow-list', () => {
	it('ignores malformed owner tokens instead of treating them as alternates', () => {
		const parsed = parseCodeowners('* @owner not-an-owner @ @org/');
		assert.deepEqual(parsed.users, new Set(['@owner']));
		assert.equal(parsed.others.size, 0);
	});

	it('keeps an email as an alternate owner', () => {
		const parsed = parseCodeowners('* @owner dev@example.com');
		assert.deepEqual(parsed.users, new Set(['@owner']));
		assert.deepEqual(parsed.others, new Set(['dev@example.com']));
	});

	it('keeps a team as an alternate owner', () => {
		const parsed = parseCodeowners('* @owner @org/team');
		assert.deepEqual(parsed.users, new Set(['@owner']));
		assert.deepEqual(parsed.others, new Set(['@org/team']));
	});

	it('exports the owner-token allow-list expressions', () => {
		assert.equal(USER_OWNER_RE.test('@Owner'), true);
		assert.equal(USER_OWNER_RE.test('owner'), false);
		assert.equal(USER_OWNER_RE.test(`@${'a'.repeat(39)}`), true);
		assert.equal(USER_OWNER_RE.test(`@${'a'.repeat(40)}`), false);
		assert.equal(TEAM_OWNER_RE.test('@ORG/team.name-v2'), true);
		assert.equal(TEAM_OWNER_RE.test('@org/'), false);
		assert.equal(EMAIL_OWNER_RE.test('dev@example.com'), true);
		assert.equal(EMAIL_OWNER_RE.test('dev@example'), false);
	});

	it('preserves escaped spaces in a pattern without inventing alternate owners', () => {
		const pattern = '/path\\ with\\ spaces';
		const parsed = parseCodeowners(`${pattern} @owner`);
		assert.deepEqual(parsed.users, new Set(['@owner']));
		assert.equal(parsed.others.size, 0);
		assert.equal(parsed.rules[0].pattern, pattern);
	});
});

describe('parseCodeowners final newline boundaries', () => {
	it('accepts 2000 populated lines with a final newline', () => {
		const parsed = parseCodeowners('* @owner\n'.repeat(CODEOWNERS_LINE_LIMIT));
		assert.equal(parsed.error, null);
		assert.deepEqual(parsed.users, new Set(['@owner']));
	});

	it('accepts 2000 populated lines without a final newline', () => {
		const source = Array(CODEOWNERS_LINE_LIMIT).fill('* @owner').join('\n');
		assert.equal(parseCodeowners(source).error, null);
	});

	it('accepts 2000 CRLF lines with a final newline', () => {
		const parsed = parseCodeowners('* @owner\r\n'.repeat(CODEOWNERS_LINE_LIMIT));
		assert.equal(parsed.error, null);
		assert.deepEqual(parsed.users, new Set(['@owner']));
	});
});

const perPatternReviews = [
	['catch-all before a team', '* @owner\n/docs/ @org/team', '*'],
	['narrower sole owner', '* @a @b\n/docs/ @c', '/docs/'],
];

describe('per-pattern code-owner reviews', () => {
	for (let i = 0; i < perPatternReviews.length; i++) {
		const [name, source, pattern] = perPatternReviews[i];
		it(`rejects an unsatisfiable ${name} review`, async () => {
			const root = await fixture({
				owners: { '.github/CODEOWNERS': source },
				ruleset: makeRuleset({ review: { require_code_owner_review: true } }),
			});
			assert.deepEqual(await checkRuleset(root), {
				findings: [
					'.github/rulesets/main.json: require_code_owner_review: CODEOWNERS ' +
						`pattern '${pattern}' has a single owner, who cannot approve their own pull request`,
				],
			});
		});
	}

	it('accepts general approvals and last-push approval with an alternate team', async () => {
		const root = await fixture({
			owners: { '.github/CODEOWNERS': '* @owner\n/docs/ @org/team' },
			ruleset: makeRuleset({
				review: { required_approving_review_count: 1, require_last_push_approval: true },
			}),
		});
		assert.deepEqual(await checkRuleset(root), { findings: [] });
	});

	it('still rejects a sole maintainer review after malformed owner tokens', async () => {
		const root = await fixture({
			owners: { '.github/CODEOWNERS': '* @owner not-an-owner @ @org/' },
			ruleset: makeRuleset({ review: { required_approving_review_count: 1 } }),
		});
		const { findings } = await checkRuleset(root);
		assert.equal(findings.length, 1);
		assert.match(findings[0], /required_approving_review_count: sole maintainer/);
	});

	it('reports each effective pattern once across pull_request rules', async () => {
		const ruleset = makeRuleset({ review: { require_code_owner_review: true } });
		ruleset.rules.push(ruleset.rules[0]);
		const root = await fixture({
			ruleset,
			owners: { '.github/CODEOWNERS': '* @owner\n/docs/ @org/team' },
		});
		const { findings } = await checkRuleset(root);
		assert.equal(findings.length, 1);
		assert.match(findings[0], /CODEOWNERS pattern '\*' has a single owner/);
	});
});

const gateResultStep = [
	'      - env:',
	'          NEEDS: ${{ toJSON(needs) }}',
	'          EVENT_NAME: ${{ github.event_name }}',
	'        run: node scripts/ci-gate.mjs',
].join('\n');
const gateResultFinding = /job must run node scripts\/ci-gate\.mjs with NEEDS:/;

const workflowFailures = [
	[
		'renamed gate',
		validWorkflow.replace('name: CI Gate', 'name: Renamed'),
		/no job publishes 'CI Gate'/,
	],
	[
		'duplicate gates',
		`${validWorkflow}\n  duplicate:\n    name: CI Gate`,
		/exactly one job must publish 'CI Gate'/,
	],
	['missing if', validWorkflow.replace('    if: always()\n', ''), /job if must be always\(\)/],
	[
		'success-only if',
		validWorkflow.replace('if: always()', 'if: success()'),
		/job if must be always\(\)/,
	],
	['missing need', validWorkflow.replace('needs: [lint]', 'needs: []'), /job needs missing: lint/],
	[
		'partial needs after adding a job',
		`${validWorkflow}\n  build:\n    runs-on: ubuntu-26.04`,
		/job needs missing: build/,
	],
	[
		'push without main',
		validWorkflow.replace('branches: [main]', 'branches: [other]'),
		/on\.push\.branches must include main/,
	],
	[
		'pull_request without main',
		validWorkflow.replace('pull_request:\n    branches: [main]', 'pull_request:\n    branches: []'),
		/on\.pull_request\.branches must include main/,
	],
	['unparsable YAML', 'on: [', /unparsable YAML/],
	['missing workflow', null, /cannot read file/],
	[
		'gate that only echoes',
		validWorkflow.replace(gateResultStep, '      - run: echo gate'),
		gateResultFinding,
	],
	[
		'result step without NEEDS',
		validWorkflow.replace(gateResultStep, '      - run: node scripts/ci-gate.mjs'),
		gateResultFinding,
	],
	[
		'NEEDS from another expression',
		validWorkflow.replace('${{ toJSON(needs) }}', '${{ toJSON(needs.lint) }}'),
		gateResultFinding,
	],
	[
		'result step running another script',
		validWorkflow.replace('node scripts/ci-gate.mjs', 'node scripts/other.mjs'),
		gateResultFinding,
	],
	[
		'continue-on-error on the gate job',
		validWorkflow.replace('    name: CI Gate', '    name: CI Gate\n    continue-on-error: true'),
		/job must not set continue-on-error/,
	],
	[
		'continue-on-error on the result step',
		validWorkflow.replace('      - env:', '      - continue-on-error: true\n        env:'),
		/job must not set continue-on-error/,
	],
	[
		'continue-on-error as an expression',
		validWorkflow.replace(
			'    name: CI Gate',
			'    name: CI Gate\n    continue-on-error: ${{ true }}',
		),
		/job must not set continue-on-error/,
	],
	[
		'non-array gate steps',
		validWorkflow.replace(`    steps:\n${gateResultStep}`, '    steps: {}'),
		gateResultFinding,
	],
	[
		'non-object result step',
		validWorkflow.replace(gateResultStep, '      - null'),
		gateResultFinding,
	],
	[
		'result step skipped by if false',
		validWorkflow.replace('      - env:', '      - if: false\n        env:'),
		/result step must not set if/,
	],
	[
		'result step with a success-only if',
		validWorkflow.replace('      - env:', '      - if: success()\n        env:'),
		/result step must not set if/,
	],
	[
		'result step with an always if',
		validWorkflow.replace('      - env:', '      - if: always()\n        env:'),
		/result step must not set if/,
	],
	[
		'result step without EVENT_NAME',
		validWorkflow.replace('          EVENT_NAME: ${{ github.event_name }}\n', ''),
		gateResultFinding,
	],
	[
		'result step with a wrong EVENT_NAME',
		validWorkflow.replace('${{ github.event_name }}', '${{ github.event.action }}'),
		gateResultFinding,
	],
	[
		'push paths filter',
		validWorkflow.replace('  push:', "  push:\n    paths: ['src/**']"),
		/can skip the workflow and leave 'CI Gate' pending/,
	],
	[
		'push paths-ignore filter',
		validWorkflow.replace('  push:', "  push:\n    paths-ignore: ['src/**']"),
		/can skip the workflow and leave 'CI Gate' pending/,
	],
	[
		'pull_request paths filter',
		validWorkflow.replace('  pull_request:', "  pull_request:\n    paths: ['src/**']"),
		/can skip the workflow and leave 'CI Gate' pending/,
	],
	[
		'pull_request paths-ignore filter',
		validWorkflow.replace('  pull_request:', "  pull_request:\n    paths-ignore: ['src/**']"),
		/can skip the workflow and leave 'CI Gate' pending/,
	],
	[
		'pull_request branches-ignore',
		validWorkflow.replace('  pull_request:', '  pull_request:\n    branches-ignore: [other]'),
		/can skip the workflow and leave 'CI Gate' pending/,
	],
	[
		'pull_request types without synchronize',
		validWorkflow.replace('  pull_request:', '  pull_request:\n    types: [opened, reopened]'),
		/types must include opened, synchronize and reopened/,
	],
	[
		'pull_request main negated after inclusion',
		validWorkflow.replace(
			'pull_request:\n    branches: [main]',
			"pull_request:\n    branches: [main, '!main']",
		),
		/on\.pull_request\.branches must include main/,
	],
	[
		'push main negated by a wildcard',
		validWorkflow.replace('push:\n    branches: [main]', "push:\n    branches: [main, '!ma*']"),
		/on\.push\.branches must include main/,
	],
	[
		'pull_request main negated by double star',
		validWorkflow.replace(
			'pull_request:\n    branches: [main]',
			"pull_request:\n    branches: [main, '!**']",
		),
		/on\.pull_request\.branches must include main/,
	],
	[
		'pull_request negation that cannot be judged',
		validWorkflow.replace(
			'pull_request:\n    branches: [main]',
			"pull_request:\n    branches: [main, '!ma?n']",
		),
		/on\.pull_request\.branches entry '!ma\?n' cannot be judged against main/,
	],
];

describe('CI Gate workflow contract', () => {
	for (let i = 0; i < workflowFailures.length; i++) {
		const [name, workflow, expected] = workflowFailures[i];
		it(`reports one finding for ${name}`, async () => {
			const { findings } = await checkRuleset(await fixture({ workflow }));
			assert.equal(findings.length, 1);
			assert.ok(findings[0].startsWith('.github/workflows/ci.yml: '));
			assert.match(findings[0], expected);
		});
	}

	it('accepts an always expression', async () => {
		const workflow = validWorkflow.replace('if: always()', 'if: ${{ always() }}');
		assert.deepEqual(await checkRuleset(await fixture({ workflow })), { findings: [] });
	});

	it('accepts a single need as a string', async () => {
		const workflow = validWorkflow.replace('needs: [lint]', 'needs: lint');
		assert.deepEqual(await checkRuleset(await fixture({ workflow })), { findings: [] });
	});

	it('accepts CRLF YAML and JSON', async () => {
		const root = await fixture({
			workflow: validWorkflow.replaceAll('\n', '\r\n'),
			source: JSON.stringify(makeRuleset(), null, 2).replaceAll('\n', '\r\n'),
		});
		assert.deepEqual(await checkRuleset(root), { findings: [] });
	});

	it('accepts continue-on-error: false on the job and result step', async () => {
		const workflow = validWorkflow
			.replace('    name: CI Gate', '    name: CI Gate\n    continue-on-error: false')
			.replace('      - env:', '      - continue-on-error: false\n        env:');
		assert.deepEqual(await checkRuleset(await fixture({ workflow })), { findings: [] });
	});

	it('accepts a block-scalar result command with a trailing newline', async () => {
		const workflow = validWorkflow.replace(
			'        run: node scripts/ci-gate.mjs',
			'        run: |\n          node scripts/ci-gate.mjs\n',
		);
		assert.deepEqual(await checkRuleset(await fixture({ workflow })), { findings: [] });
	});

	it('accepts extra env keys and earlier checkout steps', async () => {
		const workflow = validWorkflow
			.replace(
				'      - env:',
				'      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n' +
					'      - env:',
			)
			.replace(
				'          NEEDS: ${{ toJSON(needs) }}',
				'          NEEDS: ${{ toJSON(needs) }}\n          EXTRA: value',
			);
		assert.deepEqual(await checkRuleset(await fixture({ workflow })), { findings: [] });
	});

	it('exports the exact gate result command and needs expression', () => {
		assert.equal(GATE_RESULT_RUN, 'node scripts/ci-gate.mjs');
		assert.equal(GATE_NEEDS_EXPR, '${{ toJSON(needs) }}');
		assert.equal(GATE_EVENT_EXPR, '${{ github.event_name }}');
	});

	it('accepts pull_request types holding opened, synchronize and reopened', async () => {
		const workflow = validWorkflow.replace(
			'  pull_request:',
			'  pull_request:\n    types: [opened, synchronize, reopened, labeled]',
		);
		assert.deepEqual(await checkRuleset(await fixture({ workflow })), { findings: [] });
	});

	it('accepts main re-included after a negation', async () => {
		const workflow = validWorkflow.replace(
			'pull_request:\n    branches: [main]',
			"pull_request:\n    branches: [main, '!main', main]",
		);
		assert.deepEqual(await checkRuleset(await fixture({ workflow })), { findings: [] });
	});

	it('accepts a negation before main', async () => {
		const workflow = validWorkflow.replace(
			'pull_request:\n    branches: [main]',
			"pull_request:\n    branches: ['!main', main]",
		);
		assert.deepEqual(await checkRuleset(await fixture({ workflow })), { findings: [] });
	});

	it('accepts a negation that cannot match main', async () => {
		const workflow = validWorkflow.replace(
			'pull_request:\n    branches: [main]',
			"pull_request:\n    branches: [main, 'releases/**', '!releases/**-alpha']",
		);
		assert.deepEqual(await checkRuleset(await fixture({ workflow })), { findings: [] });
	});
});

describe('CI Gate integration pinning', () => {
	it('exports the verified GitHub Actions app id', () => {
		assert.equal(GITHUB_ACTIONS_APP_ID, 15368);
	});

	it('accepts a check pinned to GitHub Actions', async () => {
		const ruleset = makeRuleset();
		ruleset.rules[1].parameters.required_status_checks[0].integration_id = 15368;
		assert.deepEqual(await checkRuleset(await fixture({ ruleset })), { findings: [] });
	});

	it('rejects a check pinned to a different integration', async () => {
		const ruleset = makeRuleset();
		ruleset.rules[1].parameters.required_status_checks[0].integration_id = 1;
		assert.deepEqual(await checkRuleset(await fixture({ ruleset })), {
			findings: [
				".github/rulesets/main.json: 'CI Gate' is pinned to integration 1, " +
					'not GitHub Actions (15368)',
			],
		});
	});

	it('accepts an unpinned check', async () => {
		assert.deepEqual(await checkRuleset(await fixture()), { findings: [] });
	});
});
