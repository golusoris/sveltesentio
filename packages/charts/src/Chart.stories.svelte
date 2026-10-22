<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Chart from './Chart.svelte';
	import {
		dayAccessors as accessors,
		singleWeekdaySeries as series,
		type DayPoint,
	} from './stories-data.js';

	const { Story } = defineMeta({
		title: 'charts/Chart',
		component: Chart as unknown as typeof Chart<DayPoint>,
		tags: ['autodocs'],
	});
</script>

<!--
Low-level escape hatch: the caller renders LayerChart marks into the required
`chart` snippet (a `Snippet` prop, so the Story body wires it directly). To keep
the story decoupled from LayerChart's volatile v2-next primitive API, the visual
is a placeholder standing in for a bespoke composition; the story's value is
showing the mandatory a11y envelope (figure + role="img" + SR data table) the
wrapper adds around whatever the caller draws.
-->
<Story name="Custom visual" asChild>
	<Chart title="Custom composition" {series} {accessors}>
		{#snippet chart()}
			<div
				style="display:flex;align-items:center;justify-content:center;height:180px;border:1px dashed currentColor;border-radius:0.5rem;opacity:0.7;"
			>
				Caller-composed LayerChart marks render here
			</div>
		{/snippet}
	</Chart>
</Story>

<!-- Same envelope with an aria-describedby summary; SR table still emitted. -->
<Story name="With description" asChild>
	<Chart
		title="Custom composition"
		description="A bespoke layered chart with the standard a11y envelope."
		{series}
		{accessors}
	>
		{#snippet chart()}
			<div
				style="display:flex;align-items:center;justify-content:center;height:180px;border:1px dashed currentColor;border-radius:0.5rem;opacity:0.7;"
			>
				Caller-composed LayerChart marks render here
			</div>
		{/snippet}
	</Chart>
</Story>
