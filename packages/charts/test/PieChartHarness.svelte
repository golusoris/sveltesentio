<!--
Test-only harness for PieChart: forwards the flat categorical data plus its
key / value accessors (the Pie wrapper's distinct prop shape).
-->
<script lang="ts" generics="TDatum">
	import PieChart from '../src/PieChart.svelte';
	import type { BuildTableOptions } from '../src/a11y-table.js';

	interface Props<T> {
		title: string;
		description?: string;
		data: readonly T[];
		key: (datum: T) => string | number;
		value: (datum: T) => number | null | undefined;
		valueLabel?: string;
		tableOptions?: BuildTableOptions<T>;
		showDataTable?: boolean;
		idBase?: string;
	}

	const {
		title,
		description,
		data,
		key,
		value,
		valueLabel,
		tableOptions,
		showDataTable,
		idBase,
	}: Props<TDatum> = $props();
</script>

<PieChart
	{title}
	{description}
	{data}
	{key}
	{value}
	{valueLabel}
	{tableOptions}
	{showDataTable}
	{idBase}
/>
