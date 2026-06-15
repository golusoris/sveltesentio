import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

// Two Vitest projects split the pure-model `.ts` suites from the `.svelte`
// component suites. Unlike the auth/charts layers (whose `.ts` core is
// node-only), this package's existing unit suites (`announcer`, `load-locale-font`)
// exercise real DOM APIs (`document.head`, live regions), so the `unit` project
// keeps the jsdom environment it already relied on. The `component` project adds
// the real Svelte compiler + Testing Library setup so `<LangSync>` /
// `<LocaleSwitcher>` mount against Svelte's client runtime.
export default defineConfig({
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					environment: 'jsdom',
					include: ['test/**/*.test.ts'],
					exclude: ['test/**/*.svelte.test.ts'],
				},
			},
			{
				extends: true,
				// `svelteTesting()` flips Vite's `browser` export condition ahead of
				// `node` so Svelte's client `mount(...)` is resolved (not the SSR
				// build, which throws `lifecycle_function_unavailable` under jsdom)
				// and registers Testing Library's after-each unmount.
				plugins: [svelte(), svelteTesting()],
				test: {
					name: 'component',
					environment: 'jsdom',
					include: ['test/**/*.svelte.test.ts'],
					setupFiles: ['./test/setup-component.ts'],
				},
			},
		],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/index.ts', 'src/**/*.svelte'],
			thresholds: {
				statements: 85,
				branches: 80,
				functions: 85,
				lines: 85,
			},
		},
	},
});
