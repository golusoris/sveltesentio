// SPDX-FileCopyrightText: 2026 lusoris <lusoris@pm.me>
// SPDX-License-Identifier: EUPL-1.2

import type { PalettePreset, PaletteTokens } from './palette.js';

const OKLCH_REGEX = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+%?)?\s*\)$/;

/**
 * Computes the relative luminance (Y in linear sRGB) of an OKLCH color string.
 *
 * Math and conversion steps:
 * 1. OKLCH -> Oklab (a = C cos(h), b = C sin(h), h in degrees).
 * 2. Oklab -> non-linear LMS' using Björn Ottosson's matrices.
 * 3. Cube LMS' to obtain linear LMS (l = l'^3, m = m'^3, s = s'^3).
 * 4. Linear LMS -> linear sRGB using the inverse M1 matrix.
 *    See: https://bottosson.github.io/posts/oklab/
 * 5. Clamp RGB channels to [0, 1].
 * 6. Compute relative luminance Y = 0.2126 * R + 0.7152 * G + 0.0722 * B.
 *
 * Note: `@sveltesentio/ui` does not depend on `@sveltesentio/core/errors`,
 * so this function returns `NaN` for unparseable input.
 *
 * @param css An `oklch(L C H)` CSS color string (e.g. `oklch(0.985 0.015 285)`).
 * @returns The relative luminance in [0, 1], or `NaN` if `css` cannot be parsed.
 */
export function oklchToRelativeLuminance(css: string): number {
	const match = css.trim().match(OKLCH_REGEX);
	if (!match) {
		return NaN;
	}

	const lStr = match[1];
	const cStr = match[2];
	const hStr = match[3];

	if (lStr === undefined || cStr === undefined || hStr === undefined) {
		return NaN;
	}

	const L = parseFloat(lStr);
	const C = parseFloat(cStr);
	const h = parseFloat(hStr);

	if (Number.isNaN(L) || Number.isNaN(C) || Number.isNaN(h)) {
		return NaN;
	}

	const hRad = (h * Math.PI) / 180;
	const a = C * Math.cos(hRad);
	const b = C * Math.sin(hRad);

	// Björn Ottosson Oklab to LMS' matrix
	const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = L - 0.0894841775 * a - 1.291485548 * b;

	// Cube non-linear LMS' to linear LMS
	const l = l_ * l_ * l_;
	const m = m_ * m_ * m_;
	const s = s_ * s_ * s_;

	// Inverse M1 matrix from linear LMS to linear sRGB
	// (Björn Ottosson, https://bottosson.github.io/posts/oklab/)
	const rLinear = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
	const gLinear = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
	const bLinear = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

	// Clamp each channel to [0, 1]
	const r = Math.max(0, Math.min(1, rLinear));
	const g = Math.max(0, Math.min(1, gLinear));
	const b_rgb = Math.max(0, Math.min(1, bLinear));

	// Relative luminance Y in linear sRGB (already linear, no gamma step needed)
	return 0.2126 * r + 0.7152 * g + 0.0722 * b_rgb;
}

/**
 * Computes the WCAG 2.x contrast ratio between two OKLCH color strings.
 *
 * Formula: `(L1 + 0.05) / (L2 + 0.05)` where `L1` is the relative luminance
 * of the lighter color and `L2` is the relative luminance of the darker color.
 *
 * @param a First OKLCH color string.
 * @param b Second OKLCH color string.
 * @returns The contrast ratio in [1, 21], or `NaN` if either color cannot be parsed.
 */
export function contrastRatio(a: string, b: string): number {
	const yA = oklchToRelativeLuminance(a);
	const yB = oklchToRelativeLuminance(b);

	if (Number.isNaN(yA) || Number.isNaN(yB)) {
		return NaN;
	}

	if (a === b) {
		return 1;
	}

	const lighter = Math.max(yA, yB);
	const darker = Math.min(yA, yB);
	return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The 20 contrast pairs required for WCAG 2.2 compliance on palette presets:
 * - 14 text pairs requiring a minimum contrast ratio of 4.5:1 (WCAG 1.4.3).
 * - 6 non-text pairs requiring a minimum contrast ratio of 3:1 (WCAG 1.4.11).
 */
export const paletteContrastPairs: readonly {
	readonly fg: keyof PaletteTokens;
	readonly bg: keyof PaletteTokens;
	readonly min: 4.5 | 3;
}[] = [
	// text 4.5
	{ fg: 'foreground', bg: 'background', min: 4.5 },
	{ fg: 'foreground', bg: 'card', min: 4.5 },
	{ fg: 'cardForeground', bg: 'card', min: 4.5 },
	{ fg: 'popoverForeground', bg: 'popover', min: 4.5 },
	{ fg: 'mutedForeground', bg: 'background', min: 4.5 },
	{ fg: 'mutedForeground', bg: 'card', min: 4.5 },
	{ fg: 'mutedForeground', bg: 'muted', min: 4.5 },
	{ fg: 'primaryForeground', bg: 'primary', min: 4.5 },
	{ fg: 'secondaryForeground', bg: 'secondary', min: 4.5 },
	{ fg: 'accentForeground', bg: 'accent', min: 4.5 },
	{ fg: 'destructiveForeground', bg: 'destructive', min: 4.5 },
	{ fg: 'brandForeground', bg: 'brand', min: 4.5 },
	{ fg: 'navActiveForeground', bg: 'navActive', min: 4.5 },
	{ fg: 'foreground', bg: 'muted', min: 4.5 },
	// non-text 3 (WCAG 1.4.11)
	{ fg: 'input', bg: 'background', min: 3 },
	{ fg: 'input', bg: 'card', min: 3 },
	{ fg: 'ring', bg: 'background', min: 3 },
	{ fg: 'ring', bg: 'card', min: 3 },
	{ fg: 'brand', bg: 'background', min: 3 },
	{ fg: 'primary', bg: 'background', min: 3 },
];

export interface ContrastCheckResult {
	readonly pair: string;
	readonly mode: 'light' | 'dark';
	readonly ratio: number;
	readonly min: number;
	readonly pass: boolean;
}

/**
 * Evaluates every contrast pair across both light and dark modes for a palette preset.
 * Ratios are rounded to 2 decimal places.
 */
export function checkPaletteContrast(preset: PalettePreset): ContrastCheckResult[] {
	const results: ContrastCheckResult[] = [];
	const modes: readonly ('light' | 'dark')[] = ['light', 'dark'];

	for (const mode of modes) {
		const tokens = preset[mode];
		for (const { fg, bg, min } of paletteContrastPairs) {
			const rawRatio = contrastRatio(tokens[fg], tokens[bg]);
			const ratio = Math.round(rawRatio * 100) / 100;
			results.push({
				pair: `${fg}/${bg}`,
				mode,
				ratio,
				min,
				pass: ratio >= min,
			});
		}
	}

	return results;
}
