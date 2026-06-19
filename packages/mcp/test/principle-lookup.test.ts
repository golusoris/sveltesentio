import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { callTool, connectClient, repoRoot } from './helpers.js';
import { parseSections } from '../src/tools/principle-lookup.js';

describe('parseSections', () => {
	it('splits a principles doc into §N.M sections in order', () => {
		const md = [
			'# Title',
			'intro line',
			'## §2.1 First rule',
			'body of one',
			'',
			'## §2.10 Tenth rule',
			'body of ten',
		].join('\n');
		const sections = parseSections(md);
		expect(sections.map((s) => s.id)).toEqual(['2.1', '2.10']);
		expect(sections[0]?.title).toBe('§2.1 First rule');
		expect(sections[0]?.body).toContain('body of one');
		// preamble before the first heading is not attributed to any section
		expect(sections[0]?.body).not.toContain('intro line');
		expect(sections[1]?.body).toContain('body of ten');
	});

	it('returns an empty list when there are no matching headings', () => {
		expect(parseSections('# just a title\nno sections here')).toEqual([]);
	});
});

describe('principle_lookup against the real docs/principles.md', () => {
	let client: Client;

	beforeEach(async () => {
		client = await connectClient(repoRoot);
	});

	afterEach(async () => {
		await client.close();
	});

	it('is listed with a query input schema', async () => {
		const { tools } = await client.listTools();
		const tool = tools.find((t) => t.name === 'principle_lookup');
		expect(tool).toBeDefined();
		expect(tool?.inputSchema.properties).toHaveProperty('query');
	});

	it('resolves a bare id like "2.4" to the runes section', async () => {
		const { isError, text } = await callTool(client, 'principle_lookup', { query: '2.4' });
		expect(isError).toBe(false);
		expect(text).toMatch(/^## §2\.4/);
		expect(text).toContain('runes');
	});

	it('resolves a §-prefixed id like "§2.2"', async () => {
		const { isError, text } = await callTool(client, 'principle_lookup', { query: '§2.2' });
		expect(isError).toBe(false);
		expect(text).toMatch(/^## §2\.2/);
		expect(text).toContain('OWASP');
	});

	it('resolves the two-digit id "2.10" (not confused with "2.1")', async () => {
		const { isError, text } = await callTool(client, 'principle_lookup', { query: '2.10' });
		expect(isError).toBe(false);
		expect(text).toMatch(/^## §2\.10/);
	});

	it('falls back to keyword search when the query is not an id', async () => {
		const { isError, text } = await callTool(client, 'principle_lookup', { query: 'runes' });
		expect(isError).toBe(false);
		expect(text).toMatch(/§2\.4/);
		expect(text).toContain('Other matches');
	});

	it('errors with the available id list for an unknown id', async () => {
		const { isError, text } = await callTool(client, 'principle_lookup', { query: '2.99' });
		expect(isError).toBe(true);
		expect(text).toMatch(/No principle §2\.99/);
		expect(text).toContain('§2.1');
	});

	it('errors for a keyword that matches no section', async () => {
		const { isError, text } = await callTool(client, 'principle_lookup', {
			query: 'zzqqxnomatch',
		});
		expect(isError).toBe(true);
		expect(text).toMatch(/No principle matched/);
	});

	it('rejects an empty query via the zod schema', async () => {
		const { isError, text } = await callTool(client, 'principle_lookup', { query: '' });
		expect(isError).toBe(true);
		expect(text).toMatch(/validation error/i);
	});
});

describe('principle_lookup against a synthetic principles doc', () => {
	let root: string;
	let client: Client;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'mcp-principle-'));
		await mkdir(join(root, 'docs'), { recursive: true });
		client = await connectClient(root);
	});

	afterEach(async () => {
		await client.close();
		await rm(root, { recursive: true, force: true });
	});

	it('returns a single keyword match with no "Other matches" footer', async () => {
		await writeFile(
			join(root, 'docs', 'principles.md'),
			['## §2.1 Solo', 'a unique marker word here', '', '## §2.2 Other', 'nothing relevant'].join(
				'\n',
			),
		);
		const { isError, text } = await callTool(client, 'principle_lookup', { query: 'unique' });
		expect(isError).toBe(false);
		expect(text).toContain('§2.1 Solo');
		expect(text).not.toContain('Other matches');
	});

	it('reports an empty available id list when the doc has no sections', async () => {
		await writeFile(join(root, 'docs', 'principles.md'), '# nothing structured here');
		const { isError, text } = await callTool(client, 'principle_lookup', { query: '2.1' });
		expect(isError).toBe(true);
		expect(text).toMatch(/Available: $/);
	});
});
