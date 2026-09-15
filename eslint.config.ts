import js from '@eslint/js';
import sentio from '@sveltesentio/core/eslint';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
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
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tsParser },
    },
    rules: {
      // a11y rules are included in eslint-plugin-svelte flat/recommended
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
    rules: {
      complexity: ['error', 10],
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
    },
  },
  {
    files: ['packages/*/src/**/*.svelte'],
    plugins: { '@sveltesentio': sentio },
    rules: {
      '@sveltesentio/chart-a11y-wrapper': 'error',
    },
  },
  // --- root-level config files ---------------------------------------------------
  // These sit outside every package's tsconfig `include`, and there is no root
  // tsconfig.json — the shared compiler options live in tsconfig.base.json, which
  // each package extends — so `project: true` has no project to resolve for them
  // and type-aware parsing fails outright. They were never linted before because
  // `turbo lint` runs per package; the pre-commit hook lints staged files, which
  // reaches them. Lint them syntactically rather than exempting them.
  {
    files: ['*.config.ts', '*.config.js', 'eslint.config.ts'],
    languageOptions: {
      parserOptions: { project: false },
    },
    rules: {
      // The type-checked rule set throws outright without a program, so it is
      // turned off here rather than left to fail at load time.
      ...ts.configs['disable-type-checked'].rules,
    },
  },
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.svelte-kit/**',
      'build/**',
      '.turbo/**',
      'coverage/**',
      // Illustrative copy-paste snippets — intentionally reference undeclared
      // identifiers (paths, edges, secret…) the consumer supplies; not compiled.
      'examples/**',
    ],
  },
];

export default config;
