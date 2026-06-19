import { describe, expect, it } from 'vitest';
import {
	MODE_CYCLE,
	THEME_COOKIE,
	htmlClassFor,
	isThemeMode,
	modeLabel,
	nextMode,
	parseThemeCookie,
	resolveMode,
	serializeThemeCookie,
	type ThemeMode,
} from '../src/theme/mode.js';

describe('isThemeMode', () => {
	it('accepts the three valid modes', () => {
		for (const m of ['light', 'dark', 'system']) expect(isThemeMode(m)).toBe(true);
	});
	it('rejects anything else', () => {
		for (const v of ['LIGHT', '', null, undefined, 0, {}]) expect(isThemeMode(v)).toBe(false);
	});
});

describe('resolveMode', () => {
	it('passes explicit light/dark through regardless of system pref', () => {
		expect(resolveMode('light', true)).toBe('light');
		expect(resolveMode('dark', false)).toBe('dark');
	});
	it('resolves system against the prefers-dark flag', () => {
		expect(resolveMode('system', true)).toBe('dark');
		expect(resolveMode('system', false)).toBe('light');
	});
});

describe('nextMode', () => {
	it('cycles light → dark → system → light', () => {
		expect(nextMode('light')).toBe('dark');
		expect(nextMode('dark')).toBe('system');
		expect(nextMode('system')).toBe('light');
	});
	it('restarts at light for an invalid current value', () => {
		// indexOf = -1 → (-1 + 1) % 3 = 0 → MODE_CYCLE[0] = 'light'
		expect(nextMode('bogus' as ThemeMode)).toBe('light');
	});
	it('visits every mode exactly once over a full cycle', () => {
		const seen = new Set<ThemeMode>();
		let m: ThemeMode = 'light';
		for (let i = 0; i < MODE_CYCLE.length; i++) {
			seen.add(m);
			m = nextMode(m);
		}
		expect(seen).toEqual(new Set(MODE_CYCLE));
		expect(m).toBe('light');
	});
});

describe('htmlClassFor', () => {
	it('maps dark → "dark" and light → ""', () => {
		expect(htmlClassFor('dark')).toBe('dark');
		expect(htmlClassFor('light')).toBe('');
	});
});

describe('parseThemeCookie', () => {
	it('returns the stored mode when valid', () => {
		expect(parseThemeCookie('dark')).toBe('dark');
		expect(parseThemeCookie('light')).toBe('light');
		expect(parseThemeCookie('system')).toBe('system');
	});
	it('falls back to system for missing/invalid values', () => {
		expect(parseThemeCookie(null)).toBe('system');
		expect(parseThemeCookie(undefined)).toBe('system');
		expect(parseThemeCookie('purple')).toBe('system');
	});
});

describe('serializeThemeCookie', () => {
	it('emits a Lax, root-path, year-long cookie by default', () => {
		const c = serializeThemeCookie('dark');
		expect(c).toContain(`${THEME_COOKIE}=dark`);
		expect(c).toContain('Path=/');
		expect(c).toContain('SameSite=Lax');
		expect(c).toContain(`Max-Age=${60 * 60 * 24 * 365}`);
	});
	it('honours a custom max-age', () => {
		expect(serializeThemeCookie('light', 60)).toContain('Max-Age=60');
	});
});

describe('modeLabel', () => {
	it('returns a capitalised human label per mode', () => {
		expect(modeLabel('light')).toBe('Light');
		expect(modeLabel('dark')).toBe('Dark');
		expect(modeLabel('system')).toBe('System');
	});
});
