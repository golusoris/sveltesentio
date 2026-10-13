<!--
Test-only harness for the low-level <Chart>: supplies a deterministic `chart`
snippet (a marker div in place of a custom LayerChart composition) so the test
can assert the envelope wires the visual + SR table without depending on
LayerChart's render output.
-->
<script lang="ts">
	import Chart from '../src/Chart.svelte';
	import type { ChartSeries, ChartAccessors, BuildTableOptions } from '../src/a11y-table.js';
	import type { Point } from './fixture-types.js';

	interface Props {
		title: string;
		description?: string | undefined;
		series: readonly ChartSeries<Point>[];
		accessors: ChartAccessors<Point>;
		tableOptions?: BuildTableOptions<Point> | undefined;
		showDataTable?: boolean | undefined;
		idBase?: string | undefined;
	}

	const { title, description, series, accessors, tableOptions, showDataTable, idBase }: Props =
		$props();
</script>

<Chart {title} {description} {series} {accessors} {tableOptions} {showDataTable} {idBase}>
	{#snippet chart()}
		<div data-testid="custom-viz">custom composition</div>
	{/snippet}
</Chart>
