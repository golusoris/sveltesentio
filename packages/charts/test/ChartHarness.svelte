<!--
Test-only harness for <Chart> and <ChartFigure>: supplies a deterministic `chart`
snippet (a marker div in place of a custom LayerChart composition) so the test
can assert the envelope wires the visual + SR table without depending on
LayerChart's render output.
-->
<script lang="ts">
	import Chart from '../src/Chart.svelte';
	import ChartFigure from '../src/ChartFigure.svelte';
	import type { ChartHarnessProps } from './fixture-types.js';

	const {
		as = 'figure',
		title,
		description,
		series,
		accessors,
		tableOptions,
		showDataTable,
		idBase,
	}: ChartHarnessProps = $props();
</script>

{#if as === 'chart'}
	<Chart {title} {description} {series} {accessors} {tableOptions} {showDataTable} {idBase}>
		{#snippet chart()}
			<div data-testid="custom-viz">custom composition</div>
		{/snippet}
	</Chart>
{:else}
	<ChartFigure {title} {description} {series} {accessors} {tableOptions} {showDataTable} {idBase}>
		{#snippet chart()}
			<div data-testid="viz-content">rendered visual</div>
		{/snippet}
	</ChartFigure>
{/if}
