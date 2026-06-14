import js from '@eslint/js';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import svelteParser from 'svelte-eslint-parser';

/** @type {import('eslint').Linter.Config[]} */
export default [
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
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.svelte-kit/**',
      'build/**',
      '.turbo/**',
      'coverage/**',
    ],
  },
];
