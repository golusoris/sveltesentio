import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import js from '@eslint/js';
import sentio from '@sveltesentio/core/eslint';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import sonarjs from 'eslint-plugin-sonarjs';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import type { Linter } from 'eslint';

// Files that legitimately read ambient time and are therefore exempt from
// `@sveltesentio/no-direct-time` (the rule that everything else routes through
// the injected Clock — ADR-0052). Each is the *definition site* of a clock seam
// or an explicitly-sanctioned timestamp source:
//   - core/clock.ts   — the Clock implementation itself.
//   - auth/csrf.ts    — token TTL stamping/verification (security primitive).
//   - ai/audit.ts     — audit-record timestamps (compliance trail, ADR-0045).
//   - ai/server.ts    — the LLM-proxy's default latency clock seam.
const SANCTIONED_TIME_READS = [
	'packages/core/src/clock.ts',
	'packages/auth/src/csrf.ts',
	'packages/ai/src/audit.ts',
	'packages/ai/src/server.ts',
];

const testPackageConfigs: Linter.Config[] = readdirSync(resolve(import.meta.dirname, 'packages'), {
	withFileTypes: true,
})
	.filter(
		(dirent) =>
			dirent.isDirectory() &&
			existsSync(resolve(import.meta.dirname, 'packages', dirent.name, 'tsconfig.test.json')),
	)
	.map((dirent) => ({
		files: [`packages/${dirent.name}/test/**/*.ts`],
		languageOptions: {
			parserOptions: {
				project: [`packages/${dirent.name}/tsconfig.test.json`],
				tsconfigRootDir: import.meta.dirname,
			},
		},
	}));

