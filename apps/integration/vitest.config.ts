import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The svelte plugin lets vitest load the `.svelte` modules that
// `@sveltesentio/query` re-exports (HydrationBoundary / QueryClientProvider)
// when its barrel is imported. The `$app/*` aliases stub SvelteKit's virtual
// modules that the `@sveltesentio/forms` barrel pulls in transitively (superforms'
// SuperDebug.svelte). Both are integration findings, documented in AGENTS.md.
export default defineConfig({
	plugins: [svelte()],
	resolve: {
		alias: {
			'$app/environment': fileURLToPath(new URL('./test/mocks/app-environment.ts', import.meta.url)),
			'$app/stores': fileURLToPath(new URL('./test/mocks/app-stores.ts', import.meta.url)),
			'$app/navigation': fileURLToPath(new URL('./test/mocks/app-navigation.ts', import.meta.url)),
			'$app/forms': fileURLToPath(new URL('./test/mocks/app-forms.ts', import.meta.url)),
		},
	},
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
	},
});
