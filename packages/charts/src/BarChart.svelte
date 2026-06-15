<!--
@component
BarChart — semantic bar chart over LayerChart's simplified `BarChart`, wrapped
in <ChartFigure> for the WCAG a11y envelope (ADR-0013). Typed `data` + `series`
with the semantic oklch palette; supports grouped / stacked layouts; motion
collapses under `prefers-reduced-motion`. The SR data table is generated from
the same `series` + `x`/`y` accessors that drive the visual.
-->
<script lang="ts" generics="TDatum">
	import { BarChart as LcBarChart } from 'layerchart';
	import ChartFigure from './ChartFigure.svelte';
	import {
		resolveSeriesColors,
		toFigureSeries,
		type CartesianSeries,
	} from './chart-series.js';
	import type { ChartAccessors, BuildTableOptions } from './a11y-table.js';
	import { dashboardPreset, prefersReducedMotion } from './preset.js';

	interface Props<T> {
		/** Accessible name for the figure — required (no anonymous charts). */
		title: string;
		/** Optional one-sentence summary, exposed via `aria-describedby`. */
		description?: string;
		/** One or more series; each gets a palette color unless it sets `color`. */
		series: readonly CartesianSeries<T>[];
		/** x / y accessors, shared across series (visual + SR table). */
		accessors: ChartAccessors<T>;
		/** Which axis is the value axis. @default 'vertical' */
		orientation?: 'horizontal' | 'vertical';
		/** How multiple series lay out. @default 'overlap' */
		seriesLayout?: 'overlap' | 'stack' | 'stackExpand' | 'stackDiverging' | 'group';
		/** SR-table formatting / labelling options. */
		tableOptions?: BuildTableOptions<T>;
		/** Whether to render the visually-hidden SR data table. @default true */
		showDataTable?: boolean;
		/** Stable id prefix for aria wiring; auto-derived from the title if omitted. */
		idBase?: string;
	}

	const {
		title,
		description,
		series,
		accessors,
		orientation = 'vertical',
		seriesLayout = 'overlap',
		tableOptions,
		showDataTable,
		idBase,
	}: Props<TDatum> = $props();

	const lcSeries = $derived(resolveSeriesColors(series));
	const figureSeries = $derived(toFigureSeries(series));
	const preset = $derived(dashboardPreset({ reducedMotion: prefersReducedMotion() }));
</script>

<ChartFigure
	{title}
	{description}
	series={figureSeries}
	{accessors}
	{tableOptions}
	{showDataTable}
	{idBase}
>
	{#snippet chart()}
		<LcBarChart
			x={accessors.x}
			y={accessors.y}
			series={lcSeries}
			{orientation}
			{seriesLayout}
			padding={preset.padding}
		/>
	{/snippet}
</ChartFigure>
