import { afterEach, beforeEach, expect } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
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
	rootDir: string,
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
	args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
	const res = await client.callTool({ name, arguments: args });
	const content = res.content as TextContent[];
	return { isError: res.isError === true, text: content[0]?.text ?? '' };
}

/**
 * Lifecycle helper connecting a real client to an in-memory MCP server rooted
 * at the repository root for each test in the enclosing describe block.
 */
export function useRealServer(): { readonly client: Client } {
	let client: Client;

	beforeEach(async () => {
		client = await connectClient(repoRoot);
	});

	afterEach(async () => {
		await client.close();
	});

	return {
		get client() {
			return client;
		},
	};
}

/**
 * Lifecycle helper creating an ephemeral directory tree, booting an in-memory
 * MCP server against it, and cleaning both up after each test.
 */
export function useSyntheticServer(
	prefix: string,
	subdirs: readonly string[] = [],
	seed?: (root: string) => Promise<void>,
): { readonly root: string; readonly client: Client } {
	let root: string;
	let client: Client;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), prefix));
		for (const dir of subdirs) {
			await mkdir(join(root, dir), { recursive: true });
		}
		if (seed) {
			await seed(root);
		}
		client = await connectClient(root);
	});

	afterEach(async () => {
		await client.close();
		await rm(root, { recursive: true, force: true });
	});

	return {
		get root() {
			return root;
		},
		get client() {
			return client;
		},
	};
}

/** Parses markdown index output `- slug` lines into slug strings. */
export function parseIndexSlugs(indexText: string): string[] {
	return indexText.split('\n').map((line) => line.replace(/^- /, ''));
}

/** Asserts that slugs are sorted matching `${slug}.md` code-unit ordering. */
export function expectSortedByFilename(slugs: readonly string[]): void {
	const byFilename = [...slugs].sort((a, b) => {
		const fa = `${a}.md`;
		const fb = `${b}.md`;
		return fa < fb ? -1 : fa > fb ? 1 : 0;
	});
	expect(slugs).toEqual(byFilename);
}

/** Asserts standard markdown content shape and non-empty text. */
export function expectMarkdownContent(c: ResourceContent): void {
	expect(c.mimeType).toBe('text/markdown');
	expect(c.text.length).toBeGreaterThan(0);
}
