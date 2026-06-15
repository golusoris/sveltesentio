import { describe, expect, it } from 'vitest';
import {
	chartPalette,
	chartSeriesColor,
	CHART_PALETTE_SIZE,
} from '../src/palette.js';

describe('chartPalette', () => {
	it('has CHART_PALETTE_SIZE entries', () => {
		expect(chartPalette).toHaveLength(CHART_PALETTE_SIZE);
		expect(CHART_PALETTE_SIZE).toBeGreaterThan(0);
	});

	it('maps each slot to its 1-based --color-chart-N variable with an oklch fallback', () => {
		chartPalette.forEach((color, i) => {
			expect(color).toMatch(
				new RegExp(`^var\\(--color-chart-${i + 1}, oklch\\([^)]+\\)\\)$`),
			);
		});
	});

	it('uses distinct fallback hues per slot', () => {
		expect(new Set(chartPalette).size).toBe(chartPalette.length);
	});
});

describe('chartSeriesColor', () => {
	it('returns the matching palette slot for an in-range index', () => {
		expect(chartSeriesColor(0)).toBe(chartPalette[0]);
		expect(chartSeriesColor(2)).toBe(chartPalette[2]);
	});

	it('wraps around the palette for out-of-range indices', () => {
		expect(chartSeriesColor(CHART_PALETTE_SIZE)).toBe(chartPalette[0]);
		expect(chartSeriesColor(CHART_PALETTE_SIZE + 1)).toBe(chartPalette[1]);
	});

	it('floors fractional indices before lookup', () => {
		expect(chartSeriesColor(1.9)).toBe(chartPalette[1]);
	});

	it('falls back to the first slot for negative or non-finite indices', () => {
		expect(chartSeriesColor(-1)).toBe(chartPalette[0]);
		expect(chartSeriesColor(Number.NaN)).toBe(chartPalette[0]);
		expect(chartSeriesColor(Number.POSITIVE_INFINITY)).toBe(chartPalette[0]);
	});
});
