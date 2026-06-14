import { describe, it, expect } from 'vitest';
import { ProblemError } from '@sveltesentio/core/problem';
import {
	NodePalette,
	createNodePalette,
	createCounterIdFactory,
	type NodeIdFactory,
} from '../src/node-palette.js';

/** Deterministic id factory: `id-0`, `id-1`, … */
function seqIds(): NodeIdFactory {
	let n = 0;
	return () => `id-${n++}`;
}

describe('createCounterIdFactory', () => {
	it('produces monotonic prefixed ids starting at 1', () => {
		const next = createCounterIdFactory();
		expect(next()).toBe('node-1');
		expect(next()).toBe('node-2');
		expect(next()).toBe('node-3');
	});

	it('honours a custom prefix', () => {
		const next = createCounterIdFactory('step');
		expect(next()).toBe('step-1');
	});
});

describe('NodePalette.registerNodeType + list', () => {
	it('lists registered types in registration order', () => {
		const palette = new NodePalette();
		palette
			.registerNodeType({ type: 'process', label: 'Process' })
			.registerNodeType({ type: 'decision', label: 'Decision' })
			.registerNodeType({ type: 'data' });
		expect(palette.list().map((d) => d.type)).toEqual(['process', 'decision', 'data']);
		expect(palette.list()[0]).toMatchObject({ type: 'process', label: 'Process' });
	});

	it('returns the same definition via get + reports has', () => {
		const palette = createNodePalette();
		palette.registerNodeType({ type: 'process', category: 'logic' });
		expect(palette.has('process')).toBe(true);
		expect(palette.has('missing')).toBe(false);
		expect(palette.get('process')).toMatchObject({ type: 'process', category: 'logic' });
		expect(palette.get('missing')).toBeUndefined();
	});

	it('is chainable (returns this)', () => {
		const palette = new NodePalette();
		expect(palette.registerNodeType({ type: 'a' })).toBe(palette);
	});

	it('throws a ProblemError (409) on a duplicate type', () => {
		const palette = new NodePalette();
		palette.registerNodeType({ type: 'process' });
		try {
			palette.registerNodeType({ type: 'process' });
			expect.unreachable('duplicate registration should throw');
		} catch (error) {
			expect(error).toBeInstanceOf(ProblemError);
			if (error instanceof ProblemError) {
				expect(error.status).toBe(409);
				expect(error.detail).toContain('process');
			}
		}
	});
});

describe('NodePalette.createNode', () => {
	it('produces an @xyflow/svelte-shaped node with an injected id', () => {
		const palette = new NodePalette({ idFactory: seqIds() });
		palette.registerNodeType({ type: 'process' });
		const node = palette.createNode('process', { x: 10, y: 20 });
		expect(node).toEqual({
			id: 'id-0',
			type: 'process',
			position: { x: 10, y: 20 },
			data: {},
		});
	});

	it('mints a unique id per call from the factory', () => {
		const palette = new NodePalette({ idFactory: seqIds() });
		palette.registerNodeType({ type: 'process' });
		const a = palette.createNode('process', { x: 0, y: 0 });
		const b = palette.createNode('process', { x: 0, y: 0 });
		const c = palette.createNode('process', { x: 0, y: 0 });
		expect([a.id, b.id, c.id]).toEqual(['id-0', 'id-1', 'id-2']);
		expect(new Set([a.id, b.id, c.id]).size).toBe(3);
	});

	it('uses the default counter id factory when none is injected', () => {
		const palette = new NodePalette();
		palette.registerNodeType({ type: 'process' });
		expect(palette.createNode('process', { x: 0, y: 0 }).id).toBe('node-1');
		expect(palette.createNode('process', { x: 0, y: 0 }).id).toBe('node-2');
	});

	it('seeds data from defaultData', () => {
		const palette = new NodePalette({ idFactory: seqIds() });
		palette.registerNodeType({ type: 'process', defaultData: { label: 'Step', done: false } });
		const node = palette.createNode('process', { x: 0, y: 0 });
		expect(node.data).toEqual({ label: 'Step', done: false });
	});

	it('seeds data from makeData (fresh per create, over defaultData)', () => {
		const palette = new NodePalette({ idFactory: seqIds() });
		palette.registerNodeType({
			type: 'process',
			defaultData: { label: 'ignored' },
			makeData: () => ({ label: 'made', items: [] as string[] }),
		});
		const a = palette.createNode('process', { x: 0, y: 0 });
		const b = palette.createNode('process', { x: 0, y: 0 });
		expect(a.data).toEqual({ label: 'made', items: [] });
		// makeData returns a fresh object each call — no shared reference.
		expect(a.data.items).not.toBe(b.data.items);
	});

	it('merges per-create data over the type seed', () => {
		const palette = new NodePalette({ idFactory: seqIds() });
		palette.registerNodeType({ type: 'process', defaultData: { label: 'Step', done: false } });
		const node = palette.createNode('process', { x: 0, y: 0 }, { data: { done: true } });
		expect(node.data).toEqual({ label: 'Step', done: true });
	});

	it('accepts an explicit id, bypassing the factory', () => {
		const factoryCalls: string[] = [];
		const palette = new NodePalette({
			idFactory: () => {
				factoryCalls.push('called');
				return 'unused';
			},
		});
		palette.registerNodeType({ type: 'process' });
		const node = palette.createNode('process', { x: 0, y: 0 }, { id: 'fixed-1' });
		expect(node.id).toBe('fixed-1');
		expect(factoryCalls).toHaveLength(0);
	});

	it('copies the position (does not alias the input object)', () => {
		const palette = new NodePalette({ idFactory: seqIds() });
		palette.registerNodeType({ type: 'process' });
		const input = { x: 5, y: 6 };
		const node = palette.createNode('process', input);
		expect(node.position).toEqual({ x: 5, y: 6 });
		expect(node.position).not.toBe(input);
	});

	it('throws a ProblemError (404) for an unknown type', () => {
		const palette = new NodePalette();
		try {
			palette.createNode('ghost', { x: 0, y: 0 });
			expect.unreachable('unknown type should throw');
		} catch (error) {
			expect(error).toBeInstanceOf(ProblemError);
			if (error instanceof ProblemError) {
				expect(error.status).toBe(404);
				expect(error.detail).toContain('ghost');
			}
		}
	});
});
