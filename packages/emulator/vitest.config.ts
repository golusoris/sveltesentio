import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

// Two Vitest projects keep the pure `buildEmulatorConfig` / loader `.ts` suites
// on the fast Node environment while the `<Emulator>` component suite gets a
// real DOM (jsdom) plus the Svelte compiler. Splitting per-project (rather than
// a per-file docblock) lets the component lane load its
// `@testing-library/jest-dom` + cleanup setup without leaking jsdom globals into
// the Node unit tests, and keeps the existing node-only suites untouched.
export default defineConfig({
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					environment: 'node',
					include: ['test/**/*.test.ts'],
					exclude: ['test/**/*.svelte.test.ts'],
				},
			},
			{
				extends: true,
				// `svelteTesting()` switches Vite to the `browser` export condition so
				// Svelte's client `mount(...)` is resolved (not the SSR build, which
				// throws lifecycle_function_unavailable under jsdom) and so `esm-env`
				// resolves `BROWSER` to `true` — exercising the component's
				// browser-only `$effect` injection path against jsdom's real document.
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
			exclude: ['src/index.ts', 'src/**/*.svelte.ts', 'src/runes-ambient.d.ts'],
			thresholds: {
				statements: 85,
				branches: 80,
				functions: 85,
				lines: 85,
			},
		},
	},
});
