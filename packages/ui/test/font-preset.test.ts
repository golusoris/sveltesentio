import { describe, expect, it } from 'vitest';
import {
	SYSTEM_MONO,
	SYSTEM_SANS,
	fontFaceCss,
	fontPresetCss,
	fontPreloadLink,
	fontPresets,
	fontStack,
} from '../src/font/preset.js';

describe('fontStack', () => {
	it('returns the bare system sans stack for the system preset', () => {
		expect(fontStack('system')).toBe(SYSTEM_SANS);
	});
	it('prepends a quoted family for a multi-word sans preset', () => {
		expect(fontStack('inter')).toBe(`'Inter Variable', ${SYSTEM_SANS}`);
		expect(fontStack('geist')).toBe(`'Geist Variable', ${SYSTEM_SANS}`);
	});
	it('uses the mono fallback for a mono preset', () => {
		expect(fontStack('mono')).toBe(`'Geist Mono Variable', ${SYSTEM_MONO}`);
	});
	it('accepts a full preset object', () => {
		expect(fontStack(fontPresets.inter)).toBe(fontStack('inter'));
	});
});

describe('fontPresetCss', () => {
	it('sets --font-sans for a sans preset, scoped to :root by default', () => {
		const css = fontPresetCss('inter');
		expect(css.startsWith(':root {')).toBe(true);
		expect(css).toContain('--font-sans:');
		expect(css).toContain("'Inter Variable'");
	});
	it('sets --font-mono for a mono preset', () => {
		expect(fontPresetCss('mono')).toContain('--font-mono:');
	});
	it('honours a custom selector', () => {
		expect(fontPresetCss('geist', '.brand')).toContain('.brand {');
	});
	it('emits the system stack for the system preset', () => {
		expect(fontPresetCss('system')).toContain(SYSTEM_SANS);
	});
});

describe('fontFaceCss', () => {
	it('emits @font-face with font-display: swap + variable src for a web-font preset', () => {
		const css = fontFaceCss('inter', '/fonts/inter.woff2');
		expect(css).toContain('@font-face {');
		expect(css).toContain("font-family: 'Inter Variable';");
		expect(css).toContain('font-display: swap;');
		expect(css).toContain("src: url('/fonts/inter.woff2') format('woff2-variations');");
		expect(css).toContain('font-weight: 100 900;');
	});
	it('honours a custom weight range', () => {
		expect(fontFaceCss('geist', '/g.woff2', '300 700')).toContain('font-weight: 300 700;');
	});
	it('returns "" for the system preset (no @font-face)', () => {
		expect(fontFaceCss('system', '/x.woff2')).toBe('');
	});
});

describe('fontPreloadLink', () => {
	it('builds preload attrs for a web-font preset', () => {
		expect(fontPreloadLink('inter', '/fonts/inter.woff2')).toEqual({
			rel: 'preload',
			as: 'font',
			type: 'font/woff2',
			href: '/fonts/inter.woff2',
			crossorigin: 'anonymous',
		});
	});
	it('returns undefined for the system preset (nothing to preload)', () => {
		expect(fontPreloadLink('system', '/x.woff2')).toBeUndefined();
	});
});
