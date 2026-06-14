import { describe, expect, it } from 'vitest';
import {
	SAFE_AREA_SIDES,
	cssVars,
	cssVarsString,
	safeAreaInset,
	safeAreaPadding,
	safeAreaVarName,
} from '../src/safe-area';

describe('safeAreaInset', () => {
	it('emits a bare env() expression without a fallback', () => {
		expect(safeAreaInset('top')).toBe('env(safe-area-inset-top)');
		expect(safeAreaInset('left')).toBe('env(safe-area-inset-left)');
	});

	it('floors the inset with max() when a fallback is given', () => {
		expect(safeAreaInset('bottom', '1rem')).toBe('max(env(safe-area-inset-bottom), 1rem)');
	});
});

describe('safeAreaVarName', () => {
	it('namespaces the custom property per side', () => {
		expect(safeAreaVarName('top')).toBe('--ss-safe-top');
		expect(safeAreaVarName('right')).toBe('--ss-safe-right');
	});
});

describe('cssVars', () => {
	it('emits all four sides as bare env() by default', () => {
		const vars = cssVars();
		expect(Object.keys(vars)).toHaveLength(4);
		expect(vars['--ss-safe-top']).toBe('env(safe-area-inset-top)');
		expect(vars['--ss-safe-right']).toBe('env(safe-area-inset-right)');
		expect(vars['--ss-safe-bottom']).toBe('env(safe-area-inset-bottom)');
		expect(vars['--ss-safe-left']).toBe('env(safe-area-inset-left)');
	});

	it('applies a per-side fallback (e.g. TV overscan floor) only to that side', () => {
		const vars = cssVars({ top: '2dvh' });
		expect(vars['--ss-safe-top']).toBe('max(env(safe-area-inset-top), 2dvh)');
		expect(vars['--ss-safe-bottom']).toBe('env(safe-area-inset-bottom)');
	});
});

describe('cssVarsString', () => {
	it('serialises into a style-attribute string', () => {
		expect(cssVarsString()).toBe(
			'--ss-safe-top:env(safe-area-inset-top);' +
				'--ss-safe-right:env(safe-area-inset-right);' +
				'--ss-safe-bottom:env(safe-area-inset-bottom);' +
				'--ss-safe-left:env(safe-area-inset-left)',
		);
	});

	it('reflects fallbacks in the serialised output', () => {
		expect(cssVarsString({ bottom: '8px' })).toContain(
			'--ss-safe-bottom:max(env(safe-area-inset-bottom), 8px)',
		);
	});
});

describe('safeAreaPadding', () => {
	it('emits a logical-property declaration mapped to the physical var', () => {
		expect(safeAreaPadding('block-start')).toBe('padding-block-start: var(--ss-safe-top)');
		expect(safeAreaPadding('inline-start')).toBe('padding-inline-start: var(--ss-safe-left)');
		expect(safeAreaPadding('inline-end')).toBe('padding-inline-end: var(--ss-safe-right)');
		expect(safeAreaPadding('block-end')).toBe('padding-block-end: var(--ss-safe-bottom)');
	});
});

describe('SAFE_AREA_SIDES', () => {
	it('lists the four physical edges', () => {
		expect(SAFE_AREA_SIDES).toEqual(['top', 'right', 'bottom', 'left']);
	});
});
