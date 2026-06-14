import { describe, it, expect } from 'vitest';
import {
	computeVirtualWindow,
	nextFocusIndex,
	offsetForIndex,
} from '../src/data/virtual.js';

describe('computeVirtualWindow', () => {
	it('renders the visible window plus overscan', () => {
		const win = computeVirtualWindow({
			rowCount: 1000,
			rowHeight: 40,
			viewportHeight: 400, // 10 visible rows
			scrollTop: 4000, // first visible row index 100
			overscan: 3,
		});
		expect(win.startIndex).toBe(97); // 100 - 3
		// last visible = 100 + ceil(400/40) = 110; +3 overscan = 113
		expect(win.endIndex).toBe(113);
		expect(win.items[0]).toEqual({ index: 97, start: 97 * 40, size: 40 });
		expect(win.items).toHaveLength(win.endIndex - win.startIndex + 1);
		expect(win.totalSize).toBe(1000 * 40);
	});

	it('clamps the start index at 0 near the top', () => {
		const win = computeVirtualWindow({
			rowCount: 100,
			rowHeight: 50,
			viewportHeight: 500,
			scrollTop: 0,
			overscan: 5,
		});
		expect(win.startIndex).toBe(0);
		expect(win.ariaRowIndexStart).toBe(1);
	});

	it('clamps the end index at rowCount-1 near the bottom', () => {
		const win = computeVirtualWindow({
			rowCount: 20,
			rowHeight: 50,
			viewportHeight: 500,
			scrollTop: 600, // beyond content
			overscan: 3,
		});
		expect(win.endIndex).toBe(19);
		expect(win.items.at(-1)?.index).toBe(19);
	});

	it('aria-rowindex is 1-based off the start index', () => {
		const win = computeVirtualWindow({
			rowCount: 500,
			rowHeight: 30,
			viewportHeight: 300,
			scrollTop: 1500,
			overscan: 2,
		});
		// firstVisible 50, start = 48 → ariaRowIndexStart 49
		expect(win.startIndex).toBe(48);
		expect(win.ariaRowIndexStart).toBe(49);
	});

	it('returns an empty window for zero rows', () => {
		const win = computeVirtualWindow({ rowCount: 0, rowHeight: 40, viewportHeight: 400, scrollTop: 0 });
		expect(win.items).toHaveLength(0);
		expect(win.endIndex).toBe(-1);
		expect(win.totalSize).toBe(0);
	});

	it('guards against non-positive row/viewport heights', () => {
		expect(computeVirtualWindow({ rowCount: 5, rowHeight: 0, viewportHeight: 100, scrollTop: 0 }).items).toHaveLength(0);
		expect(computeVirtualWindow({ rowCount: 5, rowHeight: 40, viewportHeight: 0, scrollTop: 0 }).items).toHaveLength(0);
	});

	it('defaults overscan to 3', () => {
		const win = computeVirtualWindow({ rowCount: 100, rowHeight: 10, viewportHeight: 100, scrollTop: 500 });
		expect(win.startIndex).toBe(50 - 3);
	});

	it('clamps negative scrollTop to 0', () => {
		const win = computeVirtualWindow({ rowCount: 100, rowHeight: 10, viewportHeight: 100, scrollTop: -50, overscan: 0 });
		expect(win.startIndex).toBe(0);
	});
});

describe('offsetForIndex', () => {
	it('multiplies index by row height', () => {
		expect(offsetForIndex(10, 40)).toBe(400);
	});
	it('never returns negative', () => {
		expect(offsetForIndex(-3, 40)).toBe(0);
	});
});

describe('nextFocusIndex', () => {
	it('moves by one for arrow keys, clamped', () => {
		expect(nextFocusIndex(5, 'ArrowDown', 10, 5)).toBe(6);
		expect(nextFocusIndex(5, 'ArrowUp', 10, 5)).toBe(4);
		expect(nextFocusIndex(9, 'ArrowDown', 10, 5)).toBe(9);
		expect(nextFocusIndex(0, 'ArrowUp', 10, 5)).toBe(0);
	});

	it('pages by pageRows', () => {
		expect(nextFocusIndex(0, 'PageDown', 100, 10)).toBe(10);
		expect(nextFocusIndex(50, 'PageUp', 100, 10)).toBe(40);
	});

	it('jumps to first/last with Home/End', () => {
		expect(nextFocusIndex(5, 'Home', 10, 5)).toBe(0);
		expect(nextFocusIndex(5, 'End', 10, 5)).toBe(9);
	});

	it('returns null for non-navigation keys', () => {
		expect(nextFocusIndex(5, 'a', 10, 5)).toBeNull();
		expect(nextFocusIndex(5, 'Enter', 10, 5)).toBeNull();
	});

	it('returns null for an empty dataset', () => {
		expect(nextFocusIndex(0, 'ArrowDown', 0, 5)).toBeNull();
	});
});
