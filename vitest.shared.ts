import ts from 'typescript';
import { compileModule } from 'svelte/compiler';
import type { Plugin, UserWorkspaceConfig, ViteUserConfig } from 'vitest/config';

type PluginEntry = NonNullable<UserWorkspaceConfig['plugins']>[number];

/**
 * Runes transform for `.svelte.ts` modules so they execute against the real
 * Svelte 5 runtime under Vitest's `node` environment. Modules relying on
 * `$state`, `$derived`, or `$effect` (e.g. `useLLMChat`, `usePermissions`, `useForm`)
 * require genuine compiler output (`$.state`, `$.derived`, `$.get`, `$.user_effect`)
 * running against `svelte/internal/client` because pass-by-value shims freeze reactivity.
 * TypeScript types are stripped first via `ts.transpileModule` because `compileModule`
 * parses JavaScript only. The original sourcemap is forwarded so v8 coverage
 * attributes to the `.svelte.ts` source rather than the generated module.
 */
export function svelteRunes(): Plugin {
	return {
		name: 'sveltesentio:svelte-runes',
		enforce: 'pre',
		transform(code: string, id: string) {
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

interface UnitProjectOptions {
	environment?: 'node' | 'jsdom';
	/** Compile `.svelte.ts` modules with `svelteRunes()` so the unit suites run real runes. */
	runes?: boolean;
}

/**
 * Shared Vitest project builder for pure `.ts` model suites.
 * Defaults to the fast Node environment; packages whose unit tests touch DOM APIs
 * (e.g. i18n announcer) can override to `jsdom`.
 */
function unitProject(opts?: UnitProjectOptions): UserWorkspaceConfig {
	return {
		extends: true,
		...(opts?.runes === true ? { plugins: [svelteRunes()] } : {}),
		test: {
			name: 'unit',
			environment: opts?.environment ?? 'node',
			include: ['test/**/*.test.ts'],
			exclude: ['test/**/*.svelte.test.ts'],
		},
	};
}

interface ComponentProjectOptions {
	name?: 'components' | 'component';
	autoCleanup?: boolean;
	/** Per-test timeout for the component lane only; the unit lane keeps Vitest's default. */
	testTimeout?: number;
}

/**
 * Shared Vitest project builder for `.svelte` component suites.
 *
 * Splitting per-project (rather than per-file docblocks) lets the component lane
 * load its `@testing-library/jest-dom` and cleanup setup without leaking jsdom globals
 * into pure unit tests. `svelteTesting()` switches Vite to the `browser` export
 * condition ahead of `node` so Svelte's client `mount(...)` is resolved (not the SSR
 * build, which throws `lifecycle_function_unavailable` under jsdom) and registers
 * Testing Library's after-each unmount.
 */
function componentProject(opts: SvelteVitestOptions): UserWorkspaceConfig {
	const testing =
		opts.component?.autoCleanup === false
			? opts.svelteTesting({ autoCleanup: false })
			: opts.svelteTesting();
	return {
		extends: true,
		plugins: [opts.svelte(), testing],
		test: {
			name: opts.component?.name ?? 'components',
			environment: 'jsdom',
			include: ['test/**/*.svelte.test.ts'],
			setupFiles: ['./test/setup-component.ts'],
			...(opts.component?.testTimeout === undefined
				? {}
				: { testTimeout: opts.component.testTimeout }),
		},
	};
}

export interface CoverageThresholds {
	statements?: number;
	branches?: number;
	functions?: number;
	lines?: number;
}

export interface V8CoverageOptions {
	exclude: string[];
	thresholds?: CoverageThresholds;
}

/**
 * Shared v8 coverage configuration aggregating all projects against one gate.
 * Default thresholds match the repository-wide 85/80/85/85 standard.
 */
export function v8Coverage(opts: V8CoverageOptions) {
	return {
		provider: 'v8' as const,
		reporter: ['text', 'html'],
		include: ['src/**/*.ts'],
		exclude: opts.exclude,
		thresholds: {
			statements: opts.thresholds?.statements ?? 85,
			branches: opts.thresholds?.branches ?? 80,
			functions: opts.thresholds?.functions ?? 85,
			lines: opts.thresholds?.lines ?? 85,
		},
	};
}

export interface NodeVitestOptions {
	/** Per-test timeout for the suite; keeps Vitest's default when omitted. */
	testTimeout?: number;
	/** Setup files executed before each test file; keeps Vitest's default when omitted. */
	setupFiles?: string[];
	coverage: V8CoverageOptions;
}

/**
 * Shared Vitest configuration for pure Node packages with no Svelte components.
 * Configures the fast Node environment and aggregates v8 coverage against the
 * package's explicit thresholds.
 */
export function nodeVitestConfig(opts: NodeVitestOptions): ViteUserConfig {
	return {
		test: {
			include: ['test/**/*.test.ts'],
			environment: 'node',
			...(opts.testTimeout === undefined ? {} : { testTimeout: opts.testTimeout }),
			...(opts.setupFiles === undefined ? {} : { setupFiles: opts.setupFiles }),
			coverage: v8Coverage(opts.coverage),
		},
	};
}

export interface SvelteVitestOptions {
	/**
	 * The `@sveltejs/vite-plugin-svelte` and `@testing-library/svelte/vite` factories,
	 * imported by the package: this file resolves its own imports from the repository
	 * root, where those plugins are not installed.
	 */
	svelte: () => PluginEntry;
	svelteTesting: (opts?: { autoCleanup?: boolean }) => PluginEntry;
	unit?: UnitProjectOptions;
	component?: ComponentProjectOptions;
	coverage: V8CoverageOptions;
}

/**
 * Two Vitest projects keep the pure `.ts` suites on a fast environment while the
 * `.svelte` component suites get jsdom plus the Svelte compiler; v8 coverage
 * aggregates both projects against one gate. `src/index.ts` is a re-export barrel
 * and is always excluded from coverage.
 */
export function svelteVitestConfig(opts: SvelteVitestOptions): ViteUserConfig {
	return {
		test: {
			projects: [unitProject(opts.unit), componentProject(opts)],
			coverage: v8Coverage({
				...opts.coverage,
				exclude: ['src/index.ts', ...opts.coverage.exclude],
			}),
		},
	};
}
