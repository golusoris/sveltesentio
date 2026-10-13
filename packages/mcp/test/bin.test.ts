import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
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

describe('start script', () => {
	let client: Client | undefined;

	afterEach(async () => {
		await client?.close();
		client = undefined;
	});

	it('serves the tools over stdio with the repository root it resolves itself', async () => {
		const env = { ...process.env } as Record<string, string>;
		delete env.SVELTESENTIO_ROOT;
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: startArgs(),
			cwd: packageDir,
			env,
			stderr: 'pipe',
		});
		client = new Client({ name: 'mcp-bin-test', version: '0.0.0' });
		await client.connect(transport, { timeout: REQUEST_TIMEOUT_MS });

		const { tools } = await client.listTools(undefined, { timeout: REQUEST_TIMEOUT_MS });
		expect(tools.map((tool) => tool.name)).toContain('module_lookup');

		const res = await client.callTool(
			{ name: 'module_lookup', arguments: { name: 'core' } },
			undefined,
			{ timeout: REQUEST_TIMEOUT_MS },
		);
		expect(res.isError).not.toBe(true);
		expect((res.content as TextContent[])[0]?.text).toContain('# @sveltesentio/core');
	}, 30_000);
});
