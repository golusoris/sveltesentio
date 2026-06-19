import { afterEach, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createSveltesentioServer } from '../src/index.js';
import { connectClient, repoRoot } from './helpers.js';

describe('createSveltesentioServer', () => {
	let client: Client | undefined;

	afterEach(async () => {
		await client?.close();
		client = undefined;
	});

	it('returns a server instance with the default name/version applied', () => {
		const server = createSveltesentioServer({ rootDir: repoRoot });
		const info = (server.server as unknown as { _serverInfo: { name: string; version: string } })
			._serverInfo;
		expect(info.name).toBe('sveltesentio');
		expect(info.version).toBe('0.0.1');
	});

	it('honours custom name/version options', () => {
		const server = createSveltesentioServer({
			rootDir: repoRoot,
			name: 'custom-mcp',
			version: '9.9.9',
		});
		const info = (server.server as unknown as { _serverInfo: { name: string; version: string } })
			._serverInfo;
		expect(info.name).toBe('custom-mcp');
		expect(info.version).toBe('9.9.9');
	});

	it('registers exactly the three index resources (templated ones are not listed)', async () => {
		client = await connectClient(repoRoot);
		const { resources } = await client.listResources();
		const uris = resources.map((r) => r.uri).sort();
		expect(uris).toEqual(['adr://index', 'compliance://index', 'compose://index']);
	});

	it('registers the module_lookup tool with a described input schema', async () => {
		client = await connectClient(repoRoot);
		const { tools } = await client.listTools();
		const moduleLookup = tools.find((t) => t.name === 'module_lookup');
		expect(moduleLookup).toBeDefined();
		expect(moduleLookup?.description).toMatch(/AGENTS\.md/);
		expect(moduleLookup?.inputSchema.properties).toHaveProperty('name');
	});

	it('registers exactly the three tools with described input schemas', async () => {
		client = await connectClient(repoRoot);
		const { tools } = await client.listTools();
		expect(tools.map((t) => t.name).sort()).toEqual([
			'compose_search',
			'module_lookup',
			'principle_lookup',
		]);
		for (const tool of tools) {
			expect(typeof tool.description).toBe('string');
			expect(tool.description?.length ?? 0).toBeGreaterThan(0);
		}
	});

	it('advertises the resources.subscribe capability', async () => {
		client = await connectClient(repoRoot);
		const caps = client.getServerCapabilities();
		expect(caps?.resources?.subscribe).toBe(true);
	});
});
