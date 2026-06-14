import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			exclude: [
				'src/index.ts',
				'src/**/index.ts',
				'src/**/*.svelte',
				'src/**/*.svelte.ts',
				'src/runes-ambient.d.ts',
			],
			thresholds: {
				statements: 85,
				branches: 80,
				functions: 85,
				lines: 85,
			},
		},
	},
});
