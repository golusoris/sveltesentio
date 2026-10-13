import { describe, expect, it } from 'vitest';
import {
	preset10Foot,
	presetCss,
	presetDashboard,
	presetDesktop,
	presetToCssVars,
	type InterfacePreset,
} from '../src/presets/index.js';

const EXPECTED_DESKTOP_VARS = [
	'\t--ui-min-target-size: 24px;',
	'\t--ui-control-height: 2.25rem;',
	'\t--ui-font-size-base: 16px;',
	'\t--ui-spacing-scale: 1;',
	'\t--ui-radius: 0.5rem;',
	'\t--ui-focus-emphasis: 0;',
].join('\n');

const EXPECTED_10FOOT_VARS = [
	'\t--ui-min-target-size: 44px;',
	'\t--ui-control-height: 3.5rem;',
	'\t--ui-font-size-base: 20px;',
	'\t--ui-spacing-scale: 1.5;',
	'\t--ui-radius: 0.75rem;',
	'\t--ui-focus-emphasis: 1;',
].join('\n');

const EXPECTED_DASHBOARD_VARS = [
	'\t--ui-min-target-size: 24px;',
	'\t--ui-control-height: 2rem;',
	'\t--ui-font-size-base: 14px;',
	'\t--ui-spacing-scale: 0.875;',
	'\t--ui-radius: 0.375rem;',
	'\t--ui-focus-emphasis: 0;',
].join('\n');

describe('presetDesktop', () => {
	it('defines the standard fine-pointer desktop preset', () => {
		expect(presetDesktop).toEqual({
			name: 'desktop',
			minTargetSize: '24px',
			controlHeight: '2.25rem',
			baseFontSize: '16px',
			spacingScale: 1,
			radius: '0.5rem',
			emphasizeFocus: false,
		});
	});

	it('does not emphasize focus ring and has a 24px target floor', () => {
		expect(presetDesktop.emphasizeFocus).toBe(false);
		expect(presetDesktop.minTargetSize).not.toBe('44px');
		expect(presetDesktop.minTargetSize).toBe('24px');
	});

	it('matches WCAG 2.2 AA target size minimum boundary for pointer controls', () => {
		expect(parseInt(presetDesktop.minTargetSize, 10)).toBeGreaterThanOrEqual(24);
	});
});

describe('preset10Foot', () => {
	it('defines the 10-foot couch/TV navigation preset', () => {
		expect(preset10Foot).toEqual({
			name: '10foot',
			minTargetSize: '44px',
			controlHeight: '3.5rem',
			baseFontSize: '20px',
			spacingScale: 1.5,
			radius: '0.75rem',
			emphasizeFocus: true,
		});
	});

	it('emphasizes focus visible ring for D-pad/remote control navigation', () => {
		expect(preset10Foot.emphasizeFocus).toBe(true);
		expect(preset10Foot.spacingScale).toBeGreaterThan(1);
	});

	it('provides the largest target size (44px) and base typography (20px)', () => {
		expect(preset10Foot.minTargetSize).toBe('44px');
		expect(preset10Foot.baseFontSize).toBe('20px');
	});
});

describe('presetDashboard', () => {
	it('defines the dense admin dashboard preset', () => {
		expect(presetDashboard).toEqual({
			name: 'dashboard',
			minTargetSize: '24px',
			controlHeight: '2rem',
			baseFontSize: '14px',
			spacingScale: 0.875,
			radius: '0.375rem',
			emphasizeFocus: false,
		});
	});

	it('uses compact spacing scale below 1 and tight control height', () => {
		expect(presetDashboard.spacingScale).toBeLessThan(1);
		expect(presetDashboard.controlHeight).toBe('2rem');
		expect(presetDashboard.emphasizeFocus).toBe(false);
	});

	it('holds the smallest base font size (14px) and corner radius (0.375rem)', () => {
		expect(presetDashboard.baseFontSize).toBe('14px');
		expect(presetDashboard.radius).toBe('0.375rem');
	});
});

describe('presetToCssVars', () => {
	it('formats presetDesktop into exact custom properties with focus emphasis 0', () => {
		expect(presetToCssVars(presetDesktop)).toBe(EXPECTED_DESKTOP_VARS);
	});

	it('formats preset10Foot into exact custom properties with focus emphasis 1', () => {
		expect(presetToCssVars(preset10Foot)).toBe(EXPECTED_10FOOT_VARS);
	});

	it('does not include outer selector or braces', () => {
		const vars = presetToCssVars(presetDashboard);
		expect(vars).not.toContain('{');
		expect(vars).not.toContain('}');
		expect(vars.startsWith('\t--ui-min-target-size:')).toBe(true);
	});

	it('handles boundary custom preset with zero numeric values', () => {
		const custom: InterfacePreset = {
			name: 'desktop',
			minTargetSize: '0px',
			controlHeight: '0rem',
			baseFontSize: '0px',
			spacingScale: 0,
			radius: '0',
			emphasizeFocus: false,
		};
		const output = presetToCssVars(custom);
		expect(output).toBe(
			[
				'\t--ui-min-target-size: 0px;',
				'\t--ui-control-height: 0rem;',
				'\t--ui-font-size-base: 0px;',
				'\t--ui-spacing-scale: 0;',
				'\t--ui-radius: 0;',
				'\t--ui-focus-emphasis: 0;',
			].join('\n'),
		);
	});
});

describe('presetCss', () => {
	it('emits exact scoped CSS rules for presetDesktop by default', () => {
		expect(presetCss(presetDesktop)).toBe(
			`[data-interface="desktop"] {\n${EXPECTED_DESKTOP_VARS}\n}`,
		);
	});

	it('emits exact scoped CSS rules for presetDashboard by default', () => {
		expect(presetCss(presetDashboard)).toBe(
			`[data-interface="dashboard"] {\n${EXPECTED_DASHBOARD_VARS}\n}`,
		);
	});

	it('emits exact scoped CSS rules for preset10Foot by default', () => {
		expect(presetCss(preset10Foot)).toBe(`[data-interface="10foot"] {\n${EXPECTED_10FOOT_VARS}\n}`);
	});

	it('honours a custom selector such as :root', () => {
		expect(presetCss(presetDesktop, ':root')).toBe(`:root {\n${EXPECTED_DESKTOP_VARS}\n}`);
	});

	it('honours a custom class or attribute selector', () => {
		const customSel = 'body[data-display="couch"]';
		expect(presetCss(preset10Foot, customSel)).toBe(`${customSel} {\n${EXPECTED_10FOOT_VARS}\n}`);
	});

	it('does not emit :root when selector parameter is omitted', () => {
		const css = presetCss(presetDesktop);
		expect(css.startsWith(':root')).toBe(false);
		expect(css.startsWith('[data-interface="desktop"]')).toBe(true);
	});
});
