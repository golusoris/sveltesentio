/**
 * Pure virtualization window math (ADR-0024). Computes the visible row range
 * for a fixed-height list so the `@tanstack/svelte-virtual` `.svelte` consumer
 * (an OPTIONAL peer) only renders what's on screen, plus an overscan buffer.
 * `@tanstack/svelte-virtual` measures + scrolls; this helper is the pure slice
 * math, unit-tested independently of the DOM.
 */

export interface VirtualWindowInput {
	/** Total number of rows in the dataset. */
	readonly rowCount: number;
	/** Fixed row height in CSS px (`> 0`). */
	readonly rowHeight: number;
	/** Viewport (scroll container) height in CSS px (`> 0`). */
	readonly viewportHeight: number;
	/** Current scrollTop in CSS px (`>= 0`). */
	readonly scrollTop: number;
	/** Extra rows rendered above/below the viewport. Default `3`. */
	readonly overscan?: number;
}

/** A single rendered row: its absolute index and its `top` offset in px. */
export interface VirtualItem {
	readonly index: number;
	readonly start: number;
	readonly size: number;
}

export interface VirtualWindow {
	/** First rendered row index (inclusive, clamped ≥ 0). */
	readonly startIndex: number;
	/** Last rendered row index (inclusive, clamped < rowCount). */
	readonly endIndex: number;
	/** Rendered items with absolute offsets. */
	readonly items: readonly VirtualItem[];
	/** Full scrollable height — `rowCount * rowHeight`. Used for the spacer. */
	readonly totalSize: number;
	/** `aria-rowindex` of the first rendered row (1-based, per ADR-0024). */
	readonly ariaRowIndexStart: number;
}

/**
 * Compute the visible row window for a fixed-height virtual list. Pure. The
 * returned `items[].start` are absolute offsets; the consumer renders them
 * inside a `totalSize`-tall spacer. `ariaRowIndexStart` feeds ADR-0024's
 * 1-based `aria-rowindex` wiring.
 */
export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
	const overscan = input.overscan ?? 3;
	const rowCount = Math.max(0, Math.floor(input.rowCount));
	const rowHeight = input.rowHeight;
	const totalSize = rowCount * rowHeight;

	if (rowCount === 0 || rowHeight <= 0 || input.viewportHeight <= 0) {
		return {
			startIndex: 0,
			endIndex: -1,
			items: [],
			totalSize: Math.max(0, totalSize),
			ariaRowIndexStart: 1,
		};
	}

	const scrollTop = Math.max(0, input.scrollTop);
	const firstVisible = Math.floor(scrollTop / rowHeight);
	const visibleCount = Math.ceil(input.viewportHeight / rowHeight);
	const lastVisible = firstVisible + visibleCount;

	const startIndex = Math.max(0, firstVisible - overscan);
	const endIndex = Math.min(rowCount - 1, lastVisible + overscan);

	const items: VirtualItem[] = [];
	for (let index = startIndex; index <= endIndex; index++) {
		items.push({ index, start: index * rowHeight, size: rowHeight });
	}

	return {
		startIndex,
		endIndex,
		items,
		totalSize,
		// `aria-rowindex` is 1-based and stable across scroll (ADR-0024).
		ariaRowIndexStart: startIndex + 1,
	};
}

/** Scroll offset (px) that brings `index` to the top of the viewport. Pure. */
export function offsetForIndex(index: number, rowHeight: number): number {
	return Math.max(0, Math.floor(index) * rowHeight);
}

/**
 * Roving-tabindex keyboard navigation for a virtual grid (ADR-0024 keyboard
 * contract). Given the focused index and a key, return the next focused index,
 * or `null` if the key is not a navigation key. Pure.
 */
export function nextFocusIndex(
	current: number,
	key: string,
	rowCount: number,
	pageRows: number,
): number | null {
	const last = rowCount - 1;
	if (last < 0) return null;
	const clamp = (n: number): number => Math.min(last, Math.max(0, n));
	switch (key) {
		case 'ArrowDown':
			return clamp(current + 1);
		case 'ArrowUp':
			return clamp(current - 1);
		case 'PageDown':
			return clamp(current + Math.max(1, pageRows));
		case 'PageUp':
			return clamp(current - Math.max(1, pageRows));
		case 'Home':
			return 0;
		case 'End':
			return last;
		default:
			return null;
	}
}
