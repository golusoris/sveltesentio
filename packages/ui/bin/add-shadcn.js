#!/usr/bin/env node
/**
 * sveltesentio add <component>
 *
 * Thin wrapper around `npx shadcn-svelte@next add`.
 * Passes through all arguments so the full shadcn-svelte CLI is available.
 *
 * Usage (apps call this via the sveltesentio CLI or directly):
 *   npx @sveltesentio/ui add button
 *   npx @sveltesentio/ui add dialog sheet card
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.warn(`
@sveltesentio/ui — shadcn-svelte component installer

Usage:
  npx @sveltesentio/ui add <component> [components...]
  npx @sveltesentio/ui add button
  npx @sveltesentio/ui add dialog sheet card

Components are installed into your app's src/lib/components/ui/ directory.
Run this from your SvelteKit app root (where package.json lives).

All arguments are forwarded to: npx shadcn-svelte@next add
`);
  process.exit(0);
}

const command = args[0];

if (command !== 'add') {
  console.error(`Unknown command: ${command}. Only 'add' is supported.`);
  process.exit(1);
}

const components = args.slice(1);
if (components.length === 0) {
  console.error('Error: specify at least one component. Example: add button');
  process.exit(1);
}

// Verify we're in a SvelteKit app directory
const cwd = process.cwd();
const pkgPath = join(cwd, 'package.json');
if (!existsSync(pkgPath)) {
  console.error('Error: no package.json found. Run this from your SvelteKit app root.');
  process.exit(1);
}

let pkg;
try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
} catch {
  console.error('Error: could not parse package.json.');
  process.exit(1);
}

const hasSvelteKit = Boolean(
  pkg.dependencies?.['@sveltejs/kit'] ?? pkg.devDependencies?.['@sveltejs/kit'],
);
if (!hasSvelteKit) {
  console.warn(
    'Warning: @sveltejs/kit not found in dependencies. Is this a SvelteKit project?',
  );
}

// Check if components.json exists (shadcn-svelte config)
const shadcnConfig = resolve(cwd, 'components.json');
if (!existsSync(shadcnConfig)) {
  console.warn(
    'Note: components.json not found. shadcn-svelte will prompt you to initialize.',
  );
}

const componentList = components.join(' ');
const cmd = `npx shadcn-svelte@next add ${componentList}`;

console.warn(`Running: ${cmd}`);
try {
  execSync(cmd, { stdio: 'inherit', cwd });
} catch (err) {
  process.exit(1);
}
