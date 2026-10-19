import { describe, expect, it } from 'vitest';
import {
	checkPaletteContrast,
	contrastRatio,
	oklchToRelativeLuminance,
	paletteContrastPairs,
	paletteCss,
	paletteToCssVars,
	presetSnatchArr,
	type PalettePreset,
} from '../src/presets/index.js';

describe('presetSnatchArr contrast (positive)', () => {
	it('passes all 20 WCAG 2.2 contrast pairs across light and dark modes', () => {
		const results = checkPaletteContrast(presetSnatchArr);
		expect(results).toHaveLength(40);
		const failures = results.filter((r) => !r.pass);
		expect(
			failures,
			`Expected all contrast checks to pass, but found failures: ${JSON.stringify(failures, null, 2)}`,
		).toEqual([]);
	});
});

describe('presetSnatchArr recorded contrast ratios (ui-variants2 M3)', () => {
	const RECORDED_RATIOS: readonly {
		readonly pair: string;
		readonly light: number;
		readonly dark: number;
	}[] = [
		{ pair: 'foreground/background', light: 18.0, dark: 17.74 },
		{ pair: 'foreground/card', light: 18.9, dark: 16.19 },
		{ pair: 'mutedForeground/background', light: 6.31, dark: 7.99 },
		{ pair: 'mutedForeground/card', light: 6.62, dark: 7.29 },
		{ pair: 'primaryForeground/primary', light: 10.25, dark: 8.69 },
		{ pair: 'destructiveForeground/destructive', light: 5.21, dark: 5.21 },
	];

	for (const expected of RECORDED_RATIOS) {
		it(`matches recorded ratio within ±0.05 for ${expected.pair}`, () => {
			const results = checkPaletteContrast(presetSnatchArr);
			const lightResult = results.find((r) => r.pair === expected.pair && r.mode === 'light');
			const darkResult = results.find((r) => r.pair === expected.pair && r.mode === 'dark');

			expect(lightResult).toBeDefined();
			expect(darkResult).toBeDefined();

			expect(
				Math.abs(lightResult!.ratio - expected.light),
				`Light ratio for ${expected.pair}: computed ${lightResult!.ratio}, expected ${expected.light}`,
			).toBeLessThanOrEqual(0.05);

			expect(
				Math.abs(darkResult!.ratio - expected.dark),
				`Dark ratio for ${expected.pair}: computed ${darkResult!.ratio}, expected ${expected.dark}`,
			).toBeLessThanOrEqual(0.05);
		});
	}
});

describe('checkPaletteContrast (negative / planted defect)', () => {
	it('fails when light.mutedForeground is reduced to oklch(0.80 0.02 285)', () => {
		const defective: PalettePreset = {
			...presetSnatchArr,
			light: {
				...presetSnatchArr.light,
				mutedForeground: 'oklch(0.80 0.02 285)',
			},
		};
		const results = checkPaletteContrast(defective);
		const mutedBgResult = results.find(
			(r) => r.pair === 'mutedForeground/background' && r.mode === 'light',
		);
		expect(mutedBgResult).toBeDefined();
		expect(mutedBgResult!.pass).toBe(false);
		expect(mutedBgResult!.ratio).toBeLessThan(mutedBgResult!.min);
	});

	it('fails when light.input is set to oklch(0.90 0.02 285) below min 3', () => {
		const defective: PalettePreset = {
			...presetSnatchArr,
			light: {
				...presetSnatchArr.light,
				input: 'oklch(0.90 0.02 285)',
			},
		};
		const results = checkPaletteContrast(defective);
		const inputBgResult = results.find((r) => r.pair === 'input/background' && r.mode === 'light');
		expect(inputBgResult).toBeDefined();
		expect(inputBgResult!.pass).toBe(false);
		expect(inputBgResult!.min).toBe(3);
		expect(inputBgResult!.ratio).toBeLessThan(3);
	});
});

describe('contrastRatio & oklchToRelativeLuminance boundary behavior', () => {
	it('computes maximum contrast ratio ≈ 21 (±0.01) between black and white', () => {
		const ratio = contrastRatio('oklch(1 0 0)', 'oklch(0 0 0)');
		expect(Math.abs(ratio - 21)).toBeLessThanOrEqual(0.01);
	});

	it('returns exactly 1 for identical colors', () => {
		expect(contrastRatio('oklch(0.5 0.1 280)', 'oklch(0.5 0.1 280)')).toBe(1);
		expect(contrastRatio('oklch(1 0 0)', 'oklch(1 0 0)')).toBe(1);
		expect(contrastRatio('oklch(0 0 0)', 'oklch(0 0 0)')).toBe(1);
	});

	it('is symmetric regarding argument order', () => {
		const c1 = presetSnatchArr.light.primary;
		const c2 = presetSnatchArr.light.background;
		expect(contrastRatio(c1, c2)).toBe(contrastRatio(c2, c1));
	});

	it('handles unparseable input as documented by returning NaN', () => {
		expect(Number.isNaN(oklchToRelativeLuminance('invalid-color'))).toBe(true);
		expect(Number.isNaN(oklchToRelativeLuminance('rgb(255, 0, 0)'))).toBe(true);
		expect(Number.isNaN(oklchToRelativeLuminance(''))).toBe(true);
		expect(Number.isNaN(contrastRatio('invalid', 'oklch(1 0 0)'))).toBe(true);
		expect(Number.isNaN(contrastRatio('oklch(1 0 0)', 'invalid'))).toBe(true);
	});

	it('calculates expected luminance bounds for pure black and pure white', () => {
		expect(oklchToRelativeLuminance('oklch(0 0 0)')).toBe(0);
		expect(oklchToRelativeLuminance('oklch(1 0 0)')).toBe(1);
	});
});

describe('paletteContrastPairs', () => {
	it('defines exactly 20 pairs with correct thresholds', () => {
		expect(paletteContrastPairs).toHaveLength(20);
		const textPairs = paletteContrastPairs.filter((p) => p.min === 4.5);
		const nonTextPairs = paletteContrastPairs.filter((p) => p.min === 3);
		expect(textPairs).toHaveLength(14);
		expect(nonTextPairs).toHaveLength(6);
	});
});

describe('paletteToCssVars & paletteCss', () => {
	it('emits exactly 23 lines for paletteToCssVars', () => {
		const lightVars = paletteToCssVars(presetSnatchArr.light);
		const lines = lightVars.split('\n');
		expect(lines).toHaveLength(23);
		expect(lightVars).toContain('\t--color-brand: oklch(0.38 0.16 285);');
		expect(lightVars).toContain('\t--color-nav-active-foreground: oklch(0.20 0.10 285);');
	});

	it('emits :root and .dark rules in paletteCss with expected layout', () => {
		const css = paletteCss(presetSnatchArr);
		expect(css.startsWith(':root {\n')).toBe(true);
		expect(css).toContain('\n}\n\n.dark {\n');
		expect(css.endsWith('\n}'));
		expect(css).toContain('--color-brand:');
		expect(css).toContain('--color-nav-active-foreground:');
	});

	it('honours a custom darkSelector in paletteCss', () => {
		const css = paletteCss(presetSnatchArr, '[data-theme="dark"]');
		expect(css).toContain('\n}\n\n[data-theme="dark"] {\n');
		expect(css).not.toContain('.dark {');
	});
});
