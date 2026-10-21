import { nodeVitestConfig } from '../../vitest.shared.ts';

export default nodeVitestConfig({
	coverage: {
		exclude: ['src/index.ts'],
		thresholds: {
			statements: 70,
			branches: 70,
			functions: 70,
			lines: 70,
		},
	},
});
