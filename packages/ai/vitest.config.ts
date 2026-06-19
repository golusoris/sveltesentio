import ts from 'typescript';
import { compileModule } from 'svelte/compiler';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Runes transform for `.svelte.ts` modules so they execute against the real
 * Svelte 5 runtime under Vitest's `node` environment. The `useLLMChat` rune
 * relies on `$state` reassignment being observed through getters, so running
 * the genuine compiler output (`$.state` + `$.get`) against
 * `svelte/internal/client` is the faithful path (mirrors auth's usePermissions).
 * TS types are stripped first because `compileModule` parses JS only; the
 * original sourcemap is forwarded so v8 coverage attributes to the `.svelte.ts`.
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
 * Two Vitest projects keep the pure-`.ts` suites (audit/proxy/edge/server) on
 * the fast Node environment, while the `.svelte` component suite and the
 * `useLLMChat` rune run with the real Svelte compiler. Coverage stays defined
 * at the root so a single run aggregates both projects against one gate.
 */
export default defineConfig({
	test: {
		projects: [
			{
				extends: true,
				plugins: [svelteRunes()],
				test: {
					name: 'unit',
					environment: 'node',
					include: ['test/**/*.test.ts'],
					exclude: ['test/**/*.svelte.test.ts'],
				},
			},
			{
				extends: true,
				// `svelteTesting()` flips the `browser` resolve condition ahead of
				// `node` so Svelte's client `mount(...)` is used (not the SSR build),
				// and registers Testing Library's after-each unmount.
				plugins: [svelte(), svelteTesting()],
				test: {
					name: 'components',
					environment: 'jsdom',
					include: ['test/**/*.svelte.test.ts'],
					setupFiles: ['./test/setup-component.ts'],
				},
			},
		],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/index.ts', 'src/**/*.svelte', 'src/runes-ambient.d.ts'],
			thresholds: {
				statements: 80,
				branches: 75,
				functions: 80,
				lines: 80,
			},
		},
	},
});
