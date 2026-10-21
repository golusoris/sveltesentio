import { nodeVitestConfig } from '../../vitest.shared.ts';

export default nodeVitestConfig({
	coverage: {
		exclude: [],
		thresholds: {
			statements: 85,
			branches: 85,
			functions: 80,
			lines: 85,
		},
	},
});
