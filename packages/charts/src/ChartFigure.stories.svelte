<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ChartFigure from './ChartFigure.svelte';
	import {
		dayAccessors as accessors,
		sampleWeekdaySeries as series,
		type DayPoint,
	} from './stories-data.js';

	const { Story } = defineMeta({
		title: 'charts/ChartFigure',
		component: ChartFigure as unknown as typeof ChartFigure<DayPoint>,
		tags: ['autodocs'],
	});
</script>

<!--
The mandatory a11y envelope (ADR-0013). `chart` is a required `Snippet` prop —
the library-agnostic slot any charting visual renders into — so each Story body
wires it directly with a placeholder. The visually-hidden SR `<table>` is built
from the same `series` + `accessors`, keeping the text alternative in sync with
whatever visual the caller draws.
-->
<Story name="Default" asChild>
	<ChartFigure title="Daily sessions" {series} {accessors}>
		{#snippet chart()}
			<div
				style="display:flex;align-items:center;justify-content:center;height:180px;border:1px dashed currentColor;border-radius:0.5rem;opacity:0.7;"
			>
				Visual (LayerChart / uPlot / anything) renders here
			</div>
		{/snippet}
	</ChartFigure>
</Story>

<!-- A description promotes aria-describedby on the chart region. -->
<Story name="With description" asChild>
	<ChartFigure
		title="Daily sessions"
		description="Authenticated sessions and errors per weekday."
		{series}
		{accessors}
	>
		{#snippet chart()}
			<div
				style="display:flex;align-items:center;justify-content:center;height:180px;border:1px dashed currentColor;border-radius:0.5rem;opacity:0.7;"
			>
				Visual renders here
			</div>
		{/snippet}
	</ChartFigure>
</Story>

<!-- Suppress the SR table when an equivalent visible table already exists. -->
<Story name="No data table" asChild>
	<ChartFigure title="Daily sessions" {series} {accessors} showDataTable={false}>
		{#snippet chart()}
			<div
				style="display:flex;align-items:center;justify-content:center;height:180px;border:1px dashed currentColor;border-radius:0.5rem;opacity:0.7;"
			>
				Visual renders here
			</div>
		{/snippet}
	</ChartFigure>
</Story>
