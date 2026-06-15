import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			// Top-level barrel and ambient type stubs carry no executable logic.
			// The pending `layout/` + `pwa/` sub-barrels are empty re-export stubs
			// (`export {}`) with nothing to cover. The DOM/timer-bound D-pad action,
			// its sub-barrel, and the lazy PWA wrapper ARE now covered (see the
			// dpad-action / dpad-index / pwa test files).
			exclude: [
				'src/index.ts',
				'src/layout/index.ts',
				'src/pwa/index.ts',
				'src/**/*.d.ts',
			],
			thresholds: {
				statements: 85,
				branches: 85,
				functions: 85,
				lines: 85,
			},
		},
	},
});
