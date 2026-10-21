import { nodeVitestConfig } from '../../vitest.shared.ts';

export default nodeVitestConfig({
	coverage: {
		// index.ts is a barrel export whose members are tested via their own modules.
		exclude: ['src/index.ts'],
		thresholds: {
			statements: 70,
			branches: 70,
			functions: 70,
			lines: 70,
		},
	},
});
