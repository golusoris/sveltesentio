import { describe, expect, it } from 'vitest';
import {
	TOKEN_KEYS,
	isValidOklch,
	overrideCss,
	overrideToInlineStyle,
	parseOverride,
	sanitizeOverride,
	serializeOverride,
	type ThemeOverride,
} from '../src/theme/customizer.js';

describe('isValidOklch', () => {
	it('accepts oklch(L C H) and the alpha form', () => {
		expect(isValidOklch('oklch(0.7 0.15 250)')).toBe(true);
		expect(isValidOklch('oklch(0.7 0.15 250 / 0.5)')).toBe(true);
		expect(isValidOklch('oklch( 62% 0.2 30 )')).toBe(true);
	});
	it('rejects non-oklch + injection attempts', () => {
		expect(isValidOklch('red')).toBe(false);
		expect(isValidOklch('#fff')).toBe(false);
		expect(isValidOklch('hsl(0 0% 0%)')).toBe(false);
		expect(isValidOklch('oklch(0.7 0.15 250); background: url(x)')).toBe(false);
		expect(isValidOklch('')).toBe(false);
	});
});

describe('TOKEN_KEYS', () => {
	it('contains the semantic tokens a customiser may target', () => {
		expect(TOKEN_KEYS).toContain('primary');
		expect(TOKEN_KEYS).toContain('accent');
		expect(TOKEN_KEYS).toContain('cardForeground');
	});
});

describe('sanitizeOverride', () => {
	it('keeps only known keys with valid oklch values', () => {
		const dirty = {
			primary: 'oklch(0.5 0.1 120)',
			accent: 'red',
			bogus: 'oklch(0.5 0.1 120)',
		} as unknown as ThemeOverride;
		expect(sanitizeOverride(dirty)).toEqual({ primary: 'oklch(0.5 0.1 120)' });
	});
	it('returns an empty object when nothing is valid', () => {
		expect(sanitizeOverride({ primary: 'nope' } as ThemeOverride)).toEqual({});
	});
});

describe('overrideToInlineStyle', () => {
	it('emits kebab-cased --color-* declarations for valid entries', () => {
		const style = overrideToInlineStyle({
			primary: 'oklch(0.5 0.1 120)',
			cardForeground: 'oklch(0.9 0 0)',
		});
		expect(style).toContain('--color-primary: oklch(0.5 0.1 120);');
		expect(style).toContain('--color-card-foreground: oklch(0.9 0 0);');
	});
	it('returns "" when the override sanitises to empty', () => {
		expect(overrideToInlineStyle({ primary: 'bad' } as ThemeOverride)).toBe('');
	});
});

describe('overrideCss', () => {
	it('wraps declarations in the :root selector by default', () => {
		const css = overrideCss({ accent: 'oklch(0.7 0.1 200)' });
		expect(css.startsWith(':root {')).toBe(true);
		expect(css).toContain('\t--color-accent: oklch(0.7 0.1 200);');
		expect(css.trimEnd().endsWith('}')).toBe(true);
	});
	it('honours a custom selector', () => {
		expect(overrideCss({ accent: 'oklch(0.7 0.1 200)' }, '[data-tenant="acme"]')).toContain(
			'[data-tenant="acme"] {',
		);
	});
	it('returns "" for an empty override', () => {
		expect(overrideCss({})).toBe('');
	});
});

describe('serialize/parse round-trip', () => {
	it('round-trips a sanitised override through JSON', () => {
		const override: ThemeOverride = { primary: 'oklch(0.5 0.1 120)' };
		expect(parseOverride(serializeOverride(override))).toEqual(override);
	});
	it('drops invalid entries on serialise', () => {
		expect(serializeOverride({ primary: 'bad', accent: 'oklch(0.6 0.1 60)' } as ThemeOverride)).toBe(
			JSON.stringify({ accent: 'oklch(0.6 0.1 60)' }),
		);
	});
	it('parse returns {} for null/empty/garbage/non-object/array', () => {
		expect(parseOverride(null)).toEqual({});
		expect(parseOverride('')).toEqual({});
		expect(parseOverride('not json')).toEqual({});
		expect(parseOverride('"a string"')).toEqual({});
		expect(parseOverride('[1,2]')).toEqual({});
	});
	it('parse re-sanitises a stored payload (cannot inject CSS)', () => {
		const stored = JSON.stringify({ primary: 'oklch(0.5 0.1 120); evil', accent: 'oklch(0.6 0.1 60)' });
		expect(parseOverride(stored)).toEqual({ accent: 'oklch(0.6 0.1 60)' });
	});
});
