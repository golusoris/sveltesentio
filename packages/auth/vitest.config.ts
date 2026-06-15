import ts from 'typescript';
import { compileModule } from 'svelte/compiler';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Runes transform for `.svelte.ts` modules so they execute against the real
 * Svelte 5 runtime under Vitest's `node` environment. Unlike the global-shim
 * pattern used by the array/store rune tests (collab/realtime), the
 * `usePermissions` rune relies on `$derived` re-evaluating when the backing
 * `$state` is reassigned via `set()`. A pass-by-value `$derived` shim freezes
 * the first computation, so reactivity cannot be asserted; running the genuine
 * compiler output (`$.derived(() => …)` + `$.get`) against `svelte/internal/client`
 * is the only faithful path. TS types are stripped first because `compileModule`
 * parses JS only. The original sourcemap is forwarded so v8 coverage attributes
 * to `use-permissions.svelte.ts` rather than the generated module.
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
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/index.ts', 'src/runes-ambient.d.ts'],
			thresholds: {
				statements: 85,
				branches: 80,
				functions: 85,
				lines: 85,
			},
		},
	},
});
