<!--
Test-only harness for the low-level <Chart>: supplies a deterministic `chart`
snippet (a marker div in place of a custom LayerChart composition) so the test
can assert the envelope wires the visual + SR table without depending on
LayerChart's render output.
-->
<script lang="ts" generics="TDatum">
	import Chart from '../src/Chart.svelte';
	import type { ChartSeries, ChartAccessors, BuildTableOptions } from '../src/a11y-table.js';

	interface Props<T> {
		title: string;
		description?: string;
		series: readonly ChartSeries<T>[];
		accessors: ChartAccessors<T>;
		tableOptions?: BuildTableOptions<T>;
		showDataTable?: boolean;
		idBase?: string;
	}

	const {
		title,
		description,
		series,
		accessors,
		tableOptions,
		showDataTable,
		idBase,
	}: Props<TDatum> = $props();
</script>

<Chart {title} {description} {series} {accessors} {tableOptions} {showDataTable} {idBase}>
	{#snippet chart()}
		<div data-testid="custom-viz">custom composition</div>
	{/snippet}
</Chart>
