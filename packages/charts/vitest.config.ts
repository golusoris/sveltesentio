import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { svelteVitestConfig } from '../../vitest.shared.ts';

export default svelteVitestConfig({
	svelte,
	svelteTesting,
	component: {
		name: 'component',
		autoCleanup: false,
		// The first `renderChart()` pays a one-off cost: compiling the
		// component and pulling in layerchart's d3 scales. Locally that is
		// well under the 5s default, but a cold CI runner spends ~30s in
		// transform and ~32s in import, so whichever test mounts first
		// times out. Only this lane is affected; the Node unit suites keep
		// the strict default.
		testTimeout: 20_000,
	},
	coverage: { exclude: ['src/**/*.svelte'] },
});
