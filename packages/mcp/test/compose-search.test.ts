import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { callTool, connectClient, repoRoot } from './helpers.js';

describe('compose_search against the real docs/compose tree', () => {
	let client: Client;

	beforeEach(async () => {
		client = await connectClient(repoRoot);
	});

	afterEach(async () => {
		await client.close();
	});

	it('is listed with a description that points at the compose resource', async () => {
		const { tools } = await client.listTools();
		const tool = tools.find((t) => t.name === 'compose_search');
		expect(tool).toBeDefined();
		expect(tool?.description).toMatch(/compose:\/\//);
		expect(tool?.inputSchema.properties).toHaveProperty('query');
		expect(tool?.inputSchema.properties).toHaveProperty('limit');
	});

	it('finds the auth-oidc recipe when searching for "oidc"', async () => {
		const { isError, text } = await callTool(client, 'compose_search', { query: 'oidc' });
		expect(isError).toBe(false);
		expect(text).toContain('compose://auth-oidc');
		expect(text).toMatch(/match\(es\)/);
	});

	it('ranks a slug hit above an incidental body-only hit', async () => {
		// "passkeys" is a slug; the term should surface compose://passkeys first.
		const { text } = await callTool(client, 'compose_search', { query: 'passkeys' });
		const firstLine = text.split('\n').find((l) => l.startsWith('- compose://'));
		expect(firstLine).toContain('compose://passkeys');
	});

	it('honours the limit parameter', async () => {
		const { text } = await callTool(client, 'compose_search', { query: 'svelte', limit: 2 });
		const hits = text.split('\n').filter((l) => l.startsWith('- compose://'));
		expect(hits.length).toBeLessThanOrEqual(2);
	});

	it('reports no matches for a nonsense query without erroring', async () => {
		const { isError, text } = await callTool(client, 'compose_search', {
			query: 'zzqqxnomatchzz',
		});
		expect(isError).toBe(false);
		expect(text).toMatch(/No compose recipes matched/);
		expect(text).toContain('compose://index');
	});

	it('rejects an empty query via the zod schema', async () => {
		const { isError, text } = await callTool(client, 'compose_search', { query: '' });
		expect(isError).toBe(true);
		expect(text).toMatch(/validation error/i);
	});

	it('rejects a limit above the schema ceiling', async () => {
		const { isError } = await callTool(client, 'compose_search', { query: 'oidc', limit: 999 });
		expect(isError).toBe(true);
	});
});

describe('compose_search against a synthetic corpus', () => {
	let root: string;
	let client: Client;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'mcp-compose-search-'));
		await mkdir(join(root, 'docs', 'compose'), { recursive: true });
		await writeFile(
			join(root, 'docs', 'compose', 'alpha.md'),
			'# Alpha\nThis recipe mentions widgets and widgets again.\n',
		);
		await writeFile(
			join(root, 'docs', 'compose', 'beta.md'),
			'# Beta\nA single widget reference here.\n',
		);
		await writeFile(join(root, 'docs', 'compose', 'notes.txt'), 'widget widget widget');
		client = await connectClient(root);
	});

	afterEach(async () => {
		await client.close();
		await rm(root, { recursive: true, force: true });
	});

	it('ranks higher body-frequency first and ignores non-markdown files', async () => {
		const { text } = await callTool(client, 'compose_search', { query: 'widget' });
		const hits = text.split('\n').filter((l) => l.startsWith('- compose://'));
		expect(hits[0]).toContain('compose://alpha');
		expect(hits[1]).toContain('compose://beta');
		// notes.txt is not markdown — it never appears
		expect(text).not.toContain('notes');
	});

	it('attaches a snippet line drawn from the first matching body line', async () => {
		const { text } = await callTool(client, 'compose_search', { query: 'widget' });
		expect(text).toContain('mentions widgets');
	});

	it('truncates an over-long snippet line to 160 chars with an ellipsis', async () => {
		const longLine = `widget ${'x'.repeat(400)}`;
		await writeFile(join(root, 'docs', 'compose', 'long.md'), `# Long\n${longLine}\n`);
		const { text } = await callTool(client, 'compose_search', { query: 'widget' });
		const snippet = text
			.split('\n')
			.map((l) => l.trim())
			.find((l) => l.startsWith('widget x'));
		expect(snippet).toBeDefined();
		expect(snippet?.endsWith('...')).toBe(true);
		expect(snippet?.length).toBe(160);
	});

	it('matches multiple whitespace-separated terms case-insensitively', async () => {
		const { text } = await callTool(client, 'compose_search', { query: 'WIDGET Beta' });
		// beta gets a slug hit (5) + body hit; alpha gets body hits only
		const hits = text.split('\n').filter((l) => l.startsWith('- compose://'));
		expect(hits.some((h) => h.includes('compose://beta'))).toBe(true);
		expect(hits.some((h) => h.includes('compose://alpha'))).toBe(true);
	});

	it('de-duplicates repeated query terms when scoring', async () => {
		const single = await callTool(client, 'compose_search', { query: 'widget' });
		const repeated = await callTool(client, 'compose_search', { query: 'widget widget widget' });
		// The header echoes the raw query, but the ranked hit lines (with scores)
		// must be identical — repetition does not inflate a recipe's score.
		const hitLines = (text: string) =>
			text
				.split('\n')
				.filter((l) => l.startsWith('- compose://'))
				.join('\n');
		expect(hitLines(repeated.text)).toBe(hitLines(single.text));
	});
});
