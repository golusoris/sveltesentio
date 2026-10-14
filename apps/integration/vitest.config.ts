import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The svelte plugin lets vitest load the `.svelte` modules that
// `@sveltesentio/query` re-exports (HydrationBoundary / QueryClientProvider)
// when its barrel is imported. The `$app/*` aliases stub SvelteKit's virtual
// modules that the `@sveltesentio/forms` barrel pulls in transitively (superforms'
// SuperDebug.svelte and the superforms 3 server-only guard `import '$app/server';`).
// Both are integration findings, documented in AGENTS.md.
export default defineConfig({
	plugins: [svelte()],
	resolve: {
		alias: {
			'$app/navigation': fileURLToPath(new URL('./test/mocks/app-navigation.ts', import.meta.url)),
			'$app/forms': fileURLToPath(new URL('./test/mocks/app-forms.ts', import.meta.url)),
			'$app/state': fileURLToPath(new URL('./test/mocks/app-state.ts', import.meta.url)),
			'$app/server': fileURLToPath(new URL('./test/mocks/app-server.ts', import.meta.url)),
		},
	},
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
	},
});
