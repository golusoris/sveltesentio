/**
 * Ambient declaration for the `$sentio` virtual module emitted by
 * `sentioPlugin` (see `@sveltesentio/core/vite`). Make it visible to your app
 * by adding `"@sveltesentio/core/sentio"` to `compilerOptions.types`, or with
 * `/// <reference types="@sveltesentio/core/sentio" />`.
 *
 * The exported shape matches `SentioConfig` from `defineSentioConfig`.
 */
declare module '$sentio' {
	import type { SentioConfig, InterfaceType } from '@sveltesentio/core';

	/** Build-time app version. */
	export const version: string;
	/** Default interface-type preset used before client-side classification. */
	export const interfaceType: InterfaceType;
	/** Static build-time feature flags (flag name → enabled). */
	export const features: Readonly<Record<string, boolean>>;
	/** Active theme preset name. */
	export const theme: string;

	const config: Readonly<SentioConfig>;
	export default config;
}