const config: Linter.Config[] = [
	js.configs.recommended,
	...svelte.configs['flat/recommended'],
	...svelte.configs['flat/prettier'],
	prettier,
	{
		files: ['**/*.ts', '**/*.js'],
		plugins: { '@typescript-eslint': ts },
		languageOptions: {
			parser: tsParser,
			parserOptions: { project: true, extraFileExtensions: ['.svelte'] },
		},
		rules: {
			...ts.configs['recommended-type-checked'].rules,
			// TypeScript resolves identifiers itself — incl. DOM/Node lib globals
			// (console/process/crypto/setTimeout/…) and Svelte 5 runes ($state/$effect).
			// Core no-undef/no-redeclare misfire on these and on function overloads;
			// typescript-eslint recommends delegating both to the type-checker.
			'no-undef': 'off',
			'no-redeclare': 'off',
			'@typescript-eslint/no-redeclare': 'error',
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/consistent-type-imports': 'error',
			'@typescript-eslint/restrict-template-expressions': [
				'error',
				{ allowNumber: true, allowBoolean: true, allowNever: true },
			],
			'no-console': ['error', { allow: ['warn', 'error'] }],
		},
	},
	...testPackageConfigs,
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parser: svelteParser,
			parserOptions: { parser: tsParser },
		},
		rules: {
			// Not a11y rules: eslint-plugin-svelte 3.23's flat/recommended carries 39
			// rules and none of them is an a11y rule, despite an earlier comment here
			// saying otherwise. Accessibility is covered by `svelte/valid-compile`
			// below, which surfaces the compiler's own a11y_* diagnostics, and by
			// axe-core in the component tests (@sveltesentio/testing, ADR-0031).
			'no-undef': 'off',
			'svelte/no-at-html-tags': 'error',
			'svelte/valid-compile': 'error',
		},
	},
	// --- HISS-04 complexity bound on shipped source -------------------------------
	// Praetor's HISS scanner has no TypeScript dispatch (it reads .c/.py/.go/.rs
	// only), so on this repository its invariant scan reads 3 files and skips 482.
	// HISS-04 is therefore enforced here, in the linter the repo actually runs.
	//
	// Scoped to `packages/*/src`: test files legitimately carry long `describe`
	// arrows, and a cap there would measure the suite's shape rather than the
	// shipped code's.
	{
		files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.svelte'],
		// Flat config resolves a rule's plugin from the same object the rule is in,
		// so this block declares @typescript-eslint even though the block above
		// already does.
		plugins: { '@typescript-eslint': ts, sonarjs },
		rules: {
			complexity: ['error', 10],

			// HISS-04 length. The effective policy resolves max_func_loc to 60, and
			// nothing enforced it until the six functions that exceeded it were brought
			// down (BUG-007). Blank lines and comments are skipped so documenting a
			// function cannot push it over its own cap.
			'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],

			// HISS-04 statements. The harness row caps a function at 40 statements;
			// packed lines pass both length checks, so only a statement count bounds them.
			'max-statements': ['error', 40],

			// HISS-04 cognitive complexity at the harness cap of 12. Only this rule of
			// the plugin is on; it is a devDependency and no package ships it.
			'sonarjs/cognitive-complexity': ['error', 12],

			// HISS-07 checked errors. `!` discards the undefined case that
			// `noUncheckedIndexedAccess` exists to surface, which is the unchecked
			// error this invariant names. Also free at the time of enabling.
			'@typescript-eslint/no-non-null-assertion': 'error',
		},
	},

	// --- sveltesentio cross-package invariants (@sveltesentio/core eslint plugin) -
	// Enforced on shipped package source (`packages/*/src`). Loaded from the core
	// package's TypeScript source: ESLint 10 transpiles this `.ts` config — and
	// every `.ts` it imports — through jiti, so no build artifact is required.
	{
		files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.svelte'],
		ignores: SANCTIONED_TIME_READS,
		plugins: { '@sveltesentio': sentio },
		rules: {
			'@sveltesentio/no-direct-time': 'error',
			// HISS-01: the call graph must be a DAG. Measured free before enabling —
			// zero self-recursive call sites across all 163 shipped modules — so this
			// pins the current state rather than demanding a cleanup.
			'@sveltesentio/no-recursion': 'error',
			// HISS-08's other half: `{@html}` is covered by svelte/no-at-html-tags,
			// but nothing checked the TypeScript side until this rule existed.
			'@sveltesentio/no-unsanitised-html': 'error',
		},
	},
	{
		files: ['packages/*/src/**/*.svelte'],
		plugins: { '@sveltesentio': sentio },
		rules: {
			'@sveltesentio/chart-a11y-wrapper': 'error',
		},
	},
	// --- root-level Node scripts ----------------------------------------------------
	// `scripts/*.mjs` is CI-critical logic — affected-package selection, the import-cycle
	// check, the export-target check — that nothing linted. `turbo lint` runs per package
	// and never reaches the repository root, and the pre-commit hook's glob is
	// `*.{ts,svelte,js}`, which does not match `.mjs`. The gap hid a self-comparison in
	// ci-affected.mjs's entry-point guard (`resolve(argv[1]) === resolve(argv[1])`) that
	// made the module run its CLI whenever it was merely imported; `no-self-compare`
	// reports exactly that, so the rule is enabled here rather than left to review.
	//
	// These files are plain ESM outside every tsconfig, so the type-aware parser does not
	// apply and the Node globals they use are declared instead of inferred.
	{
		files: ['scripts/**/*.mjs'],
		languageOptions: {
			globals: {
				AbortSignal: 'readonly',
				console: 'readonly',
				fetch: 'readonly',
				process: 'readonly',
				URL: 'readonly',
			},
		},
		rules: {
			'no-self-compare': 'error',
		},
	},
	// --- HISS-08 static determinism, every linted file --------------------------------
	// AGENTS.md says ESLint enforces HISS-08, and the rule binds every file: CI scripts,
	// apps and tests run code as surely as shipped source does. The rules sat in the
	// packages/*/src block until a planted `eval` in scripts/ passed `eslint scripts/`
	// (gap audit A2-9). Zero violations anywhere when widened. `no-implied-eval` is
	// included because `setTimeout('code')` evaluates a string exactly as `eval` does;
	// this block follows the type-checked set, which turns the core rule off.
	{
		files: ['**/*.ts', '**/*.js', '**/*.mjs', '**/*.cjs', '**/*.svelte'],
		rules: {
			'no-eval': 'error',
			'no-new-func': 'error',
			'no-implied-eval': 'error',
		},
	},
	// --- build-time files outside a tsconfig project ---------------------------------
	// These sit outside every package's tsconfig `include`, and there is no root
	// tsconfig.json — the shared compiler options live in tsconfig.base.json, which
	// each package extends — so `project: true` has no project to resolve for them
	// and type-aware parsing fails outright. They were never linted before because
	// `turbo lint` runs per package; the pre-commit hook lints staged files, which
	// reaches them. Lint them syntactically rather than exempting them.
	//
	// The patterns are '**/'-prefixed because each package carries its own
	// vitest.config.ts, and every package's tsconfig `include` is src/-only, so
	// those are outside a project exactly as the root ones are. The bare form
	// matched only the repository root, which surfaced the moment a commit staged
	// a package config file: "that TSConfig does not include this file".
	//
	// apps/docs/mdsvex/ holds the same shape in a different costume: a remark
	// plugin the docs build imports, written as plain ESM and deliberately not in
	// apps/docs/tsconfig.json, whose `include` is src/-only.
	{
		files: [
			'**/*.config.ts',
			'**/*.config.js',
			'eslint.config.ts',
			'vitest.shared.ts',
			'test-support/**/*.ts',
			'**/mdsvex/**/*.js',
		],
		languageOptions: {
			parserOptions: { project: false },
		},
		rules: {
			// The type-checked rule set throws outright without a program, so it is
			// turned off here rather than left to fail at load time.
			...ts.configs['disable-type-checked'].rules,
		},
	},
	// --- engine-delivered tooling ------------------------------------------------------
	// `tools/markdownlint/` and `tools/figures/` are written by `praetorctl adopt` and
	// their bytes are pinned by `praetorctl audit`, so a finding in them cannot be fixed
	// here. `turbo lint` never reaches them, but the pre-commit hook lints staged files
	// and an adoption refresh stages all of them. They are linted like the root scripts
	// rather than ignored: plain ESM and TypeScript outside every tsconfig, with the Node
	// globals they use declared.
	{
		files: ['tools/**/*.mjs', 'tools/**/*.ts'],
		languageOptions: {
			parserOptions: { project: false },
			globals: {
				Buffer: 'readonly',
				TextDecoder: 'readonly',
				URL: 'readonly',
				clearTimeout: 'readonly',
				console: 'readonly',
				process: 'readonly',
				setTimeout: 'readonly',
			},
		},
		rules: {
			...ts.configs['disable-type-checked'].rules,
		},
	},
	{
		ignores: [
			// `**/` prefixes: these patterns are resolved from the config's directory,
			// so the bare form matched only root-level build output and left every
			// package's own dist/, coverage/ and .svelte-kit/ to be linted as source.
			// That surfaced as parse errors ("TSConfig does not include this file")
			// rather than as anything actionable.
			'**/node_modules/**',
			'**/dist/**',
			'**/.svelte-kit/**',
			'**/build/**',
			'**/.turbo/**',
			'**/coverage/**',
			'**/storybook-static/**',
			// The governance engine's committed figure player (loader.js, player.js): emitted
			// bundle output, not source this repository governs; on the old path it fell under
			// `**/dist/**`.
			'tools/figures/player/**',
			// The HISS-20 fixture corpus is input to the rules, not source governed by
			// them. Its gap fixtures are deliberate violations that must stay
			// unreported, and its positives are deliberate violations that the
			// catalog's claims depend on being reportable — linting the corpus would
			// fail the build on the evidence it exists to preserve.
			'.config/hiss/testdata/**',
			// The semgrep rule fixtures are deliberate violations for the same reason.
			'.config/semgrep/testdata/**',
			// Illustrative copy-paste snippets — intentionally reference undeclared
			// identifiers (paths, edges, secret…) the consumer supplies; not compiled.
			'examples/**',
		],
	},
];

export default config;
