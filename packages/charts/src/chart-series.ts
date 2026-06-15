// Pure bridge between the typed wrapper props and (a) LayerChart's `series`
// prop and (b) <ChartFigure>'s screen-reader data-table model (ADR-0013). The
// semantic chart wrappers feed the *same* {data, series, x, y} into the visual
// (LayerChart) and the SR table (buildDataTableModel) so the two cannot drift.
// No Svelte, no DOM — unit-testable in plain Node.

import type { ChartSeries, ChartAccessors } from './a11y-table.js';
import { chartSeriesColor } from './palette.js';

/**
 * A cartesian series definition for the Line / Area / Bar / Scatter wrappers.
 * `data` is per-series; the shared `x` / `y` accessors live on the chart props.
 */
export interface CartesianSeries<TDatum> {
	/** Stable key — column header + LayerChart series key. */
	key: string;
	/** Human label for the SR-table column header; falls back to {@link key}. */
	label?: string;
	/** This series' ordered data points. */
	data: readonly TDatum[];
	/** Explicit color; defaults to the semantic palette slot for its index. */
	color?: string;
}

/** Maps a categorical datum to its slice key / category cell. */
export type KeyAccessor<TDatum> = (datum: TDatum) => string | number;

/** Maps a categorical datum to its slice magnitude (nullish renders as a gap). */
export type ValueAccessor<TDatum> = (datum: TDatum) => number | null | undefined;

/** The shape LayerChart's simplified charts accept on their `series` prop. */
export interface LayerSeries<TDatum> {
	key: string;
	label?: string;
	color: string;
	data?: TDatum[];
}

/**
 * Assign a deterministic palette color to every series that does not declare
 * one, preserving any explicit `color`. Index order drives the palette slot.
 */
export function resolveSeriesColors<TDatum>(
	series: readonly CartesianSeries<TDatum>[],
): LayerSeries<TDatum>[] {
	return series.map((s, i) => ({
		key: s.key,
		...(s.label !== undefined ? { label: s.label } : {}),
		color: s.color ?? chartSeriesColor(i),
		data: [...s.data],
	}));
}

/**
 * Build the {@link ChartSeries} array <ChartFigure> needs for its SR table from
 * the cartesian wrapper's per-series data. The wrapper passes the shared
 * `x` / `y` accessors through to {@link ChartAccessors} unchanged.
 */
export function toFigureSeries<TDatum>(
	series: readonly CartesianSeries<TDatum>[],
): ChartSeries<TDatum>[] {
	return series.map((s) => ({
		key: s.key,
		...(s.label !== undefined ? { label: s.label } : {}),
		data: s.data,
	}));
}

/**
 * Collapse a flat categorical dataset (the Pie wrapper's `{key, value}` rows)
 * into the single-series {@link ChartSeries} + {@link ChartAccessors} the SR
 * table expects: each datum is one row, keyed by its category, valued by its
 * slice magnitude.
 */
export function categoricalToFigure<TDatum>(
	data: readonly TDatum[],
	key: KeyAccessor<TDatum>,
	value: ValueAccessor<TDatum>,
	seriesLabel: string,
): { series: ChartSeries<TDatum>[]; accessors: ChartAccessors<TDatum> } {
	return {
		series: [{ key: 'value', label: seriesLabel, data }],
		accessors: { x: key, y: value },
	};
}
