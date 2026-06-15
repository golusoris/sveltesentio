<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import VirtualList from './VirtualList.svelte';

  interface Item {
    readonly id: number;
    readonly label: string;
  }

  function makeItems(count: number): readonly Item[] {
    return Array.from({ length: count }, (_, i) => ({ id: i, label: `Row ${i + 1}` }));
  }

  const { Story } = defineMeta({
    title: 'ui/data/VirtualList',
    component: VirtualList as unknown as typeof VirtualList<Item>,
    tags: ['autodocs'],
    argTypes: {
      rowHeight: { control: { type: 'number', min: 16, max: 96, step: 4 } },
      overscan: { control: { type: 'number', min: 0, max: 12, step: 1 } },
    },
    args: {
      rowHeight: 36,
      label: 'Virtualized rows',
    },
  });

  const items10k = makeItems(10_000);
  const items100 = makeItems(100);
</script>

{#snippet row(item: Item, index: number)}
  <span style:padding="0 0.75rem">#{index + 1} — {item.label}</span>
{/snippet}

<!--
	The component renders only the visible window. A fixed-height wrapper gives the
	grid a viewport so virtualization (and roving focus via Home/End/PageUp/Down)
	is observable. `row` is the required Snippet<[T, number]> prop.
-->
<Story exportName="ManyRows" name="10k rows">
  <div style:height="320px" style:width="360px" style:border="1px solid currentColor">
    <VirtualList items={items10k} rowHeight={36} label="Virtualized 10k rows" {row} />
  </div>
</Story>

<Story name="Taller rows">
  <div style:height="320px" style:width="360px" style:border="1px solid currentColor">
    <VirtualList items={items100} rowHeight={64} label="Virtualized rows (tall)" {row} />
  </div>
</Story>
