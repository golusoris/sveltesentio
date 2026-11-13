// Ruleset validation and CODEOWNERS lookup, catch-all precedence, and token rules.
// Effective ownership, workflow, and integration contracts: check-ruleset-contract.test.mjs.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
	createTempRoot,
	fixture,
	makeRuleset,
	ownRoot,
	removeTempRoot,
} from './check-ruleset.fixtures.mjs';
import {
	ADMIN_ROLE_ID,
	BYPASS_MODES,
	CATCH_ALL_PATTERNS,
	CODEOWNERS_CANDIDATES,
	CODEOWNERS_LINE_LIMIT,
	GATE_CONTEXT,
	checkRuleset,
	main,
	parseCodeowners,
} from './check-ruleset.mjs';

before(createTempRoot);
after(removeTempRoot);

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
				conditions: {
					ref_name: { exclude: [], include: ['refs/heads/main', 'refs/heads/lts-*'] },
				},
				enforcement: 'active',
				target: 'branch',
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
