import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { svelteVitestConfig } from '../../vitest.shared.ts';

export default svelteVitestConfig({
	svelte,
	svelteTesting,
	coverage: {
		exclude: ['src/**/index.ts', 'src/**/*.svelte', 'src/**/*.svelte.ts', 'src/runes-ambient.d.ts'],
	},
});
