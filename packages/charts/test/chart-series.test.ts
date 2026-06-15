import { describe, expect, it } from 'vitest';
import {
	resolveSeriesColors,
	toFigureSeries,
	categoricalToFigure,
	type CartesianSeries,
} from '../src/chart-series.js';
import { chartSeriesColor } from '../src/palette.js';

interface Point {
	t: string;
	v: number | null;
}

const series: CartesianSeries<Point>[] = [
	{ key: 'a', label: 'A', data: [{ t: 'Mon', v: 1 }] },
	{ key: 'b', data: [{ t: 'Mon', v: 2 }] },
];

describe('resolveSeriesColors', () => {
	it('assigns palette colors by index when none is provided', () => {
		const out = resolveSeriesColors(series);
		expect(out[0]?.color).toBe(chartSeriesColor(0));
		expect(out[1]?.color).toBe(chartSeriesColor(1));
	});

	it('preserves an explicit color', () => {
		const out = resolveSeriesColors([
			{ key: 'x', data: [], color: 'tomato' },
		]);
		expect(out[0]?.color).toBe('tomato');
	});

	it('carries key + label through and copies data into a mutable array', () => {
		const out = resolveSeriesColors(series);
		expect(out[0]).toMatchObject({ key: 'a', label: 'A' });
		expect(out[1]?.label).toBeUndefined();
		expect(Array.isArray(out[0]?.data)).toBe(true);
		expect(out[0]?.data).toEqual([{ t: 'Mon', v: 1 }]);
		// Must be a copy, not the (readonly) source reference.
		expect(out[0]?.data).not.toBe(series[0]?.data);
	});

	it('returns an empty array for empty input', () => {
		expect(resolveSeriesColors([])).toEqual([]);
	});
});

describe('toFigureSeries', () => {
	it('projects to {key, label, data} for the SR table, dropping color', () => {
		const out = toFigureSeries([
			{ key: 'a', label: 'A', data: [{ t: 'Mon', v: 1 }], color: 'red' },
		]);
		expect(out).toEqual([{ key: 'a', label: 'A', data: [{ t: 'Mon', v: 1 }] }]);
		expect(out[0]).not.toHaveProperty('color');
	});
});

describe('categoricalToFigure', () => {
	interface Slice {
		name: string;
		count: number;
	}

	const data: Slice[] = [
		{ name: 'Chrome', count: 60 },
		{ name: 'Firefox', count: 30 },
	];

	it('wraps the flat data into a single labelled SR series', () => {
		const { series: figSeries } = categoricalToFigure(
			data,
			(d) => d.name,
			(d) => d.count,
			'Share',
		);
		expect(figSeries).toHaveLength(1);
		expect(figSeries[0]).toMatchObject({ key: 'value', label: 'Share' });
		expect(figSeries[0]?.data).toBe(data);
	});

	it('exposes the key / value accessors as the SR x / y accessors', () => {
		const { accessors } = categoricalToFigure(
			data,
			(d) => d.name,
			(d) => d.count,
			'Share',
		);
		expect(accessors.x(data[0]!)).toBe('Chrome');
		expect(accessors.y(data[1]!)).toBe(30);
	});
});
