import { RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
import { noDirectTime, sentioEslint } from '../src/eslint';

const ruleTester = new RuleTester({
	languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('no-direct-time rule', () => {
	it('passes valid + flags invalid time reads', () => {
		ruleTester.run('no-direct-time', noDirectTime, {
			valid: [
				// the sanctioned path: read via the injected clock
				{ code: 'const now = useClock().now();' },
				{ code: 'const t = getClock().monotonic();' },
				// explicit, deterministic construction is allowed
				{ code: 'const d = new Date(serverMs);' },
				{ code: 'const d = new Date(2026, 0, 1);' },
				// unrelated `.now` / `.then` calls must not trip the rule
				{ code: 'foo.now();' },
				{ code: 'Date.parse("2026-01-01");' },
				{ code: 'performance.mark("x");' },
				// computed access is not the banned static form
				{ code: 'Date["now"]();' },
				// `new` of something other than `Date`, and via a non-identifier callee
				{ code: 'const m = new Map();' },
				{ code: 'const x = new foo.Bar();' },
			],
			invalid: [
				{
					code: 'const t = Date.now();',
					errors: [{ messageId: 'dateNow' }],
				},
				{
					code: 'const d = new Date();',
					errors: [{ messageId: 'newDate' }],
				},
				{
					code: 'const m = performance.now();',
					errors: [{ messageId: 'performanceNow' }],
				},
				{
					code: 'const a = Date.now(); const b = new Date();',
					errors: [{ messageId: 'dateNow' }, { messageId: 'newDate' }],
				},
			],
		});
	});

	it('exposes a flat-config plugin shape', () => {
		expect(sentioEslint.meta.name).toBe('@sveltesentio/core');
		expect(sentioEslint.rules['no-direct-time']).toBe(noDirectTime);
		expect(noDirectTime.meta?.messages).toMatchObject({
			dateNow: expect.any(String),
			newDate: expect.any(String),
			performanceNow: expect.any(String),
		});
	});
});
