import { describe, expect, it } from 'vitest';
import { effect_root, flush } from 'svelte/internal/client';
import { writable, readable } from 'svelte/store';
import { mirror, readOnce } from '../src/store-rune.svelte.js';

/**
 * Opens an effect root, runs `body` inside it, then tears it down.
 *
 * `body` receives `flushNow`, which it must call after constructing a mirror:
 * the subscription opens inside an `$effect`, and effects are deferred until a
 * flush. Reading `current` before that yields the seeded value only.
 */
function withEffectRoot(body: (flushNow: () => void) => void): void {
	const cleanup = effect_root(() => {
		body(flush);
	});
	flush();
	cleanup();
}

describe('readOnce', () => {
	it('samples the current value without holding a subscription', () => {
		let subscribers = 0;
		const store = readable(7, () => {
			subscribers += 1;
			return () => {
				subscribers -= 1;
			};
		});

		expect(readOnce(store)).toBe(7);
		expect(subscribers).toBe(0);
	});

	it('reads a value written before the read', () => {
		const store = writable('a');
		store.set('b');
		expect(readOnce(store)).toBe('b');
	});
});

describe('mirror', () => {
	it('starts at the store’s current value', () => {
		withEffectRoot(() => {
			// Seeded synchronously by readOnce, so this holds before any flush.
			const store = writable(1);
			expect(mirror(store).current).toBe(1);
		});
	});

	it('tracks later writes', () => {
		withEffectRoot((flushNow) => {
			const store = writable('first');
			const cell = mirror(store);
			flushNow();

			store.set('second');
			expect(cell.current).toBe('second');

			store.set('third');
			expect(cell.current).toBe('third');
		});
	});

	// The bug the nine hand-written subscriptions invited: mirroring two stores
	// and wiring one of them to the wrong cell.
	it('keeps two mirrors of different stores independent', () => {
		withEffectRoot((flushNow) => {
			const left = writable('L1');
			const right = writable('R1');
			const a = mirror(left);
			const b = mirror(right);
			flushNow();

			left.set('L2');

			expect(a.current).toBe('L2');
			expect(b.current).toBe('R1');
		});
	});

	it('unsubscribes when the effect root is torn down', () => {
		let subscribers = 0;
		const store = readable(0, () => {
			subscribers += 1;
			return () => {
				subscribers -= 1;
			};
		});

		const cleanup = effect_root(() => {
			mirror(store);
		});
		flush();
		expect(subscribers).toBe(1);

		cleanup();
		expect(subscribers).toBe(0);
	});

	// Boundary: undefined is a value a Superforms store really carries — `message`
	// is undefined until the server sends one — so it must not be confused with
	// "nothing arrived yet".
	it('mirrors undefined as a value', () => {
		withEffectRoot((flushNow) => {
			const store = writable<string | undefined>(undefined);
			const cell = mirror(store);
			flushNow();
			expect(cell.current).toBeUndefined();

			store.set('now set');
			expect(cell.current).toBe('now set');

			store.set(undefined);
			expect(cell.current).toBeUndefined();
		});
	});
});
