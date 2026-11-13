// Ruleset main-ref coverage and bounded fnmatch conversion.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { createTempRoot, fixture, makeRuleset, removeTempRoot } from './check-ruleset.fixtures.mjs';
import { MAIN_INCLUDES, MAIN_REF, checkRuleset, refPatternMatches } from './check-ruleset.mjs';

before(createTempRoot);
after(removeTempRoot);

function withRefs(include = [MAIN_REF], exclude = []) {
	return { conditions: { ref_name: { include, exclude } } };
}

const passingTargets = [
	['target absent', { target: undefined }],
	['include ~DEFAULT_BRANCH', withRefs(['~DEFAULT_BRANCH'])],
	['include ~ALL', withRefs(['~ALL'])],
	['include main and lts branches', withRefs([MAIN_REF, 'refs/heads/lts-*'])],
	['exclude lts branches', withRefs([MAIN_REF], ['refs/heads/lts-*'])],
	['exclude main-prefixed branches', withRefs([MAIN_REF], ['refs/heads/main-*'])],
	['exclude tags', withRefs([MAIN_REF], ['refs/tags/*'])],
	['exclude a 255-character entry', withRefs([MAIN_REF], [`refs/heads/${'a'.repeat(244)}`])],
];

const includeFinding =
	/conditions\.ref_name\.include must name refs\/heads\/main, ~DEFAULT_BRANCH or ~ALL/;
const matchesFinding = /exclude entry '.*' matches refs\/heads\/main/;
const cannotJudgeFinding = /exclude entry '.*' cannot be judged against refs\/heads\/main/;
const failingTargets = [
	['target tag', { target: 'tag' }, /target is 'tag', not branch/],
	['include only lts branches', withRefs(['refs/heads/lts-*']), includeFinding],
	['include only a branch glob', withRefs(['refs/heads/*']), includeFinding],
	['missing conditions', { conditions: undefined }, includeFinding],
	[
		'exclude not an array',
		withRefs([MAIN_REF], 'refs/heads/other'),
		/conditions\.ref_name\.exclude must be an array/,
	],
	['exclude main', withRefs([MAIN_REF], [MAIN_REF]), matchesFinding],
	['exclude all heads', withRefs([MAIN_REF], ['refs/heads/*']), matchesFinding],
	['exclude all refs', withRefs([MAIN_REF], ['refs/**']), matchesFinding],
	['exclude main with a question mark', withRefs([MAIN_REF], ['refs/heads/ma?n']), matchesFinding],
	['exclude ~DEFAULT_BRANCH', withRefs([MAIN_REF], ['~DEFAULT_BRANCH']), matchesFinding],
	['exclude ~ALL', withRefs([MAIN_REF], ['~ALL']), matchesFinding],
	['exclude unqualified main', withRefs([MAIN_REF], ['main']), cannotJudgeFinding],
	['exclude a bracket pattern', withRefs([MAIN_REF], ['refs/heads/[m]ain']), cannotJudgeFinding],
	[
		'exclude a 256-character entry',
		withRefs([MAIN_REF], [`refs/heads/${'a'.repeat(245)}`]),
		cannotJudgeFinding,
	],
	['exclude a number', withRefs([MAIN_REF], [123]), matchesFinding],
	[
		'exclude main below any directory',
		withRefs([MAIN_REF], ['refs/heads/**/main']),
		matchesFinding,
	],
];

describe('ruleset main-ref coverage', () => {
	for (let i = 0; i < passingTargets.length; i++) {
		const [name, overrides] = passingTargets[i];
		it(`accepts ${name}`, async () => {
			const ruleset = makeRuleset(overrides);
			assert.deepEqual(await checkRuleset(await fixture({ ruleset })), { findings: [] });
		});
	}

	for (let i = 0; i < failingTargets.length; i++) {
		const [name, overrides, expected] = failingTargets[i];
		it(`reports one finding for ${name}`, async () => {
			const ruleset = makeRuleset(overrides);
			const { findings } = await checkRuleset(await fixture({ ruleset }));
			assert.equal(findings.length, 1);
			assert.ok(findings[0].startsWith('.github/rulesets/main.json: '));
			assert.match(findings[0], expected);
		});
	}

	it('exports the exact main ref and include allow-list', () => {
		assert.equal(MAIN_REF, 'refs/heads/main');
		assert.deepEqual(MAIN_INCLUDES, ['refs/heads/main', '~DEFAULT_BRANCH', '~ALL']);
	});
});

const refPatternCases = [
	['single star stays within a segment', 'refs/heads/*', 'refs/heads/a/b', false],
	['double star crosses segments', 'refs/heads/**', 'refs/heads/a/b', true],
	['dot remains literal', 'refs/heads/m.in', MAIN_REF, false],
	['question mark matches one character', 'refs/heads/ma?n', MAIN_REF, true],
	['pattern must match the whole ref', 'refs/heads/mai', MAIN_REF, false],
	['question mark does not match a slash', 'refs/heads/ma?n', 'refs/heads/ma/n', false],
	['double star in the middle matches a segment', 'refs/**/main', MAIN_REF, true],
	['double star matches zero characters', 'refs/heads/main**', MAIN_REF, true],
	['single star matches zero characters', 'refs/heads/main*', MAIN_REF, true],
	['single star then literal needs a later match', 'refs/heads/*n', MAIN_REF, true],
	['single star then literal fails without it', 'refs/heads/*x', MAIN_REF, false],
	['single star cannot reach past a slash', 'refs/*/main', 'refs/heads/x/main', false],
	['empty ref fails a non-empty pattern', 'refs/heads/*', '', false],
	['star-only tail cannot replace a missing prefix', 'refs/tags/**', MAIN_REF, false],
	['double star element matches zero directories', 'refs/heads/**/main', MAIN_REF, true],
	[
		'double star element matches several directories',
		'refs/heads/**/main',
		'refs/heads/a/b/main',
		true,
	],
	['double star element keeps the literal tail', 'refs/heads/**/main', 'refs/heads/a/mainx', false],
	['double star element at the pattern start', '**/main', MAIN_REF, true],
	['repeated double star elements collapse', 'refs/**/**/main', MAIN_REF, true],
	['double star after a character is no element', 'refs/heads/x**/main', MAIN_REF, false],
	['trailing double star element needs a separator', 'refs/heads/**/', MAIN_REF, false],
];

describe('refPatternMatches', () => {
	for (let i = 0; i < refPatternCases.length; i++) {
		const [name, pattern, ref, expected] = refPatternCases[i];
		it(name, () => {
			assert.equal(refPatternMatches(pattern, ref), expected);
		});
	}

	it('refPatternMatches builds no regular expression from ruleset data', () => {
		const source = readFileSync(new URL('./check-ruleset.mjs', import.meta.url), 'utf8');
		assert.doesNotMatch(source, /new RegExp\(/);
	});
});
