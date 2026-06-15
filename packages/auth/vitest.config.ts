import ts from 'typescript';
import { compileModule } from 'svelte/compiler';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
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

/**
 * Two Vitest projects so DOM-dependent component tests do not perturb the
 * environment of the pure `.ts` / `.svelte.ts` suites (ADR-0036 keeps the typed
 * core node-only):
 *
 * - `unit` — node env, the `svelteRunes` transform; runs every `test/**` `.ts`
 *   suite plus the `usePermissions` rune test exactly as before.
 * - `components` — jsdom env, the real `@sveltejs/vite-plugin-svelte` compiler so
 *   `@testing-library/svelte` can mount `MfaChallenge` / `MfaEnroll`; loads
 *   `@testing-library/jest-dom` matchers + auto-cleanup via the setup file.
 *
 * Coverage stays defined at the root so a single run aggregates both projects
 * against the same 85 % gate the auth layer carries.
 */
export default defineConfig({
	test: {
		projects: [
			{
				extends: true,
				plugins: [svelteRunes()],
				test: {
					name: 'unit',
					include: ['test/**/*.test.ts'],
					exclude: ['test/**/*.svelte.test.ts'],
					environment: 'node',
				},
			},
			{
				extends: true,
				// `svelteTesting()` flips the `browser` resolve condition ahead of
				// `node` so Svelte's client `mount(...)` is used (not the SSR build)
				// and registers Testing Library's after-each unmount.
				plugins: [svelte(), svelteTesting()],
				test: {
					name: 'components',
					include: ['test/**/*.svelte.test.ts'],
					environment: 'jsdom',
					setupFiles: ['./test/setup-component.ts'],
				},
			},
		],
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
