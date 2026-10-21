import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { svelteVitestConfig } from '../../vitest.shared.ts';

// FlowCanvas viewport-measuring logic runs in canvas-model.test.ts (Node)
// since @xyflow/svelte cannot measure a viewport under jsdom.
export default svelteVitestConfig({
	svelte,
	svelteTesting,
	coverage: { exclude: ['src/canvas.ts', 'src/nodes.ts', 'src/**/*.svelte'] },
});
