import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { callTool, connectClient, repoRoot } from './helpers.js';

describe('module_lookup against the real packages/ tree', () => {
	let client: Client;

	beforeEach(async () => {
		client = await connectClient(repoRoot);
	});

	afterEach(async () => {
		await client.close();
	});

	it('returns AGENTS.md + sub-exports for a real package by short name', async () => {
		const { isError, text } = await callTool(client, 'module_lookup', { name: 'core' });
		expect(isError).toBe(false);
		expect(text).toContain('# @sveltesentio/core');
		expect(text).toContain('## Sub-exports (from package.json)');
		expect(text).toContain('## AGENTS.md');
		expect(text).toContain('```json');
	});

	it('strips the @sveltesentio/ prefix and resolves the same package', async () => {
		const short = await callTool(client, 'module_lookup', { name: 'ui' });
		const full = await callTool(client, 'module_lookup', { name: '@sveltesentio/ui' });
		expect(short.text).toBe(full.text);
		expect(full.isError).toBe(false);
	});

	it('reports an error listing available packages when the package is unknown', async () => {
		const { isError, text } = await callTool(client, 'module_lookup', { name: 'does-not-exist' });
		expect(isError).toBe(true);
		expect(text).toMatch(/package 'does-not-exist' not found under packages\//);
		// the available list is sorted and includes known packages
		expect(text).toContain('core');
		expect(text).toContain('ui');
	});

	it('rejects an empty name via the zod input schema', async () => {
		const { isError, text } = await callTool(client, 'module_lookup', { name: '' });
		expect(isError).toBe(true);
		expect(text).toMatch(/validation error/i);
	});
});

describe('module_lookup against a synthetic packages/ tree', () => {
	let root: string;
	let client: Client;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'mcp-lookup-'));
		await mkdir(join(root, 'packages'), { recursive: true });
		client = await connectClient(root);
	});

	afterEach(async () => {
		await client.close();
		await rm(root, { recursive: true, force: true });
	});

	it('renders the exports block from package.json', async () => {
		const pkgDir = join(root, 'packages', 'widget');
		await mkdir(pkgDir);
		await writeFile(
			join(pkgDir, 'package.json'),
			JSON.stringify({ name: '@sveltesentio/widget', exports: { '.': './src/index.ts' } })
		);
		await writeFile(join(pkgDir, 'AGENTS.md'), '# widget agents');
		const { isError, text } = await callTool(client, 'module_lookup', { name: 'widget' });
		expect(isError).toBe(false);
		expect(text).toContain('"./src/index.ts"');
		expect(text).toContain('# widget agents');
	});

	it('falls back to placeholders when AGENTS.md and exports are absent', async () => {
		const pkgDir = join(root, 'packages', 'bare');
		await mkdir(pkgDir);
		await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: '@sveltesentio/bare' }));
		const { isError, text } = await callTool(client, 'module_lookup', { name: 'bare' });
		expect(isError).toBe(false);
		expect(text).toContain('(no AGENTS.md)');
		// no exports field => empty object literal in the json block
		expect(text).toContain('```json\n{}\n```');
	});

	it('treats a missing package.json as an empty exports object', async () => {
		const pkgDir = join(root, 'packages', 'empty-pkg');
		await mkdir(pkgDir);
		const { isError, text } = await callTool(client, 'module_lookup', { name: 'empty-pkg' });
		expect(isError).toBe(false);
		expect(text).toContain('```json\n{}\n```');
		expect(text).toContain('(no AGENTS.md)');
	});

	it('surfaces a JSON parse failure as a tool error when package.json is malformed', async () => {
		const pkgDir = join(root, 'packages', 'broken');
		await mkdir(pkgDir);
		await writeFile(join(pkgDir, 'package.json'), '{ this is not json');
		const { isError, text } = await callTool(client, 'module_lookup', { name: 'broken' });
		expect(isError).toBe(true);
		expect(text).toMatch(/JSON/i);
	});

	it('lists an empty available set when packages/ has no entries', async () => {
		const { isError, text } = await callTool(client, 'module_lookup', { name: 'anything' });
		expect(isError).toBe(true);
		expect(text).toMatch(/not found under packages\/\. Available: $/);
	});
});
