/**
 * Ambient declarations for `svelte/internal/client`, Svelte's private runtime.
 *
 * It ships no types, and these tests import it on purpose: the runes under test
 * depend on `$derived` re-evaluating when its backing `$state` is reassigned,
 * which only the genuine runtime does. A hand-rolled shim would freeze the first
 * computation and the reactivity assertions would pass without proving anything.
 *
 * Declared narrowly — only the two entry points the tests call, so this cannot
 * drift into a fictional description of the whole module. Delete it when the
 * monorepo adopts svelte-check globally, the same condition `runes-ambient.d.ts`
 * already carries.
 */
declare module 'svelte/internal/client' {
	/** Runs `fn` inside a fresh effect root; the return value tears that root down. */
	export function effect_root(fn: () => void): () => void;
	/** Runs pending effects synchronously rather than waiting for the microtask. */
	export function flush(): void;
}
