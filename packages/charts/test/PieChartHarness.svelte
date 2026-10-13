<!--
Test-only harness for PieChart: forwards the flat categorical data plus its
key / value accessors (the Pie wrapper's distinct prop shape).
-->
<script lang="ts">
	import PieChart from '../src/PieChart.svelte';
	import type { BuildTableOptions } from '../src/a11y-table.js';
	import type { Slice } from './fixture-types.js';

	interface Props {
		title: string;
		description?: string | undefined;
		data: readonly Slice[];
		key: (datum: Slice) => string | number;
		value: (datum: Slice) => number | null | undefined;
		valueLabel?: string | undefined;
		tableOptions?: BuildTableOptions<Slice> | undefined;
		showDataTable?: boolean | undefined;
		idBase?: string | undefined;
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
	}: Props = $props();
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
