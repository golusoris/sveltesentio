import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

/**
 * `.svelte.ts` rune modules need `$state` / `$effect` at runtime. The monorepo
 * runs vitest in `node`, so we install a minimal non-reactive shim before
 * importing the module under test: `$state(v)` returns `v`, and `$effect(fn)`
 * runs the body immediately and captures the teardown so the test can fire it
 * (emulating `$effect` cleanup on component unmount). The store's getters close
 * over the `let snapshot = $state(...)` binding, so reassigning it inside the
 * Yjs `observe()` callback is observable through the getters — that is the
 * snapshot-sync behaviour under test (ADR-0039), not framework reactivity.
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

function newArray<T>(): { doc: Y.Doc; yArray: Y.Array<T> } {
	const doc = new Y.Doc();
	const yArray = doc.getArray<T>('items');
	return { doc, yArray };
}

describe('createYjsStore (array rune)', () => {
	it('snapshot reflects the Y.Array at construction time', async () => {
		const { createYjsStore } = await import('../src/createYjsStore.svelte.js');
		const { yArray } = newArray<number>();
		yArray.push([1, 2, 3]);
		const store = createYjsStore(yArray);
		expect(store.items).toEqual([1, 2, 3]);
		expect(store.length).toBe(3);
	});

	it('snapshot re-syncs when the Y.Array mutates after subscription', async () => {
		const { createYjsStore } = await import('../src/createYjsStore.svelte.js');
		const { yArray } = newArray<string>();
		const store = createYjsStore(yArray);
		expect(store.items).toEqual([]);

		yArray.push(['a', 'b']);
		expect(store.items).toEqual(['a', 'b']);
		expect(store.length).toBe(2);

		yArray.delete(0, 1);
		expect(store.items).toEqual(['b']);
	});

	it('mutation methods route through the Y.Array', async () => {
		const { createYjsStore } = await import('../src/createYjsStore.svelte.js');
		const { yArray } = newArray<number>();
		const store = createYjsStore(yArray);

		store.push(1, 4);
		expect(yArray.toArray()).toEqual([1, 4]);
		expect(store.items).toEqual([1, 4]);

		store.insert(1, [2, 3]);
		expect(yArray.toArray()).toEqual([1, 2, 3, 4]);

		store.delete(0);
		expect(yArray.toArray()).toEqual([2, 3, 4]);

		store.delete(0, 2);
		expect(yArray.toArray()).toEqual([4]);
	});

	it('get / toArray read from the synced snapshot', async () => {
		const { createYjsStore } = await import('../src/createYjsStore.svelte.js');
		const { yArray } = newArray<string>();
		const store = createYjsStore(yArray);
		store.push('x', 'y');

		expect(store.get(0)).toBe('x');
		expect(store.get(5)).toBeUndefined();

		const copy = store.toArray();
		expect(copy).toEqual(['x', 'y']);
		copy.push('mutated');
		expect(store.items).toEqual(['x', 'y']);
	});

	it('items view rejects direct mutation of the Y type', async () => {
		const { createYjsStore } = await import('../src/createYjsStore.svelte.js');
		const { yArray } = newArray<number>();
		const store = createYjsStore(yArray);
		store.push(1, 2);

		(store.items as number[]).push(99);
		expect(yArray.toArray()).toEqual([1, 2]);
	});

	it('$effect cleanup unsubscribes from the Y.Array observer', async () => {
		const { createYjsStore } = await import('../src/createYjsStore.svelte.js');
		const { yArray } = newArray<number>();
		const store = createYjsStore(yArray);

		yArray.push([1]);
		expect(store.items).toEqual([1]);

		expect(teardowns).toHaveLength(1);
		teardowns[0]!();

		// After teardown the observer is gone: snapshot stops tracking.
		yArray.push([2]);
		expect(store.items).toEqual([1]);
	});
});
