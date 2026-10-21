import { nodeVitestConfig } from '../../vitest.shared.ts';

export default nodeVitestConfig({
	coverage: {
		exclude: ['src/index.ts'],
		thresholds: {
			statements: 85,
			branches: 80,
			functions: 85,
			lines: 85,
		},
	},
});
