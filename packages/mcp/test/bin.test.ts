import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { TextContent } from './helpers.js';

// Runs the package's `start` script the way `pnpm --filter @sveltesentio/mcp start`
// does — node on bin/sveltesentio-mcp.ts, no build step — and drives it over
// stdio. The README tells clients to launch the server this way, so a start
// script that cannot load src/ fails here rather than in a client's log.

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REQUEST_TIMEOUT_MS = 20_000;

/** The `start` script's node arguments, read from package.json. */
function startArgs(): string[] {
	const pkg = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8')) as {
		scripts?: Record<string, string>;
	};
	const [command, ...args] = (pkg.scripts?.start ?? '').split(' ');
	expect(command).toBe('node');
	return args;
}

/** Tool names with their required input fields, sorted by name. */
function toolListing(tools: Tool[]): { name: string; required: string[] }[] {
	return tools
		.map((tool) => ({ name: tool.name, required: tool.inputSchema.required ?? [] }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Starts the server through the `start` script and collects everything it writes to stderr. */
async function connectStartClient(): Promise<{ client: Client; readStderr: () => string }> {
	const env = { ...process.env } as Record<string, string>;
	delete env.SVELTESENTIO_ROOT;
	const stderrChunks: Buffer[] = [];
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: startArgs(),
		cwd: packageDir,
		env,
		stderr: 'pipe',
	});
	// With stderr: 'pipe' the transport hands out the stream before start(), so
	// nothing the child writes during startup is missed.
	expect(transport.stderr).not.toBeNull();
	transport.stderr?.on('data', (chunk: Buffer | string) => {
		stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	});
	const client = new Client({ name: 'mcp-bin-test', version: '0.0.0' });
	await client.connect(transport, { timeout: REQUEST_TIMEOUT_MS });
	return { client, readStderr: () => Buffer.concat(stderrChunks).toString('utf8') };
}

describe('start script', () => {
	let client: Client | undefined;
	let readStderr: (() => string) | undefined;

	afterEach(async () => {
		await client?.close();
		client = undefined;
		readStderr = undefined;
	});

	it('serves the tools over stdio with the repository root it resolves itself', async () => {
		({ client, readStderr } = await connectStartClient());

		const { tools } = await client.listTools(undefined, { timeout: REQUEST_TIMEOUT_MS });
		expect(tools.map((tool) => tool.name)).toContain('module_lookup');

		const res = await client.callTool(
			{ name: 'module_lookup', arguments: { name: 'core' } },
			undefined,
			{ timeout: REQUEST_TIMEOUT_MS },
		);
		expect(res.isError).not.toBe(true);
		expect((res.content as TextContent[])[0]?.text).toContain('# @sveltesentio/core');
		expect(readStderr()).toBe('');
	}, 30_000);

	it('lists tools with stable required-field metadata', async () => {
		({ client } = await connectStartClient());
		const { tools } = await client.listTools(undefined, { timeout: REQUEST_TIMEOUT_MS });
		expect(toolListing(tools)).toMatchInlineSnapshot(`
			[
			  {
			    "name": "compose_search",
			    "required": [
			      "query",
			    ],
			  },
			  {
			    "name": "module_lookup",
			    "required": [
			      "name",
			    ],
			  },
			  {
			    "name": "principle_lookup",
			    "required": [
			      "query",
			    ],
			  },
			]
		`);
	}, 30_000);

	// The SDK's CallTool handler catches its own "not found" McpError and returns
	// it as a tool error result, so the call resolves rather than rejects.
	it('answers an unknown tool name with a tool error that names the tool', async () => {
		({ client } = await connectStartClient());
		const res = await client.callTool({ name: 'no_such_tool', arguments: {} }, undefined, {
			timeout: REQUEST_TIMEOUT_MS,
		});
		expect(res.isError).toBe(true);
		expect((res.content as TextContent[])[0]?.text).toMatch(/Tool no_such_tool not found/);
	}, 30_000);

	it('module_lookup rejects an empty name via input validation', async () => {
		({ client } = await connectStartClient());
		const res = await client.callTool(
			{ name: 'module_lookup', arguments: { name: '' } },
			undefined,
			{ timeout: REQUEST_TIMEOUT_MS },
		);
		expect(res.isError).toBe(true);
		expect((res.content as TextContent[])[0]?.text).toMatch(/validation error/i);
	}, 30_000);

	it('module_lookup reports an error when the package name is unknown', async () => {
		({ client } = await connectStartClient());
		const res = await client.callTool(
			{ name: 'module_lookup', arguments: { name: 'does-not-exist-gap19' } },
			undefined,
			{ timeout: REQUEST_TIMEOUT_MS },
		);
		expect(res.isError).toBe(true);
		expect((res.content as TextContent[])[0]?.text).toMatch(
			/package 'does-not-exist-gap19' not found under packages\//,
		);
	}, 30_000);
});
