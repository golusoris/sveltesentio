import { svelte } from '@sveltejs/vite-plugin-svelte';
import type { StorybookConfig } from '@storybook/svelte-vite';

/**
 * Storybook config for the sveltesentio component library (ADR pending).
 *
 * Framework `@storybook/svelte-vite` (NOT sveltekit) — the packages are plain
 * Svelte 5 libraries, not a SvelteKit app. Stories are CO-LOCATED in each
 * `packages/<pkg>/src/**` next to the component they document; the glob below
 * is the single knob to scale to every package identically.
 *
 * The repo's own `@sveltejs/vite-plugin-svelte` is injected in `viteFinal` so
 * Svelte 5 (runes) components compile exactly as they do in the package builds.
 */
/**
 * A Vite plugin's `name`, or `undefined` for entries that carry none.
 *
 * A plugin array legitimately contains `false`, `null` and promises alongside
 * plugin objects, so every lookup has to narrow before reading `.name`. Doing it
 * once here keeps the two searches below to their actual question.
 */
function pluginName(plugin: unknown): string | undefined {
	if (!plugin || typeof plugin !== 'object' || !('name' in plugin)) return undefined;
	const { name } = plugin as { name?: unknown };
	return typeof name === 'string' ? name : undefined;
}

const config: StorybookConfig = {
	stories: ['../../../packages/*/src/**/*.stories.@(svelte|ts)'],
	addons: ['@storybook/addon-a11y', '@storybook/addon-svelte-csf'],
	framework: {
		name: '@storybook/svelte-vite',
		options: {
			// Storybook's bundled svelte-docgen plugin filters on /\.svelte$/, which
			// also matches `*.stories.svelte` and then runs rolldown's JS parser on
			// the RAW (uncompiled) story source — it chokes on `<script module>`
			// (RolldownError: Unexpected token). Disabling docgen sidesteps that
			// upstream ordering bug; the stories themselves carry argTypes, so
			// autodocs still render. Re-enable once the plugin excludes story files.
			docgen: false,
		},
	},
	core: {
		disableTelemetry: true,
	},
	viteFinal(viteConfig) {
		// `.flat(Infinity)` returns `any[]`: TypeScript's `FlatArray` is only defined
		// for depths up to 20, and a `number`-typed depth collapses the element type
		// to `any` — which silently removed type-checking from every plugin read
		// below. A finite depth keeps the real `PluginOption` element type, and Vite
		// plugin arrays never nest anywhere near this deep.
		const plugins = (viteConfig.plugins ?? []).flat(8);

		const hasSveltePlugin = plugins.some(
			(plugin) => pluginName(plugin)?.startsWith('vite-plugin-svelte') ?? false,
		);
		if (hasSveltePlugin) {
			viteConfig.plugins = plugins;
			return viteConfig;
		}

		// `@storybook/svelte-vite` does NOT add `@sveltejs/vite-plugin-svelte`; the
		// user must. By the time this viteFinal runs, the addon-svelte-csf preset
		// has ALREADY appended its `storybook:addon-svelte-csf` transform LAST. That
		// transform calls `this.parse(compiledCode)` and requires the svelte plugin
		// to have ALREADY compiled `*.stories.svelte` to JS — so svelte() must sit
		// BEFORE it, not after. Splice it in just ahead of the addon transform.
		const csfIndex = plugins.findIndex(
			(plugin) => pluginName(plugin) === 'storybook:addon-svelte-csf',
		);
		const sveltePlugins = svelte();
		const insertAt = csfIndex === -1 ? plugins.length : csfIndex;
		viteConfig.plugins = [...plugins.slice(0, insertAt), sveltePlugins, ...plugins.slice(insertAt)];
		return viteConfig;
	},
};

export default config;
