<!--
@component
PieChart — semantic pie / donut chart over LayerChart's simplified `PieChart`,
wrapped in <ChartFigure> for the WCAG a11y envelope (ADR-0013). Unlike the
cartesian wrappers it takes a single flat `data` array with `key` / `value`
accessors; slices are colored from the semantic oklch palette. The SR data
table lists one row per slice (category + value) from the same accessors that
drive the visual, so the two cannot drift.
-->
<script lang="ts" generics="TDatum">
	import { PieChart as LcPieChart } from 'layerchart';
	import ChartFigure from './ChartFigure.svelte';
	import {
		categoricalToFigure,
		type KeyAccessor,
		type ValueAccessor,
	} from './chart-series.js';
	import { chartPalette } from './palette.js';
	import type { BuildTableOptions } from './a11y-table.js';

	interface Props<T> {
		/** Accessible name for the figure — required (no anonymous charts). */
		title: string;
		/** Optional one-sentence summary, exposed via `aria-describedby`. */
		description?: string;
		/** Flat slice data; one datum per slice. */
		data: readonly T[];
		/** Category accessor (slice label / SR-table row head). */
		key: KeyAccessor<T>;
		/** Magnitude accessor (slice size / SR-table value cell). */
		value: ValueAccessor<T>;
		/** Column header for the value series in the SR table. @default 'Value' */
		valueLabel?: string;
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
		data,
		key,
		value,
		valueLabel = 'Value',
		tableOptions,
		showDataTable,
		idBase,
	}: Props<TDatum> = $props();

	const figure = $derived(categoricalToFigure(data, key, value, valueLabel));
</script>

<ChartFigure
	{title}
	{description}
	series={figure.series}
	accessors={figure.accessors}
	{tableOptions}
	{showDataTable}
	{idBase}
>
	{#snippet chart()}
		<LcPieChart data={[...data]} {key} {value} cRange={chartPalette} />
	{/snippet}
</ChartFigure>
