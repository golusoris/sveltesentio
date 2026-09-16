import type { Readable } from 'svelte/store';

/**
 * A Svelte store read as a rune.
 *
 * `useForm` mirrors nine Superforms stores into `$state`, and did it by hand:
 * nine `$state(seed(...))` declarations, nine `subscribe` callbacks collected
 * into an array, and one teardown loop — 63 of its 100 lines were that same
 * shape repeated (HISS-04, HISS-19).
 *
 * Repetition is the real cost rather than the length. Each of the nine was an
 * opportunity to subscribe to the wrong store, assign to the wrong cell, or
 * forget the unsubscribe; all three are invisible in review because the lines
 * look alike. There is one of each here now.
 */
export interface StoreRune<T> {
	/** The store's latest value, reactive inside an effect or template. */
	readonly current: T;
}

/**
 * Reads a store's value once, synchronously, without holding a subscription.
 *
 * Runes need an initial value at declaration, and a Svelte store delivers its
 * current value synchronously on subscribe — so subscribing and immediately
 * unsubscribing is the documented way to sample one.
 */
export function readOnce<T>(store: Readable<T>): T {
	let captured!: T;
	store.subscribe((value) => {
		captured = value;
	})();
	return captured;
}

/**
 * Mirrors `store` into a rune that tracks it for the caller's lifetime.
 *
 * The subscription is opened inside an `$effect`, so it is torn down when the
 * owning component or effect root is destroyed. Call this during setup, where
 * an effect root exists; calling it outside one is the same mistake as using
 * `$effect` there, and Svelte reports it the same way.
 */
export function mirror<T>(store: Readable<T>): StoreRune<T> {
	let current = $state<T>(readOnce(store));

	$effect(() =>
		store.subscribe((value) => {
			current = value;
		}),
	);

	return {
		get current(): T {
			return current;
		},
	};
}
