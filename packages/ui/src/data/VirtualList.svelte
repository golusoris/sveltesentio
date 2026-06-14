<!--
@component
VirtualList — fixed-height row virtualization with WCAG 2.2 AA grid semantics
(ADR-0024). Renders only the visible window (via the pure `computeVirtualWindow`
helper) inside a `totalSize`-tall spacer so the native scrollbar stays accurate.
`role="grid"` + `aria-rowcount` (full dataset) + per-row 1-based `aria-rowindex`
are auto-wired; Home/End/PageUp/PageDown/Arrow roving focus via `nextFocusIndex`.

This implementation is self-contained (no `@tanstack/svelte-virtual` import) so
it works without the optional peer; swap the window math for `useVirtualizer`
when variable row heights are needed. Pure logic + ARIA math live in
`./virtual.ts` and are unit-tested there.
-->
<script lang="ts" generics="TItem">
  import type { Snippet } from 'svelte';
  import { computeVirtualWindow, nextFocusIndex, offsetForIndex } from './virtual.js';

  interface Props<T> {
    /** Full dataset. */
    items: readonly T[];
    /** Fixed row height in CSS px. */
    rowHeight: number;
    /** Accessible name for the grid. */
    label: string;
    /** Extra rows rendered above/below the viewport. Default 3. */
    overscan?: number;
    /** Renders one row; receives the item and its absolute index. */
    row: Snippet<[T, number]>;
  }

  const { items, rowHeight, label, overscan = 3, row }: Props<TItem> = $props();

  let scrollTop = $state(0);
  let viewportHeight = $state(0);
  let focusIndex = $state(0);
  let viewport = $state<HTMLDivElement | null>(null);

  const win = $derived(
    computeVirtualWindow({
      rowCount: items.length,
      rowHeight,
      viewportHeight,
      scrollTop,
      overscan,
    }),
  );

  function onScroll(event: Event): void {
    scrollTop = (event.currentTarget as HTMLDivElement).scrollTop;
  }

  function onKeydown(event: KeyboardEvent): void {
    const pageRows = Math.max(1, Math.floor(viewportHeight / rowHeight));
    const next = nextFocusIndex(focusIndex, event.key, items.length, pageRows);
    if (next === null) return;
    event.preventDefault();
    focusIndex = next;
    if (viewport) viewport.scrollTop = offsetForIndex(next, rowHeight);
  }
</script>

<div
  bind:this={viewport}
  bind:clientHeight={viewportHeight}
  class="ssentio-virtuallist"
  role="grid"
  aria-label={label}
  aria-rowcount={items.length}
  tabindex="0"
  onscroll={onScroll}
  onkeydown={onKeydown}
>
  <div class="ssentio-virtuallist__spacer" style:height={`${win.totalSize}px`}>
    {#each win.items as item (item.index)}
      {@const datum = items[item.index]}
      {#if datum !== undefined}
        <div
          class="ssentio-virtuallist__row"
          role="row"
          aria-rowindex={item.index + 1}
          aria-selected={item.index === focusIndex}
          style:transform={`translateY(${item.start}px)`}
          style:height={`${item.size}px`}
        >
          {@render row(datum, item.index)}
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .ssentio-virtuallist {
    position: relative;
    overflow-y: auto;
    block-size: 100%;
    inline-size: 100%;
  }

  .ssentio-virtuallist:focus-visible {
    outline: 2px solid var(--ui-ring, currentColor);
    outline-offset: -2px;
  }

  .ssentio-virtuallist__spacer {
    position: relative;
    inline-size: 100%;
  }

  .ssentio-virtuallist__row {
    position: absolute;
    inset-inline: 0;
    top: 0;
    display: flex;
    align-items: center;
  }
</style>
