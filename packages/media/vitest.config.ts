import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { svelteVitestConfig } from '../../vitest.shared.ts';

export default svelteVitestConfig({
	svelte,
	svelteTesting,
	component: { name: 'component', autoCleanup: false },
	coverage: {
		exclude: ['src/**/*.svelte'],
		thresholds: { statements: 85, branches: 85, functions: 80, lines: 85 },
	},
});
