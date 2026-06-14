import { describe, it, expect } from 'vitest';
import {
	WCAG_22_AA_TAGS,
	axeDefaults,
	DEFAULT_IMPACT_FAIL_LEVELS,
	mergeAxeOptions,
	filterViolationsByImpact,
	assertNoViolations,
	AxeViolationsError,
	type AxeViolation,
} from '../src/a11y';

const seriousViolation: AxeViolation = Object.freeze({
	id: 'color-contrast',
	impact: 'serious',
	description: 'Insufficient color contrast',
	nodes: [
		{ target: ['.btn-ghost'], html: '<button class="btn-ghost">x</button>' },
	],
});

const minorViolation: AxeViolation = Object.freeze({
	id: 'region',
	impact: 'minor',
	description: 'All page content should be contained by landmarks',
	nodes: [{ target: ['.foo'], html: '<div class="foo"></div>' }],
});

describe('axeDefaults', () => {
	it('targets the WCAG 2.2 AA tag set', () => {
		expect(axeDefaults.runOnly?.type).toBe('tag');
		expect(axeDefaults.runOnly?.values).toEqual(WCAG_22_AA_TAGS);
	});
});

describe('mergeAxeOptions', () => {
	it('starts from axeDefaults when no overrides given', () => {
		expect(mergeAxeOptions().runOnly?.values).toEqual(WCAG_22_AA_TAGS);
	});

	it('overrides shallow + merges rule maps deep', () => {
		const merged = mergeAxeOptions(
			{ rules: { 'color-contrast': { enabled: false } } },
			{ rules: { 'duplicate-id-aria': { enabled: false } } },
			{ exclude: ['#histoire'] },
		);
		expect(merged.rules?.['color-contrast']?.enabled).toBe(false);
		expect(merged.rules?.['duplicate-id-aria']?.enabled).toBe(false);
		expect(merged.exclude).toEqual(['#histoire']);
	});

	it('ignores undefined overrides', () => {
		expect(mergeAxeOptions(undefined, undefined).runOnly?.values).toEqual(
			WCAG_22_AA_TAGS,
		);
	});
});

describe('filterViolationsByImpact', () => {
	it('keeps only impacts that match the fail set (defaults to serious + critical)', () => {
		const out = filterViolationsByImpact([minorViolation, seriousViolation]);
		expect(out).toEqual([seriousViolation]);
	});

	it('respects custom fail set', () => {
		const out = filterViolationsByImpact(
			[minorViolation, seriousViolation],
			['minor'],
		);
		expect(out).toEqual([minorViolation]);
	});

	it('drops violations with null/undefined impact', () => {
		const u: AxeViolation = { ...seriousViolation, impact: null };
		expect(filterViolationsByImpact([u])).toEqual([]);
	});
});

describe('assertNoViolations', () => {
	it('passes when no failing impacts present', () => {
		expect(() => assertNoViolations({ violations: [minorViolation] })).not.toThrow();
	});

	it('throws AxeViolationsError when failing impacts present', () => {
		expect(() =>
			assertNoViolations({ violations: [seriousViolation, minorViolation] }),
		).toThrow(AxeViolationsError);
	});

	it('error includes violation rule id + impact in message', () => {
		try {
			assertNoViolations({ violations: [seriousViolation] });
			throw new Error('should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(AxeViolationsError);
			const msg = (err as Error).message;
			expect(msg).toContain('color-contrast');
			expect(msg).toContain('serious');
		}
	});

	it('honours impactsFail override', () => {
		expect(() =>
			assertNoViolations({ violations: [minorViolation] }, { impactsFail: ['minor'] }),
		).toThrow(AxeViolationsError);
	});
});

describe('DEFAULT_IMPACT_FAIL_LEVELS', () => {
	it('contains exactly serious + critical', () => {
		expect([...DEFAULT_IMPACT_FAIL_LEVELS].sort()).toEqual(['critical', 'serious']);
	});
});
