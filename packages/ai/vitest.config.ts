import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { svelteVitestConfig } from '../../vitest.shared.ts';

export default svelteVitestConfig({
	svelte,
	svelteTesting,
	unit: { runes: true },
	coverage: {
		exclude: ['src/**/*.svelte', 'src/runes-ambient.d.ts'],
		thresholds: { statements: 80, branches: 75, functions: 80, lines: 80 },
	},
});
