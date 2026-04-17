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
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
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
