import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		// The tool tests read the real docs/compose tree (117 recipes) on every
		// compose_search call. On the Windows runner that file I/O alone takes
		// ~4s per call, so tests with several calls cross the 5s default and
		// fail at random (run 39277352286 on main, 39284500451 on #387).
		testTimeout: 20_000,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			thresholds: {
				statements: 70,
				branches: 70,
				functions: 70,
				lines: 70,
			},
		},
	},
});
