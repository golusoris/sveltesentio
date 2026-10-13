<!--
Test-only harness: ChartFigure requires a `chart` snippet (its escape hatch for
the visual), which cannot be constructed in plain `.ts`. This wrapper forwards
every prop through and supplies a deterministic `chart` snippet whose marker
content (`data-testid="viz-content"`) the tests assert against.
-->
<script lang="ts">
	import ChartFigure from '../src/ChartFigure.svelte';
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

<ChartFigure {title} {description} {series} {accessors} {tableOptions} {showDataTable} {idBase}>
	{#snippet chart()}
		<div data-testid="viz-content">rendered visual</div>
	{/snippet}
</ChartFigure>
