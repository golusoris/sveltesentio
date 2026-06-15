// Component-render tests for VirtualList.svelte: fixed-height row windowing +
// WCAG 2.2 AA grid semantics (ADR-0024). The component derives its rendered
// window from a `bind:clientHeight` viewport, which jsdom reports as 0; the
// resize-observer stub gives the viewport a real height and re-fires Svelte's
// size listener so the window math runs. Rows come through the harness's `row`
// snippet.
import { tick } from 'svelte';
import { fireEvent, render, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Harness from './VirtualListHarness.svelte';
import { flushResizeObservers, setClientSize } from './resize-observer-stub.js';
import { expectNoAxeViolations } from './axe-helper.js';

interface Item {
	id: number;
	label: string;
}

const ROW_HEIGHT = 40;
const VIEWPORT_HEIGHT = 200; // 5 visible rows at 40px.

function makeItems(count: number): Item[] {
	return Array.from({ length: count }, (_, i) => ({ id: i, label: `Item ${i}` }));
}

/**
 * Render the list, give the viewport a measured height, and flush the resize
 * observer so the bound `viewportHeight` updates and the window renders. Returns
 * the grid (viewport) element plus the Testing Library result.
 */
async function renderList(count = 100, overscan?: number) {
	const result = render(Harness, {
		items: makeItems(count),
		rowHeight: ROW_HEIGHT,
		label: 'Big list',
		overscan,
	});
	// Scope to this render's container so a test that mounts two lists (e.g. the
	// overscan comparison) does not collide on the shared "Big list" label.
	const grid = within(result.container).getByRole('grid', { name: 'Big list' });
	setClientSize(grid, { height: VIEWPORT_HEIGHT });
	flushResizeObservers();
	// Let the bound `viewportHeight` $state flush so the window `$derived` re-runs.
	await tick();
	return { grid, ...result };
}

/** Absolute row indices (from `data-index`) currently rendered, sorted ascending. */
function renderedIndices(grid: HTMLElement): number[] {
	return within(grid)
		.queryAllByTestId('vrow')
		.map((el) => Number(el.getAttribute('data-index')))
		.sort((a, b) => a - b);
}

describe('<VirtualList>', () => {
	it('exposes a labelled, focusable grid with the FULL dataset rowcount', async () => {
		const { grid } = await renderList(100);

		expect(grid).toHaveAttribute('aria-label', 'Big list');
		expect(grid).toHaveAttribute('aria-rowcount', '100');
		expect(grid).toHaveAttribute('tabindex', '0');
	});

	it('windows: renders only the visible slice (+overscan), not all rows', async () => {
		const { grid } = await renderList(100);
		const indices = renderedIndices(grid);

		// 5 visible + 3 overscan below; clamped at 0 above. Far fewer than 100.
		expect(indices.length).toBeGreaterThan(0);
		expect(indices.length).toBeLessThan(20);
		expect(indices[0]).toBe(0);
		expect(Math.max(...indices)).toBeLessThan(20);
	});

	it('gives each rendered row role=row and a 1-based aria-rowindex', async () => {
		const { grid } = await renderList(100);
		const rows = within(grid).getAllByRole('row');
		expect(rows.length).toBeGreaterThan(0);

		const first = rows[0];
		// First rendered row is absolute index 0 -> aria-rowindex 1 (ADR-0024).
		expect(first).toHaveAttribute('aria-rowindex', '1');
		expect(within(first).getByTestId('vrow')).toHaveTextContent('Row 0: Item 0');
	});

	it('renders the spacer at the full scrollable height', async () => {
		const { grid } = await renderList(100);
		const spacer = grid.querySelector('.ssentio-virtuallist__spacer') as HTMLElement;
		expect(spacer).toBeInTheDocument();
		// totalSize = rowCount * rowHeight = 100 * 40.
		expect(spacer.style.height).toBe('4000px');
	});

	it('shifts the rendered window when scrolled down', async () => {
		const { grid } = await renderList(100);
		const before = renderedIndices(grid);
		expect(before[0]).toBe(0);

		// Scroll to row ~50 and dispatch the scroll event the component listens for.
		grid.scrollTop = 50 * ROW_HEIGHT;
		await fireEvent.scroll(grid);

		const after = renderedIndices(grid);
		expect(after[0]).toBeGreaterThan(40);
		expect(after).toContain(50);
		// Index 0 has scrolled out of the window.
		expect(after).not.toContain(0);
	});

	it('marks the focused row aria-selected and moves it on ArrowDown', async () => {
		const { grid } = await renderList(100);

		// Initially row 0 is the focus index.
		expect(within(grid).getAllByRole('row')[0]).toHaveAttribute('aria-selected', 'true');

		await fireEvent.keyDown(grid, { key: 'ArrowDown' });

		// Row index 1 is now selected; find it among the rendered rows.
		const selected = within(grid)
			.getAllByRole('row')
			.find((r) => r.getAttribute('aria-selected') === 'true');
		expect(selected).toHaveAttribute('aria-rowindex', '2');
	});

	it('jumps to the last row on End and back to the first on Home', async () => {
		const { grid } = await renderList(100);

		// End sets focusIndex=99 and assigns viewport.scrollTop; the browser then
		// fires `scroll` (jsdom does not on programmatic assignment), which feeds the
		// window math — so dispatch it explicitly.
		await fireEvent.keyDown(grid, { key: 'End' });
		await fireEvent.scroll(grid);
		let after = renderedIndices(grid);
		expect(after).toContain(99);

		await fireEvent.keyDown(grid, { key: 'Home' });
		await fireEvent.scroll(grid);
		after = renderedIndices(grid);
		expect(after).toContain(0);
	});

	it('honours a custom overscan', async () => {
		const tight = await renderList(100, 0);
		const tightCount = renderedIndices(tight.grid).length;

		const loose = await renderList(100, 6);
		const looseCount = renderedIndices(loose.grid).length;

		expect(looseCount).toBeGreaterThan(tightCount);
	});

	it('is axe-clean with a rendered window', async () => {
		const { container } = await renderList(100);
		await expectNoAxeViolations(container);
	});
});
