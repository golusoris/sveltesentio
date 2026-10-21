import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { svelteVitestConfig } from '../../vitest.shared.ts';

export default svelteVitestConfig({
	svelte,
	svelteTesting,
	// Unit suites (announcer, load-locale-font) require jsdom because announcer uses document/live regions.
	unit: { environment: 'jsdom' },
	component: { name: 'component' },
	coverage: { exclude: ['src/**/*.svelte'] },
});
