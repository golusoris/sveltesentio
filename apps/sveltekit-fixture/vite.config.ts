import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// `pnpm test --coverage` in .github/workflows/ci-sveltekit.yml turns coverage
// on; its threshold step reads the json-summary report.
export default defineConfig({
	plugins: [sveltekit()],
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
