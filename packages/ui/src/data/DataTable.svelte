<!--
@component
DataTable<T> — a thin, headless-driven table with WCAG 2.2 AA grid semantics
(ADR-0011, ADR-0024). Consumes the pure `computeRows` model; this component only
renders + wires ARIA. It does NOT pull in `@tanstack/svelte-virtual` — for large
datasets wrap rows in `VirtualList.svelte` (optional peer). Sortable headers
expose `aria-sort`; the grid carries `aria-rowcount` / `aria-colcount` reflecting
the FULL filtered dataset (not just the rendered page), per ADR-0024.

Plain `tsc` does not type-check `.svelte`; the typed, tested logic lives in
`./model.ts` and `./virtual.ts`.
-->
<script lang="ts" generics="TRow">
  import { untrack } from 'svelte';
  import {
    computeRows,
    toggleSort,
    initialTableState,
    type ColumnDef,
    type RowKey,
    type TableState,
  } from './model.js';

  interface Props<T> {
    /** Source rows (full dataset). */
    rows: readonly T[];
    /** Column definitions. */
    columns: readonly ColumnDef<T>[];
    /** Accessible name for the grid. */
    label: string;
    /** Initial view state (sort / filter / page). */
    initialState?: Partial<TableState>;
    /** Stable key for each row (defaults to the array index). */
    rowKey?: RowKey<T>;
  }

  const { rows, columns, label, initialState, rowKey }: Props<TRow> = $props();

  let state = $state<TableState>(
    untrack(() => ({ ...initialTableState, ...initialState })),
  );
  const view = $derived(computeRows(rows, columns, state));

  function cellText(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'object') return JSON.stringify(value) ?? '';
    return String(value);
  }

  function ariaSort(columnId: string): 'ascending' | 'descending' | 'none' {
    if (!state.sort || state.sort.columnId !== columnId) return 'none';
    return state.sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  function onHeaderActivate(column: ColumnDef<TRow>): void {
    if (column.sortable === false) return;
    state = toggleSort(state, column.id);
  }

  function onHeaderKey(event: KeyboardEvent, column: ColumnDef<TRow>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onHeaderActivate(column);
    }
  }

  function keyFor(row: TRow, index: number): string | number {
    return rowKey ? rowKey(row, index) : index;
  }
</script>

<div
  class="ssentio-datatable"
  role="grid"
  aria-label={label}
  aria-rowcount={view.filteredCount + 1}
  aria-colcount={columns.length}
>
  <div class="ssentio-datatable__row ssentio-datatable__row--head" role="row" aria-rowindex={1}>
    {#each columns as column, colIndex (column.id)}
      {#if column.sortable === false}
        <span class="ssentio-datatable__cell ssentio-datatable__cell--head" role="columnheader" aria-colindex={colIndex + 1}>
          {column.header}
        </span>
      {:else}
        <span
          class="ssentio-datatable__cell ssentio-datatable__cell--head"
          role="columnheader"
          aria-colindex={colIndex + 1}
          aria-sort={ariaSort(column.id)}
          tabindex="0"
          onclick={() => onHeaderActivate(column)}
          onkeydown={(event) => onHeaderKey(event, column)}
        >
          {column.header}
        </span>
      {/if}
    {/each}
  </div>

  {#each view.rows as row, rowIndex (keyFor(row, rowIndex))}
    <div class="ssentio-datatable__row" role="row" aria-rowindex={rowIndex + 2}>
      {#each columns as column, colIndex (column.id)}
        <span class="ssentio-datatable__cell" role="gridcell" aria-colindex={colIndex + 1}>
          {cellText(column.accessor(row))}
        </span>
      {/each}
    </div>
  {/each}
</div>

<style>
  .ssentio-datatable {
    display: grid;
    inline-size: 100%;
  }

  .ssentio-datatable__row {
    display: grid;
    grid-template-columns: var(--ssentio-datatable-columns, 1fr);
    grid-auto-flow: column;
  }

  .ssentio-datatable__cell {
    padding: var(--ui-control-height, 0.5rem) 0.75rem;
    min-block-size: var(--ui-min-target-size, 24px);
  }

  .ssentio-datatable__cell--head {
    font-weight: 600;
    cursor: default;
  }

  .ssentio-datatable__cell--head[tabindex='0'] {
    cursor: pointer;
  }

  .ssentio-datatable__cell--head:focus-visible {
    outline: 2px solid var(--ui-ring, currentColor);
    outline-offset: -2px;
  }
</style>
