<!--
Test-only harness: renders whichever cartesian wrapper (`line` / `area` /
`bar` / `scatter`) the `kind` prop selects, forwarding the typed series +
accessors. Lets one test file exercise all four wrappers through one DOM
contract (they share the <ChartFigure> envelope).
-->
<script lang="ts">
	import LineChart from '../src/LineChart.svelte';
	import AreaChart from '../src/AreaChart.svelte';
	import BarChart from '../src/BarChart.svelte';
	import ScatterChart from '../src/ScatterChart.svelte';
	import type { CartesianSeries } from '../src/chart-series.js';
	import type { ChartAccessors, BuildTableOptions } from '../src/a11y-table.js';
	import type { Point } from './fixture-types.js';

	interface Props {
		kind: 'line' | 'area' | 'bar' | 'scatter';
		title: string;
		description?: string | undefined;
		series: readonly CartesianSeries<Point>[];
		accessors: ChartAccessors<Point>;
		tableOptions?: BuildTableOptions<Point> | undefined;
		showDataTable?: boolean | undefined;
		idBase?: string | undefined;
	}

	const {
		kind,
		title,
		description,
		series,
		accessors,
		tableOptions,
		showDataTable,
		idBase,
	}: Props = $props();
</script>

{#if kind === 'line'}
	<LineChart {title} {description} {series} {accessors} {tableOptions} {showDataTable} {idBase} />
{:else if kind === 'area'}
	<AreaChart {title} {description} {series} {accessors} {tableOptions} {showDataTable} {idBase} />
{:else if kind === 'bar'}
	<BarChart {title} {description} {series} {accessors} {tableOptions} {showDataTable} {idBase} />
{:else}
	<ScatterChart
		{title}
		{description}
		{series}
		{accessors}
		{tableOptions}
		{showDataTable}
		{idBase}
	/>
{/if}
