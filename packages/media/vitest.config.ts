import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

// Two Vitest projects keep the pure-model `.ts` suites (player / image /
// carousel / lqip) on the fast Node environment while the `.svelte` component
// suites get a real DOM (jsdom) plus the Svelte compiler. Splitting per-project
// (rather than a per-file docblock) lets the component lane load its
// `@testing-library/jest-dom` + cleanup setup without leaking jsdom globals into
// the Node unit tests.
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
				// throws lifecycle_function_unavailable under jsdom).
				plugins: [svelte(), svelteTesting({ autoCleanup: false })],
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
				branches: 85,
				functions: 80,
				lines: 85,
			},
		},
	},
});
