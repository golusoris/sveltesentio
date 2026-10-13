#!/usr/bin/env node
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Runs from a checkout with no build step: node strips the types, and this hook
// maps the `.js` specifiers src/ writes for its sibling modules to the `.ts`
// files on disk. Only relative imports from a .ts file are rewritten.
// test/bin.test.ts starts the server this way.
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (context.parentURL?.endsWith('.ts') && /^\.{1,2}\/.*\.js$/.test(specifier)) {
			return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
		}
		return nextResolve(specifier, context);
	},
});

const { createSveltesentioServer } = await import('../src/index.js');

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = process.env.SVELTESENTIO_ROOT ?? resolve(here, '..', '..', '..');

const server = createSveltesentioServer({ rootDir });
const transport = new StdioServerTransport();
await server.connect(transport);
