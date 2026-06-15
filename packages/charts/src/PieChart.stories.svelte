<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import PieChart from './PieChart.svelte';

	// One flat datum per slice; `key` labels the slice, `value` sizes it.
	interface Slice {
		name: string;
		count: number;
	}

	const data: Slice[] = [
		{ name: 'Chrome', count: 62 },
		{ name: 'Firefox', count: 18 },
		{ name: 'Safari', count: 12 },
		{ name: 'Edge', count: 8 },
	];

	const key = (d: Slice): string => d.name;
	const value = (d: Slice): number => d.count;

	const { Story } = defineMeta({
		title: 'charts/PieChart',
		component: PieChart,
		tags: ['autodocs'],
		args: {
			title: 'Browser share',
			data,
			key,
			value,
		},
	});
</script>

<!-- Slices colored from the semantic oklch palette; one SR row per slice. -->
<Story name="Default" args={{ title: 'Browser share', data, key, value }} />

<!-- A custom value-column label + describing summary. -->
<Story
	name="Custom value label"
	args={{
		title: 'Browser share',
		description: 'Share of sessions by browser, last 30 days.',
		data,
		key,
		value,
		valueLabel: 'Share %',
	}}
/>
