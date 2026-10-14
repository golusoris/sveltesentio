import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// `pnpm test --coverage` in .github/workflows/ci-sveltekit.yml turns coverage
// on; its threshold step reads the json-summary report.
export default defineConfig({
	plugins: [
		sveltekit({
			preprocess: vitePreprocess(),
			adapter: adapter({ strict: true }),
		}),
	],
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary'],
			include: ['src/lib/**/*.ts'],
		},
	},
});
