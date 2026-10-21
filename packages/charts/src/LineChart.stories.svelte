<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import LineChart from './LineChart.svelte';
	import {
		dayAccessors as accessors,
		sampleWeekdaySeries as series,
		singleWeekdaySeries as single,
		type DayPoint,
	} from './stories-data.js';

	const { Story } = defineMeta<unknown, typeof LineChart<DayPoint>>({
		title: 'charts/LineChart',
		component: LineChart,
		tags: ['autodocs'],
		args: {
			title: 'Daily sessions',
			series,
			accessors,
		},
	});
</script>

<!-- Two series, each colored from the semantic oklch palette; the visually
     hidden SR table is generated from the same series + accessors. -->
<Story name="Multi series" args={{ title: 'Daily sessions vs errors', series, accessors }} />

<!-- A single series with a one-sentence aria-describedby summary. -->
<Story
	name="With description"
	args={{
		title: 'Daily sessions',
		description: 'Authenticated sessions per weekday.',
		series: single,
		accessors,
	}}
/>

<!-- Swap the value axis to the x-axis. -->
<Story
	name="Vertical orientation"
	args={{ title: 'Daily sessions', series: single, accessors, orientation: 'vertical' }}
/>
