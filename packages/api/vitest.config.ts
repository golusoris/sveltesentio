import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			// index.ts is a barrel; codegen-bin.ts is a thin process shell (shebang +
			// real fs/openapi-typescript wiring) whose logic lives in codegen.ts.
			exclude: ['src/index.ts', 'src/codegen-bin.ts'],
			thresholds: {
				statements: 70,
				branches: 70,
				functions: 70,
				lines: 70,
			},
		},
	},
});
