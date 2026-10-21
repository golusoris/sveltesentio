import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelteRunes, v8Coverage } from '../../vitest.shared.ts';

// The default `superForm` seam pulls `sveltekit-superforms/client`, which
// statically imports the SvelteKit `$app/*` virtual modules, and Superforms 3's
// server entry imports `$app/server` as a server-only guard. Those only exist
// inside a Kit build, so under the Node runner each is aliased to a local stub.
// `useForm`'s tests inject a fake `superForm`, so the stubs are never invoked —
// they exist purely so the import graph resolves.
const appStub = fileURLToPath(new URL('./test/app-stubs.ts', import.meta.url));

export default defineConfig({
	plugins: [svelteRunes()],
	resolve: {
		alias: {
			'$app/navigation': appStub,
			'$app/forms': appStub,
			'$app/state': appStub,
			'$app/server': appStub,
		},
	},
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		// Inline the Superforms client so its `$app/*` imports go through Vite's
		// alias map above (externalised node_modules would hit Node's resolver,
		// which has no `$app` package).
		server: { deps: { inline: ['sveltekit-superforms'] } },
		// Default 85/80/85/85 thresholds: AGENTS.md and docs/principles.md promise 85%
		// for forms, as for auth (gap audit A2-8). `formsnap.ts` is a `.svelte`
		// re-export barrel with no runner here, so it is not instrumentable.
		coverage: v8Coverage({
			exclude: ['src/formsnap.ts', 'src/runes-ambient.d.ts'],
		}),
	},
});
