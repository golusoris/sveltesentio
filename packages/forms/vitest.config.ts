import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { compileModule } from 'svelte/compiler';
import { defineConfig, type Plugin } from 'vitest/config';

// The default `superForm` seam pulls `sveltekit-superforms/client`, which
// statically imports the SvelteKit `$app/*` virtual modules. Those only exist
// inside a Kit build, so under the Node runner each is aliased to a local stub.
// `useForm`'s tests inject a fake `superForm`, so the stubs are never invoked —
// they exist purely so the import graph resolves.
const appStub = fileURLToPath(new URL('./test/app-stubs.ts', import.meta.url));

/**
 * Runes transform for `.svelte.ts` modules (e.g. `use-form.svelte.ts`) so they
 * execute against the real Svelte 5 runtime under Vitest's `node` environment.
 * `useForm` mirrors each `superForm` store into `$state` inside an `$effect`;
 * asserting that a store write propagates to the rune getter only works when the
 * genuine compiler output (`$.state`, `$.user_effect`, `$.get`) runs against
 * `svelte/internal/client` — a pass-by-value `$state`/`$effect` shim would freeze
 * reactivity. TS types are stripped first because `compileModule` parses JS only.
 * The original sourcemap is forwarded so v8 coverage attributes to the
 * `.svelte.ts` source rather than the generated module.
 */
function svelteRunes(): Plugin {
	return {
		name: 'sveltesentio:svelte-runes',
		enforce: 'pre',
		transform(code, id) {
			if (!id.endsWith('.svelte.ts')) return null;
			const stripped = ts.transpileModule(code, {
				fileName: id,
				compilerOptions: {
					module: ts.ModuleKind.ESNext,
					target: ts.ScriptTarget.ESNext,
					verbatimModuleSyntax: false,
				},
			}).outputText;
			const compiled = compileModule(stripped, {
				filename: id,
				generate: 'client',
				dev: true,
			});
			return { code: compiled.js.code, map: compiled.js.map };
		},
	};
}

export default defineConfig({
	plugins: [svelteRunes()],
	resolve: {
		alias: {
			'$app/environment': appStub,
			'$app/stores': appStub,
			'$app/navigation': appStub,
			'$app/forms': appStub,
			'$app/state': appStub,
		},
	},
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		// Inline the Superforms client so its `$app/*` imports go through Vite's
		// alias map above (externalised node_modules would hit Node's resolver,
		// which has no `$app` package).
		server: { deps: { inline: ['sveltekit-superforms'] } },
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			// `formsnap.ts` is a `.svelte`-component re-export barrel (no runner here)
			// and `runes-ambient.d.ts` is ambient types — neither is instrumentable.
			exclude: ['src/formsnap.ts', 'src/runes-ambient.d.ts'],
			thresholds: {
				statements: 80,
				branches: 75,
				functions: 80,
				lines: 80,
			},
		},
	},
});
