import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			thresholds: {
				statements: 85,
				branches: 85,
				functions: 80,
				lines: 85,
			},
		},
	},
});
