// Minimal ambient declarations for Svelte 5 runes so plain `tsc` can
// type-check `.svelte.ts` files inside this package. svelte-check
// (`pnpm check:svelte`) covers the `.svelte` files, but the package's
// `typecheck` script is still plain tsc; remove this file when that script
// moves to svelte-check.

declare function $state<T>(initial: T): T;
declare function $state<T>(): T | undefined;
declare namespace $state {
	function frozen<T>(initial: T): Readonly<T>;
	function snapshot<T>(value: T): T;
	function raw<T>(initial: T): T;
}

declare function $derived<T>(expression: T): T;
declare namespace $derived {
	function by<T>(fn: () => T): T;
}

declare function $effect(fn: () => void | (() => void)): void;
declare namespace $effect {
	function pre(fn: () => void | (() => void)): void;
	function root(fn: () => void | (() => void)): () => void;
	function tracking(): boolean;
}

declare function $props<T = unknown>(): T;
declare function $bindable<T>(initial?: T): T;
declare function $inspect<T>(...values: T[]): { with(callback: (...values: T[]) => void): void };
declare function $host<T = HTMLElement>(): T;
