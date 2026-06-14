// Optional PWA registration helper. Thin, typed re-export over the
// `virtual:pwa-register` module that `vite-plugin-pwa` / `@vite-pwa/sveltekit`
// inject at build time (ADR-0028). Those stay OPTIONAL peers: this module
// declares its own option type and resolves the virtual module lazily, so
// `@sveltesentio/shell` type-checks and imports with neither installed.

/**
 * Service-worker registration options, structurally compatible with
 * `vite-plugin-pwa`'s `RegisterSWOptions`. Declared locally so the dependency
 * stays optional — install `@vite-pwa/sveltekit` (per ADR-0028) to wire it.
 */
export interface RegisterSWOptions {
	/** Register immediately rather than on `window.load`. */
	immediate?: boolean;
	/** A new service worker is waiting; prompt the user to refresh. */
	onNeedRefresh?: () => void;
	/** Content is cached for offline use. */
	onOfflineReady?: () => void;
	/** The service worker registered successfully. */
	onRegisteredSW?: (
		swScriptUrl: string,
		registration: ServiceWorkerRegistration | undefined,
	) => void;
	/** Registration failed. */
	onRegisterError?: (error: unknown) => void;
}

/** Reloads the page to activate a waiting service worker. */
export type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

interface PwaRegisterModule {
	registerSW: (options?: RegisterSWOptions) => UpdateServiceWorker;
}

/**
 * Register the service worker via `virtual:pwa-register`, returning the
 * `updateServiceWorker` callback (call it from your update-prompt UI to reload
 * into the new version).
 *
 * SSR-safe: a no-op resolving to a no-op updater when `window` is unavailable.
 * The virtual module is imported lazily so this package carries no hard PWA
 * dependency; if the PWA plugin is not configured, the import rejects and a
 * warning is logged rather than throwing at module load.
 */
export async function registerSW(
	options: RegisterSWOptions = {},
): Promise<UpdateServiceWorker> {
	const noop: UpdateServiceWorker = async () => {};
	if (typeof window === 'undefined') return noop;

	try {
		const mod = (await import(
			/* @vite-ignore */ 'virtual:pwa-register'
		)) as PwaRegisterModule;
		return mod.registerSW(options);
	} catch (error) {
		console.warn(
			'[@sveltesentio/shell] virtual:pwa-register unavailable — is vite-plugin-pwa / @vite-pwa/sveltekit configured?',
			error,
		);
		return noop;
	}
}
