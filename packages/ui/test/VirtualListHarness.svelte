<!--
Test-only harness: `VirtualList` requires a `row` snippet (it has no default
slot), which cannot be supplied from plain `.ts`. This wrapper forwards every
prop and renders a deterministic row whose text the windowing tests assert
against (`Row <n>: <label>`), plus a `data-index` marker for ordering checks.
-->
<script lang="ts">
	import VirtualList from '../src/data/VirtualList.svelte';

	interface Item {
		id: number;
		label: string;
	}

	interface Props {
		items: readonly Item[];
		rowHeight: number;
		label: string;
		overscan?: number;
	}

	const { items, rowHeight, label, overscan }: Props = $props();
</script>

<VirtualList {items} {rowHeight} {label} {overscan}>
	{#snippet row(item: Item, index: number)}
		<!-- role="gridcell" so the parent role="grid"/"row" structure is complete
		     for axe (aria-required-children); the cell is the snippet's job. -->
		<span role="gridcell" data-testid="vrow" data-index={index}>Row {index}: {item.label}</span>
	{/snippet}
</VirtualList>
