/**
 * Runes-native `DataTable<T>` store (ADR-0011). Thin reactive wrapper over the
 * pure {@link computeRows} model: holds source rows + view state in `$state`,
 * derives the visible page with `$derived`. Untested in vitest (runes need the
 * Svelte compiler) — the pure model in `./model.ts` carries the tested logic.
 */

import {
	computeRows,
	initialTableState,
	setFilter,
	setPageIndex,
	setPageSize,
	toggleSort,
	type ColumnDef,
	type TableState,
	type TableView,
} from './model.js';

export interface DataTableOptions<T> {
	readonly rows: readonly T[];
	readonly columns: readonly ColumnDef<T>[];
	readonly initialState?: Partial<TableState>;
}

/** Reactive table store. Mutating methods update `$state`; `view` is derived. */
export class DataTableStore<T> {
	#rows = $state<readonly T[]>([]);
	#state = $state<TableState>(initialTableState);
	readonly columns: readonly ColumnDef<T>[];

	constructor(options: DataTableOptions<T>) {
		this.columns = options.columns;
		this.#rows = options.rows;
		this.#state = { ...initialTableState, ...options.initialState };
	}

	/** Current view-state snapshot. */
	get state(): TableState {
		return this.#state;
	}

	/** Replace the source rows (e.g. after a query refetch). */
	setRows(rows: readonly T[]): void {
		this.#rows = rows;
	}

	/** Derived visible page after filter → sort → paginate. */
	get view(): TableView<T> {
		return computeRows(this.#rows, this.columns, this.#state);
	}

	toggleSort(columnId: string): void {
		this.#state = toggleSort(this.#state, columnId);
	}

	setFilter(filter: string): void {
		this.#state = setFilter(this.#state, filter);
	}

	setPageSize(size: number): void {
		this.#state = setPageSize(this.#state, size);
	}

	setPageIndex(index: number): void {
		this.#state = setPageIndex(this.#state, index);
	}
}

/** Factory mirroring the project's `create*` rune-helper convention. */
export function createDataTable<T>(options: DataTableOptions<T>): DataTableStore<T> {
	return new DataTableStore<T>(options);
}
