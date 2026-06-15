<!--
Test-only harness: ChartFigure requires a `chart` snippet (its escape hatch for
the visual), which cannot be constructed in plain `.ts`. This wrapper forwards
every prop through and supplies a deterministic `chart` snippet whose marker
content (`data-testid="viz-content"`) the tests assert against.
-->
<script lang="ts" generics="TDatum">
	import ChartFigure from '../src/ChartFigure.svelte';
	import type {
		ChartSeries,
		ChartAccessors,
		BuildTableOptions,
	} from '../src/a11y-table.js';

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

<ChartFigure
	{title}
	{description}
	{series}
	{accessors}
	{tableOptions}
	{showDataTable}
	{idBase}
>
	{#snippet chart()}
		<div data-testid="viz-content">rendered visual</div>
	{/snippet}
</ChartFigure>
