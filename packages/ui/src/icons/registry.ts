/**
 * Pluggable icon registry (ADR-0002). `@lucide/svelte` is the default set; apps
 * may `registerIconLoader` to resolve arbitrary names (e.g. via
 * `@iconify/svelte`) without patching the framework. Pure resolution logic with
 * no Svelte/DOM imports — the `Icon.svelte` consumer is a thin view over this.
 *
 * Downstream: arca + subdo call `registerIconLoader` from
 * `@sveltesentio/ui/icons` in `+layout.svelte`
 * (docs/migrations/downstream-antipatterns-v0.1.md).
 */

/**
 * A resolved icon component. Typed as a non-nullable opaque value (any
 * non-null/undefined value) so the registry never depends on Svelte's component
 * type; the `.svelte` consumer narrows it to `Component` at the render boundary.
 */
export type IconComponent = NonNullable<unknown>;

/** A loader's return: a component (sync or Promise), or a nullish miss. */
export type IconLoaderResult =
	| IconComponent
	| Promise<IconComponent | undefined>
	| undefined
	| null;

/**
 * An icon loader. Returns the component for `name`, or `undefined`/`null` to
 * defer to the next loader (or the default Lucide loader). May return a Promise
 * to support lazy icon sets.
 */
export type IconLoader = (name: string) => IconLoaderResult;

/** Result of resolving a name: the component (or its Promise) plus its source. */
export interface IconResolution {
	readonly component: IconComponent | Promise<IconComponent>;
	readonly source: 'registered' | 'default';
}

/**
 * Immutable icon registry: an ordered list of loaders plus an optional default
 * loader (the Lucide adapter). Resolution tries registered loaders in
 * registration order (most-recent last wins on `register`), then the default.
 */
export class IconRegistry {
	readonly #loaders: readonly IconLoader[];
	readonly #fallback: IconLoader | undefined;

	constructor(loaders: readonly IconLoader[] = [], fallback?: IconLoader) {
		this.#loaders = loaders;
		this.#fallback = fallback;
	}

	/** Registered loaders in resolution order. */
	get loaders(): readonly IconLoader[] {
		return this.#loaders;
	}

	/** Register one or more loaders; later loaders take precedence. Returns a new registry. */
	register(...loaders: readonly IconLoader[]): IconRegistry {
		return new IconRegistry([...loaders, ...this.#loaders], this.#fallback);
	}

	/** Set the default (fallback) loader, e.g. the Lucide adapter. Returns a new registry. */
	withFallback(fallback: IconLoader | undefined): IconRegistry {
		return new IconRegistry(this.#loaders, fallback);
	}

	/**
	 * Resolve `name` to a component. Tries registered loaders first, then the
	 * fallback. Returns `undefined` when nothing matches (the consumer renders an
	 * empty, `aria-hidden` placeholder rather than throwing).
	 */
	resolve(name: string): IconResolution | undefined {
		for (const loader of this.#loaders) {
			const component = safeLoad(loader, name);
			if (component != null) return { component, source: 'registered' };
		}
		if (this.#fallback) {
			const component = safeLoad(this.#fallback, name);
			if (component != null) return { component, source: 'default' };
		}
		return undefined;
	}
}

/** Run a loader, swallowing its throw so one bad loader cannot break resolution. */
function safeLoad(loader: IconLoader, name: string): IconLoaderResult {
	try {
		return loader(name);
	} catch (error) {
		console.warn(`[ui/icons] loader threw resolving "${name}":`, error);
		return undefined;
	}
}

/** The process-wide registry. Mutated only through {@link registerIconLoader}. */
let current = new IconRegistry();

/**
 * Register a loader on the global registry (typical app-startup call in
 * `+layout.svelte`). Later registrations take precedence. Returns an unregister
 * function — primarily for tests and HMR.
 */
export function registerIconLoader(loader: IconLoader): () => void {
	current = current.register(loader);
	return () => {
		current = new IconRegistry(
			current.loaders.filter((entry) => entry !== loader),
			currentFallback,
		);
	};
}

/** The Lucide (or other) default loader, kept so `unregister` can preserve it. */
let currentFallback: IconLoader | undefined;

/** Install the default/fallback loader (the Lucide adapter wires this at import). */
export function setDefaultIconLoader(loader: IconLoader | undefined): void {
	currentFallback = loader;
	current = current.withFallback(loader);
}

/** Resolve a name against the global registry. Used by `Icon.svelte`. */
export function resolveIcon(name: string): IconResolution | undefined {
	return current.resolve(name);
}

/** Replace the global registry. Test seam; not part of the app-facing API. */
export function __setRegistry(registry: IconRegistry): void {
	current = registry;
	currentFallback = undefined;
}

/** Read the global registry. Test seam. */
export function __getRegistry(): IconRegistry {
	return current;
}
