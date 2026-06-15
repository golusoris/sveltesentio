import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

/**
 * Non-reactive `$state` / `$effect` shim — see createYjsStore.test.ts for the
 * rationale. The map store's getters close over `let snapshot = $state(...)`,
 * so reassignment inside the Yjs `observe()` callback is what the getters
 * surface; that snapshot-sync is the behaviour under test (ADR-0039).
 */
const teardowns: Array<() => void> = [];
const g = globalThis as unknown as {
	$state?: unknown;
	$effect?: unknown;
};

beforeEach(() => {
	g.$state = <T>(initial: T): T => initial;
	const effect = (fn: () => void | (() => void)): void => {
		const cleanup = fn();
		if (typeof cleanup === 'function') teardowns.push(cleanup);
	};
	g.$effect = effect;
});

afterEach(() => {
	teardowns.length = 0;
	delete g.$state;
	delete g.$effect;
});

function newMap<V>(): { doc: Y.Doc; yMap: Y.Map<V> } {
	const doc = new Y.Doc();
	const yMap = doc.getMap<V>('entries');
	return { doc, yMap };
}

describe('createYjsMap (map rune)', () => {
	it('snapshot reflects the Y.Map at construction time', async () => {
		const { createYjsMap } = await import('../src/createYjsMap.svelte.js');
		const { yMap } = newMap<number>();
		yMap.set('a', 1);
		yMap.set('b', 2);
		const store = createYjsMap(yMap);
		expect(store.entries).toEqual({ a: 1, b: 2 });
		expect(store.size).toBe(2);
	});

	it('snapshot re-syncs when the Y.Map mutates after subscription', async () => {
		const { createYjsMap } = await import('../src/createYjsMap.svelte.js');
		const { yMap } = newMap<number>();
		const store = createYjsMap(yMap);
		expect(store.entries).toEqual({});

		yMap.set('a', 1);
		expect(store.entries).toEqual({ a: 1 });

		yMap.delete('a');
		expect(store.entries).toEqual({});
	});

	it('mutation methods route through the Y.Map', async () => {
		const { createYjsMap } = await import('../src/createYjsMap.svelte.js');
		const { yMap } = newMap<number>();
		const store = createYjsMap(yMap);

		store.set('a', 1);
		store.set('b', 2);
		expect(yMap.get('a')).toBe(1);
		expect(yMap.get('b')).toBe(2);
		expect(store.entries).toEqual({ a: 1, b: 2 });

		store.delete('a');
		expect(yMap.has('a')).toBe(false);
		expect(store.entries).toEqual({ b: 2 });

		store.clear();
		expect(yMap.size).toBe(0);
		expect(store.entries).toEqual({});
	});

	it('get / has / keys / values read from the synced snapshot', async () => {
		const { createYjsMap } = await import('../src/createYjsMap.svelte.js');
		const { yMap } = newMap<number>();
		const store = createYjsMap(yMap);
		store.set('x', 10);
		store.set('y', 20);

		expect(store.get('x')).toBe(10);
		expect(store.get('missing')).toBeUndefined();
		expect(store.has('y')).toBe(true);
		expect(store.has('missing')).toBe(false);
		expect(store.keys().sort()).toEqual(['x', 'y']);
		expect(store.values().sort((a, b) => a - b)).toEqual([10, 20]);
	});

	it('has uses hasOwnProperty so inherited keys are not reported present', async () => {
		const { createYjsMap } = await import('../src/createYjsMap.svelte.js');
		const { yMap } = newMap<number>();
		const store = createYjsMap(yMap);
		expect(store.has('toString')).toBe(false);
		expect(store.has('constructor')).toBe(false);
	});

	it('entries view rejects direct mutation of the Y type', async () => {
		const { createYjsMap } = await import('../src/createYjsMap.svelte.js');
		const { yMap } = newMap<number>();
		const store = createYjsMap(yMap);
		store.set('a', 1);

		(store.entries as Record<string, number>).injected = 99;
		expect(yMap.has('injected')).toBe(false);
	});

	it('$effect cleanup unsubscribes from the Y.Map observer', async () => {
		const { createYjsMap } = await import('../src/createYjsMap.svelte.js');
		const { yMap } = newMap<number>();
		const store = createYjsMap(yMap);

		yMap.set('a', 1);
		expect(store.entries).toEqual({ a: 1 });

		expect(teardowns).toHaveLength(1);
		teardowns[0]!();

		yMap.set('b', 2);
		expect(store.entries).toEqual({ a: 1 });
	});
});
