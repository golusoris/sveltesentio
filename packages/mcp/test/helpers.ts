import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSveltesentioServer, createSveltesentioServerWith } from '../src/index.js';
import type { SubscriptionController } from '../src/index.js';

/** Absolute path to the monorepo root (where docs/ and packages/ live). */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export interface TextContent {
	type: 'text';
	text: string;
}

export interface ResourceContent {
	uri: string;
	mimeType?: string;
	text: string;
}

/**
 * Boot a sveltesentio MCP server rooted at `rootDir` and return a connected
 * client driving it over an in-memory transport pair. Caller must `close()`.
 */
export async function connectClient(rootDir: string): Promise<Client> {
	const server = createSveltesentioServer({ rootDir });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'mcp-test-client', version: '0.0.0' });
	await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
	return client;
}

/**
 * Like {@link connectClient} but also surfaces the server's subscription
 * controller, so a test can drive `resources/updated` notifications end-to-end.
 */
export async function connectClientWith(
	rootDir: string
): Promise<{ client: Client; subscriptions: SubscriptionController }> {
	const { server, subscriptions } = createSveltesentioServerWith({ rootDir });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'mcp-test-client', version: '0.0.0' });
	await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
	return { client, subscriptions };
}

/** Read a resource and return its first content entry, typed as text. */
export async function readText(client: Client, uri: string): Promise<ResourceContent> {
	const res = await client.readResource({ uri });
	return res.contents[0] as unknown as ResourceContent;
}

/** Call a tool and return { isError, text } from its first text content block. */
export async function callTool(
	client: Client,
	name: string,
	args: Record<string, unknown>
): Promise<{ isError: boolean; text: string }> {
	const res = await client.callTool({ name, arguments: args });
	const content = res.content as TextContent[];
	return { isError: res.isError === true, text: content[0]?.text ?? '' };
}
