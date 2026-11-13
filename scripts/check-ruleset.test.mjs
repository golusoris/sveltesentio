import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { IO_TIMEOUT_MS } from './check-platform-legs.mjs';
import {
	ADMIN_ROLE_ID,
	BYPASS_MODES,
	CATCH_ALL_PATTERNS,
	CODEOWNERS_CANDIDATES,
	CODEOWNERS_LINE_LIMIT,
	EMAIL_OWNER_RE,
	GATE_CONTEXT,
	GITHUB_ACTIONS_APP_ID,
	TEAM_OWNER_RE,
	USER_OWNER_RE,
	checkRuleset,
	main,
	parseCodeowners,
} from './check-ruleset.mjs';

const ownRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const validWorkflow = [
	'on:',
	'  push:',
	'    branches: [main]',
	'  pull_request:',
	'    branches: [main]',
	'jobs:',
	'  lint:',
	'    runs-on: ubuntu-26.04',
	'    steps:',
	'      - run: echo lint',
	'  ci-gate:',
	'    name: CI Gate',
	'    if: always()',
	'    needs: [lint]',
	'    runs-on: ubuntu-26.04',
	'    steps:',
	'      - run: echo gate',
].join('\n');
let tempRoot;

before(async () => {
	tempRoot = await mkdtemp(join(tmpdir(), 'ruleset-test-'));
});

