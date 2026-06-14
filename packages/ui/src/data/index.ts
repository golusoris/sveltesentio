/**
 * `@sveltesentio/ui/data` — headless `DataTable<T>` model + virtualization
 * window math (ADR-0011, ADR-0024). The pure logic exported here is framework-
 * agnostic and unit-tested; the `.svelte` components (`DataTable.svelte`,
 * `VirtualList.svelte`) are thin consumers that wire WCAG 2.2 AA grid roles and
 * the OPTIONAL `@tanstack/svelte-virtual` peer.
 */

export {
	type ColumnDef,
	type SortDirection,
	type SortState,
	type TableState,
	type TableView,
	initialTableState,
	toggleSort,
	setFilter,
	setPageSize,
	setPageIndex,
	computeRows,
} from './model.js';

export {
	type VirtualWindowInput,
	type VirtualItem,
	type VirtualWindow,
	computeVirtualWindow,
	offsetForIndex,
	nextFocusIndex,
} from './virtual.js';
