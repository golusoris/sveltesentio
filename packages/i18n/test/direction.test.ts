import { describe, expect, it } from 'vitest';
import { getTextDirection } from '../src/direction.js';

describe('getTextDirection', () => {
	it('returns ltr by default for unknown locales', () => {
		expect(getTextDirection('en')).toBe('ltr');
		expect(getTextDirection('de-AT')).toBe('ltr');
		expect(getTextDirection('fr')).toBe('ltr');
		expect(getTextDirection('ja-JP')).toBe('ltr');
		expect(getTextDirection('')).toBe('ltr');
	});

	it('detects RTL for known RTL languages', () => {
		expect(getTextDirection('ar')).toBe('rtl');
		expect(getTextDirection('he')).toBe('rtl');
		expect(getTextDirection('fa-IR')).toBe('rtl');
		expect(getTextDirection('ur-PK')).toBe('rtl');
		expect(getTextDirection('yi')).toBe('rtl');
	});

	it('detects RTL via script subtag', () => {
		expect(getTextDirection('az-Arab')).toBe('rtl');
		expect(getTextDirection('sr-Cyrl')).toBe('ltr');
		expect(getTextDirection('uz-Arab-AF')).toBe('rtl');
	});

	it('normalises case + underscore separators', () => {
		expect(getTextDirection('AR')).toBe('rtl');
		expect(getTextDirection('he_IL')).toBe('rtl');
		expect(getTextDirection('EN_US')).toBe('ltr');
	});
});
