import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerResourceSubscriptions } from '../src/subscriptions.js';
import { registerComposeSearchTool } from '../src/tools/compose-search.js';
import { registerPrincipleLookupTool } from '../src/tools/principle-lookup.js';
import { callTool, repoRoot } from './helpers.js';

describe('mcp register exports', () => {
	let client: Client | undefined;

	afterEach(async () => {
		await client?.close();
		client = undefined;
	});

	async function connect(server: McpServer): Promise<Client> {
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const c = new Client({ name: 'mcp-export-test-client', version: '0.0.0' });
		await Promise.all([c.connect(clientTransport), server.connect(serverTransport)]);
		client = c;
		return c;
	}

	describe('registerResourceSubscriptions', () => {
		it('registers subscribe capability and tracks subscriptions', async () => {
			const server = new McpServer({ name: 'subs-test', version: '0.0.1' });
			const controller = registerResourceSubscriptions(server);
			const c = await connect(server);

			expect(c.getServerCapabilities()?.resources?.subscribe).toBe(true);
			expect([...controller.subscriptions]).toEqual([]);

			// Subscribe to a known resource URI
			await c.subscribeResource({ uri: 'compose://index' });
			expect(controller.subscriptions.has('compose://index')).toBe(true);
			expect([...controller.subscriptions]).toEqual(['compose://index']);

			// Notification delivery for subscribed URI
			const received: string[] = [];
			c.setNotificationHandler(ResourceUpdatedNotificationSchema, (note) => {
				received.push(note.params.uri);
			});

			await controller.notifyResourceUpdated('compose://index');
			await vi.waitFor(() => {
				expect(received).toEqual(['compose://index']);
			});

			// Unsubscribe
			await c.unsubscribeResource({ uri: 'compose://index' });
			expect(controller.subscriptions.has('compose://index')).toBe(false);
			expect([...controller.subscriptions]).toEqual([]);
		});

		it('does not notify client for unsubscribed or unknown resource URIs', async () => {
			const server = new McpServer({ name: 'subs-test-negative', version: '0.0.1' });
			const controller = registerResourceSubscriptions(server);
			const c = await connect(server);

			const received = vi.fn();
			c.setNotificationHandler(ResourceUpdatedNotificationSchema, () => {
				received();
			});

			// Negative: notification on un-subscribed URI is a no-op
			await controller.notifyResourceUpdated('unknown://nonexistent');
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(received).not.toHaveBeenCalled();
		});
	});

	describe('registerComposeSearchTool', () => {
		it('registers compose_search tool and answers known, unknown, and empty queries', async () => {
			const server = new McpServer({ name: 'compose-test', version: '0.0.1' });
			registerComposeSearchTool(server, repoRoot);
			const c = await connect(server);

			const { tools } = await c.listTools();
			const tool = tools.find((t) => t.name === 'compose_search');
			expect(tool).toBeDefined();
			expect(tool?.name).toBe('compose_search');

			// Known query: finds existing recipe
			const known = await callTool(c, 'compose_search', { query: 'oidc' });
			expect(known.isError).toBe(false);
			expect(known.text).toContain('compose://auth-oidc');
			expect(known.text).toMatch(/match\(es\)/);

			// Boundary: limit parameter restricts results
			const bounded = await callTool(c, 'compose_search', { query: 'svelte', limit: 1 });
			expect(bounded.isError).toBe(false);
			const hits = bounded.text.split('\n').filter((l) => l.startsWith('- compose://'));
			expect(hits.length).toBeLessThanOrEqual(1);

			// Unknown query: returns no match notice without error
			const unknown = await callTool(c, 'compose_search', { query: 'zzqqxnomatchquery123' });
			expect(unknown.isError).toBe(false);
			expect(unknown.text).toMatch(/No compose recipes matched/);
			expect(unknown.text).toContain('compose://index');

			// Empty query: fails schema validation (min 1)
			const empty = await callTool(c, 'compose_search', { query: '' });
			expect(empty.isError).toBe(true);
			expect(empty.text).toMatch(/validation error/i);
		});
	});

	describe('registerPrincipleLookupTool', () => {
		it('registers principle_lookup tool and answers known, unknown, and empty queries', async () => {
			const server = new McpServer({ name: 'principle-test', version: '0.0.1' });
			registerPrincipleLookupTool(server, repoRoot);
			const c = await connect(server);

			const { tools } = await c.listTools();
			const tool = tools.find((t) => t.name === 'principle_lookup');
			expect(tool).toBeDefined();
			expect(tool?.name).toBe('principle_lookup');

			// Known query by §id: exact section returned
			const knownId = await callTool(c, 'principle_lookup', { query: '2.4' });
			expect(knownId.isError).toBe(false);
			expect(knownId.text).toContain('§2.4');

			// Known query with leading § prefix
			const prefixed = await callTool(c, 'principle_lookup', { query: '§2.4' });
			expect(prefixed.isError).toBe(false);
			expect(prefixed.text).toContain('§2.4');

			// Known query by keyword: section ranked and returned
			const knownKeyword = await callTool(c, 'principle_lookup', { query: 'runes' });
			expect(knownKeyword.isError).toBe(false);
			expect(knownKeyword.text).toContain('§2.4');

			// Unknown query by id: error response with available list
			const unknownId = await callTool(c, 'principle_lookup', { query: '99.99' });
			expect(unknownId.isError).toBe(true);
			expect(unknownId.text).toMatch(/No principle §99\.99 in docs\/principles\.md/);

			// Unknown query by keyword: error response
			const unknownKeyword = await callTool(c, 'principle_lookup', {
				query: 'zzunknownkeywordxyz',
			});
			expect(unknownKeyword.isError).toBe(true);
			expect(unknownKeyword.text).toMatch(/No principle matched 'zzunknownkeywordxyz'/);

			// Empty query: fails schema validation (min 1)
			const empty = await callTool(c, 'principle_lookup', { query: '' });
			expect(empty.isError).toBe(true);
			expect(empty.text).toMatch(/validation error/i);
		});
	});
});