after(async () => {
	if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

function makeRuleset({ review = {}, ...overrides } = {}) {
	return {
		enforcement: 'active',
		bypass_actors: [{ actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'pull_request' }],
		rules: [
			{
				type: 'pull_request',
				parameters: {
					required_approving_review_count: 0,
					require_code_owner_review: false,
					require_last_push_approval: false,
					...review,
				},
			},
			{
				type: 'required_status_checks',
				parameters: { required_status_checks: [{ context: 'CI Gate' }] },
			},
		],
		...overrides,
	};
}

async function writeFixtureFile(root, relPath, source) {
	const path = join(root, relPath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, source, {
		encoding: 'utf8',
		signal: AbortSignal.timeout(IO_TIMEOUT_MS),
	});
}

async function fixture({
	ruleset = makeRuleset(),
	source = JSON.stringify(ruleset),
	owners = { '.github/CODEOWNERS': '* @owner' },
	workflow = validWorkflow,
} = {}) {
	const root = await mkdtemp(join(tempRoot, 'case-'));
	if (source !== null) await writeFixtureFile(root, '.github/rulesets/main.json', source);
	if (workflow !== null) await writeFixtureFile(root, '.github/workflows/ci.yml', workflow);
	const entries = Object.entries(owners);
	for (let i = 0; i < entries.length; i++) {
		const [path, content] = entries[i];
		await writeFixtureFile(root, path, content);
	}
	return root;
}

describe('check-ruleset positive cases', () => {
	it('accepts the repository ruleset', async () => {
		assert.equal(await main(ownRoot), 0);
	});

	it('accepts a satisfiable solo-maintainer fixture', async () => {
		const root = await fixture();
		assert.deepEqual(await checkRuleset(root), { findings: [] });
		assert.equal(await main(root), 0);
	});

	it('exports the protection constants and lookup order', () => {
		assert.equal(ADMIN_ROLE_ID, 5);
		assert.deepEqual(BYPASS_MODES, ['always', 'pull_request']);
		assert.equal(GATE_CONTEXT, 'CI Gate');
		assert.equal(CODEOWNERS_LINE_LIMIT, 2_000);
		assert.deepEqual(CODEOWNERS_CANDIDATES, [
			'.github/CODEOWNERS',
			'CODEOWNERS',
			'docs/CODEOWNERS',
		]);
	});

	it('rejects the planted pre-8c2704d regression with four findings', async () => {
		const root = await fixture({
			owners: { '.github/CODEOWNERS': '* @lusoris' },
			ruleset: {
				enforcement: 'active',
				rules: [
					{
						type: 'pull_request',
						parameters: {
							required_approving_review_count: 1,
							require_code_owner_review: true,
							require_last_push_approval: false,
						},
					},
					{
						type: 'required_status_checks',
						parameters: {
							required_status_checks: [
								{ context: 'Detect Changes' },
								{ context: 'CodeQL analysis' },
							],
						},
					},
				],
			},
		});
		const { findings } = await checkRuleset(root);
		assert.equal(findings.length, 4);
		assert.match(findings[0], /required_approving_review_count/);
		assert.match(findings[1], /require_code_owner_review/);
		assert.match(findings[2], /admin bypass/);
		assert.match(findings[3], /'CI Gate'.*aggregator/);
		assert.equal(await main(root), 1);
	});
});

const reviewFailures = [
	['required_approving_review_count', 1],
	['require_code_owner_review', true],
	['require_last_push_approval', true],
];

describe('solo review requirements', () => {
	for (let i = 0; i < reviewFailures.length; i++) {
		const [name, value] = reviewFailures[i];
		it(`rejects ${name} independently`, async () => {
			const root = await fixture({ ruleset: makeRuleset({ review: { [name]: value } }) });
			const { findings } = await checkRuleset(root);
			assert.equal(findings.length, 1);
			assert.ok(findings[0].startsWith(`.github/rulesets/main.json: ${name}:`));
			assert.match(findings[0], /sole maintainer cannot approve their own pull request/);
		});
	}

	it('checks every pull_request rule', async () => {
		const ruleset = makeRuleset();
		ruleset.rules.push({
			type: 'pull_request',
			parameters: { required_approving_review_count: 1 },
		});
		const { findings } = await checkRuleset(await fixture({ ruleset }));
		assert.equal(findings.length, 1);
		assert.match(findings[0], /required_approving_review_count/);
	});
});

const bypassFailures = [
	['absent bypass', undefined],
	['wrong role', [{ actor_type: 'RepositoryRole', actor_id: 4, bypass_mode: 'pull_request' }]],
	['wrong type', [{ actor_type: 'Team', actor_id: 5, bypass_mode: 'pull_request' }]],
	['unknown mode', [{ actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'exempt' }]],
];

describe('admin bypass and CI Gate', () => {
	for (let i = 0; i < bypassFailures.length; i++) {
		const [name, actors] = bypassFailures[i];
		it(`rejects ${name}`, async () => {
			const root = await fixture({ ruleset: makeRuleset({ bypass_actors: actors }) });
			const { findings } = await checkRuleset(root);
			assert.equal(findings.length, 1);
			assert.match(findings[0], /^\.github\/rulesets\/main.json:.*lock the owner out/);
		});
	}

	it('accepts always as an admin bypass mode', async () => {
		const ruleset = makeRuleset();
		ruleset.bypass_actors[0].bypass_mode = 'always';
		assert.deepEqual(await checkRuleset(await fixture({ ruleset })), { findings: [] });
	});

	it('rejects evaluate enforcement without a bypass finding', async () => {
		const ruleset = makeRuleset({ enforcement: 'evaluate', bypass_actors: undefined });
		assert.deepEqual(await checkRuleset(await fixture({ ruleset })), {
			findings: [
				".github/rulesets/main.json: enforcement is 'evaluate', so the required " +
					"'CI Gate' check does not block merges",
			],
		});
	});

	it('rejects disabled enforcement without a bypass finding', async () => {
		const ruleset = makeRuleset({ enforcement: 'disabled', bypass_actors: undefined });
		assert.deepEqual(await checkRuleset(await fixture({ ruleset })), {
			findings: [
				".github/rulesets/main.json: enforcement is 'disabled', so the required " +
					"'CI Gate' check does not block merges",
			],
		});
	});

	it('rejects checks that omit the pipeline aggregator', async () => {
		const ruleset = makeRuleset();
		ruleset.rules[1].parameters.required_status_checks = [{ context: 'Detect Changes' }];
		const { findings } = await checkRuleset(await fixture({ ruleset }));
		assert.equal(findings.length, 1);
		assert.match(findings[0], /^\.github\/rulesets\/main.json: missing 'CI Gate'/);
		assert.match(findings[0], /aggregator that reports whether the whole pipeline passed/);
	});
});

const ownerBoundaries = [
	['two users', '* @a @b', 0],
	['team', '* @org/team', 0],
	['email', '* owner@example.com', 0],
	['case-insensitive sole user', '* @Owner @owner', 1],
	['comments', '# @other\n  # @org/team\n* @owner # note @other', 1],
];

describe('CODEOWNERS maintainer boundaries', () => {
	for (let i = 0; i < ownerBoundaries.length; i++) {
		const [name, source, expected] = ownerBoundaries[i];
		it(`classifies ${name}`, async () => {
			const root = await fixture({
				ruleset: makeRuleset({ review: { required_approving_review_count: 1 } }),
				owners: { '.github/CODEOWNERS': source },
			});
			const { findings } = await checkRuleset(root);
			assert.equal(findings.length, expected);
			if (expected) assert.match(findings[0], /required_approving_review_count/);
		});
	}

	it('rejects all three review requirements after an owner-less catch-all', async () => {
		const root = await fixture({
			ruleset: makeRuleset({
				review: {
					required_approving_review_count: 1,
					require_code_owner_review: true,
					require_last_push_approval: true,
				},
			}),
			owners: { '.github/CODEOWNERS': '* @org/team\n*\n/docs/ @owner' },
		});
		const { findings } = await checkRuleset(root);
		assert.equal(findings.length, 3);
		assert.match(findings[0], /required_approving_review_count/);
		assert.match(findings[1], /require_code_owner_review/);
		assert.match(findings[2], /require_last_push_approval/);
	});

	it('treats missing CODEOWNERS as a sole maintainer', async () => {
		const root = await fixture({
			ruleset: makeRuleset({ review: { required_approving_review_count: 1 } }),
			owners: {},
		});
		const { findings } = await checkRuleset(root);
		assert.equal(findings.length, 1);
		assert.match(findings[0], /required_approving_review_count/);
	});
});

describe('CODEOWNERS lookup and line limit', () => {
	it('finds docs/CODEOWNERS when it is the only candidate', async () => {
		const root = await fixture({
			ruleset: makeRuleset({ review: { required_approving_review_count: 1 } }),
			owners: { 'docs/CODEOWNERS': '* @org/team' },
		});
		assert.deepEqual(await checkRuleset(root), { findings: [] });
	});

	it('prefers .github/CODEOWNERS over root CODEOWNERS', async () => {
		const root = await fixture({
			ruleset: makeRuleset({ review: { required_approving_review_count: 1 } }),
			owners: { '.github/CODEOWNERS': '* @owner', CODEOWNERS: '* @org/team' },
		});
		const { findings } = await checkRuleset(root);
		assert.equal(findings.length, 1);
		assert.match(findings[0], /required_approving_review_count/);
	});

	it('prefers root CODEOWNERS over docs/CODEOWNERS', async () => {
		const root = await fixture({
			ruleset: makeRuleset({ review: { required_approving_review_count: 1 } }),
			owners: { CODEOWNERS: '* @owner', 'docs/CODEOWNERS': '* @org/team' },
		});
		const { findings } = await checkRuleset(root);
		assert.equal(findings.length, 1);
	});

	it('reports one finding for CODEOWNERS_LINE_LIMIT + 1 lines', async () => {
		const root = await fixture({
			owners: { '.github/CODEOWNERS': '\n'.repeat(CODEOWNERS_LINE_LIMIT + 1) },
		});
		const { findings } = await checkRuleset(root);
		assert.equal(findings.length, 1);
		assert.match(findings[0], /^\.github\/CODEOWNERS: exceeds 2000 lines/);
	});

	it('reports unreadable CODEOWNERS without falling back', async () => {
		const root = await fixture({ owners: { CODEOWNERS: '* @org/team' } });
		await mkdir(join(root, '.github', 'CODEOWNERS'));
		const { findings } = await checkRuleset(root);
		assert.equal(findings.length, 1);
		assert.match(findings[0], /^\.github\/CODEOWNERS: cannot read file/);
	});
});

const invalidRulesets = [
	['missing file', null, /cannot read file/],
	['unparsable JSON', '{', /unparsable JSON/],
	['null', 'null', /invalid ruleset structure/],
	['scalar', '5', /invalid ruleset structure/],
	['array', '[]', /invalid ruleset structure/],
	['rules not an array', '{"rules":{}}', /invalid ruleset structure/],
];

describe('invalid ruleset input', () => {
	for (let i = 0; i < invalidRulesets.length; i++) {
		const [name, source, expected] = invalidRulesets[i];
		it(`reports one finding for ${name}`, async () => {
			const { findings } = await checkRuleset(await fixture({ source }));
			assert.equal(findings.length, 1);
			assert.ok(findings[0].startsWith('.github/rulesets/main.json:'));
			assert.match(findings[0], expected);
		});
	}

	it('reports an unreadable ruleset once', async () => {
		const root = await fixture({ source: null });
		await mkdir(join(root, '.github', 'rulesets', 'main.json'), { recursive: true });
		const { findings } = await checkRuleset(root);
		assert.equal(findings.length, 1);
		assert.match(findings[0], /^\.github\/rulesets\/main.json: cannot read file/);
	});
});

const catchAllCases = [
	['owner-less reset before a narrower owner', '* @org/team\n*\n/docs/ @owner', ['@owner'], []],
	['star reset with an owner', '* @org/team\n* @owner', ['@owner'], []],
	['double-star reset with an owner', '* @org/team\n** @owner', ['@owner'], []],
	['narrower team preserves earlier user', '* @a\n/docs/ @org/team', ['@a'], ['@org/team']],
	['owner-less reset after a narrower team', '/docs/ @org/team\n*', [], []],
	['reset after a wildcard extension pattern', '*.js @org/team\n* @owner', ['@owner'], []],
];

describe('parseCodeowners catch-all precedence', () => {
	it('exports only the supported catch-all patterns', () => {
		assert.deepEqual(CATCH_ALL_PATTERNS, ['*', '**']);
	});

	for (let i = 0; i < catchAllCases.length; i++) {
		const [name, source, users, others] = catchAllCases[i];
		it(name, () => {
			const parsed = parseCodeowners(source);
			assert.deepEqual([...parsed.users], users);
			assert.deepEqual([...parsed.others], others);
			assert.equal(parsed.error, null);
		});
	}
});

describe('parseCodeowners token rules', () => {
	it('collects users case-insensitively across patterns', () => {
		const parsed = parseCodeowners('* @Owner @owner\n/docs/ @SECOND');
		assert.deepEqual([...parsed.users], ['@owner', '@second']);
		assert.deepEqual([...parsed.others], []);
		assert.equal(parsed.error, null);
	});

	it('distinguishes teams and email owners from users', () => {
		const parsed = parseCodeowners('* @user @org/team owner@example.com');
		assert.deepEqual([...parsed.users], ['@user']);
		assert.deepEqual([...parsed.others], ['@org/team', 'owner@example.com']);
	});

	it('ignores blank lines, comments, patterns, and inline comments', () => {
		const parsed = parseCodeowners('\n  # @fake\r\n@pattern\t@Owner #note @fake\n/docs/');
		assert.deepEqual([...parsed.users], ['@owner']);
		assert.deepEqual([...parsed.others], []);
		assert.equal(parsed.error, null);
	});

	it('accepts exactly CODEOWNERS_LINE_LIMIT lines', () => {
		const parsed = parseCodeowners('\n'.repeat(CODEOWNERS_LINE_LIMIT - 1));
		assert.equal(parsed.error, null);
		assert.equal(parsed.users.size, 0);
	});

	it('rejects CODEOWNERS_LINE_LIMIT + 1 lines before collecting owners', () => {
		const parsed = parseCodeowners('* @owner\n'.repeat(CODEOWNERS_LINE_LIMIT + 1));
		assert.match(parsed.error, /exceeds 2000 lines/);
		assert.equal(parsed.users.size, 0);
		assert.equal(parsed.others.size, 0);
	});
});

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
