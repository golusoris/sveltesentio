// Ambient stub for the `virtual:pwa-register` module that vite-plugin-pwa /
// @vite-pwa/sveltekit inject at build time. Declared here so plain `tsc` can
// resolve the lazy `import('virtual:pwa-register')` in `pwa.ts` without the
// (optional) PWA plugin installed. Consumers get the real module from Vite.
declare module 'virtual:pwa-register' {
	export interface RegisterSWOptions {
		immediate?: boolean;
		onNeedRefresh?: () => void;
		onOfflineReady?: () => void;
		onRegisteredSW?: (
			swScriptUrl: string,
			registration: ServiceWorkerRegistration | undefined,
		) => void;
		onRegisterError?: (error: unknown) => void;
	}

	export function registerSW(
		options?: RegisterSWOptions,
	): (reloadPage?: boolean) => Promise<void>;
}
