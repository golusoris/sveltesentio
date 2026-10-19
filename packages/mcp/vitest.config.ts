import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		// The tool tests read the real docs and packages trees. On the 4-core
		// Windows runner, `pnpm test` runs every package's build and tests at
		// turbo's default concurrency, and that CPU contention stretches a
		// compose_search call from ~30 ms (median, mcp alone) to 2.2 s (worst of
		// 200 calls in 10 hosted jobs); tests with up to four calls then cross the
		// 5 s default. Measured table in #419; lowering turbo concurrency moved the
		// timeouts into the ui fuzz suite instead, so the limit is raised here.
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
