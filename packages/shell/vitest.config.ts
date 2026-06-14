import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			// Barrel, the DOM/timer-bound action + lazy PWA wrapper, and ambient
			// type stubs carry no pure logic to cover — geometry/classification
			// they delegate to is fully tested.
			exclude: [
				'src/index.ts',
				'src/dpad-index.ts',
				'src/dpad-action.ts',
				'src/pwa.ts',
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
