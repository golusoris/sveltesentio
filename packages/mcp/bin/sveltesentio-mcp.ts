#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSveltesentioServer } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = process.env.SVELTESENTIO_ROOT ?? resolve(here, '..', '..', '..');

const server = createSveltesentioServer({ rootDir });
const transport = new StdioServerTransport();
await server.connect(transport);
