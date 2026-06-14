import { describe, it, expect, vi } from 'vitest';
import {
	playwrightAxeDefaults,
	axeConfig,
	filterPlaywrightViolations,
	applyAxeConfig,
	type AxeBuilderLike,
} from '../src/playwright-axe';
import { WCAG_22_AA_TAGS, type AxeViolation } from '../src/a11y';

describe('playwrightAxeDefaults', () => {
	it('uses WCAG 2.2 AA tags + empty disable list + serious/critical fail set', () => {
		expect(playwrightAxeDefaults.tags).toEqual(WCAG_22_AA_TAGS);
		expect(playwrightAxeDefaults.disableRules).toEqual([]);
		expect(playwrightAxeDefaults.impactsFail).toEqual(['serious', 'critical']);
	});
});

describe('axeConfig', () => {
	it('returns defaults when called with no args', () => {
		const config = axeConfig();
		expect(config.tags).toEqual(WCAG_22_AA_TAGS);
		expect(config.impactsFail).toEqual(['serious', 'critical']);
	});

	it('overrides individual fields without losing the rest', () => {
		const config = axeConfig({ impactsFail: ['critical'] });
		expect(config.tags).toEqual(WCAG_22_AA_TAGS);
		expect(config.impactsFail).toEqual(['critical']);
	});

	it('merges custom disable rules', () => {
		const config = axeConfig({ disableRules: ['landmark-one-main'] });
		expect(config.disableRules).toEqual(['landmark-one-main']);
	});
});

describe('filterPlaywrightViolations', () => {
	it('delegates to filterViolationsByImpact (defaults serious+critical)', () => {
		const v: AxeViolation = {
			id: 'x',
			impact: 'minor',
			description: '',
			nodes: [],
		};
		expect(filterPlaywrightViolations([v])).toEqual([]);
	});
});

describe('applyAxeConfig', () => {
	it('chains withTags + disableRules on the supplied builder', () => {
		const builder: AxeBuilderLike = {
			withTags: vi.fn().mockReturnThis(),
			disableRules: vi.fn().mockReturnThis(),
		};
		const out = applyAxeConfig(builder, axeConfig({ disableRules: ['region'] }));
		expect(builder.withTags).toHaveBeenCalledWith(WCAG_22_AA_TAGS);
		expect(builder.disableRules).toHaveBeenCalledWith(['region']);
		expect(out).toBe(builder);
	});

	it('skips disableRules call when list is empty', () => {
		const builder: AxeBuilderLike = {
			withTags: vi.fn().mockReturnThis(),
			disableRules: vi.fn().mockReturnThis(),
		};
		applyAxeConfig(builder);
		expect(builder.withTags).toHaveBeenCalledOnce();
		expect(builder.disableRules).not.toHaveBeenCalled();
	});
});
