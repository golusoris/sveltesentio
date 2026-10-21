import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	expectMarkdownContent,
	expectSortedByFilename,
	parseIndexSlugs,
	readText,
	useRealServer,
	useSyntheticServer,
} from './helpers.js';

describe('resources against the real docs/ tree', () => {
	const server = useRealServer();

	describe('adr resource', () => {
		it('adr://index serves the docs/adr/README.md markdown', async () => {
			const c = await readText(server.client, 'adr://index');
			expect(c.uri).toBe('adr://index');
			expectMarkdownContent(c);
		});

		it('adr://1 resolves a zero-padded ADR number to its file', async () => {
			const c = await readText(server.client, 'adr://1');
			// docs/adr/0001-zod-v4-floor.md is the canonical first ADR
			expect(c.text).toMatch(/ADR-0001/);
			expect(c.mimeType).toBe('text/markdown');
		});

		it('adr://0001 (already padded) resolves to the same file as adr://1', async () => {
			const padded = await readText(server.client, 'adr://0001');
			const unpadded = await readText(server.client, 'adr://1');
			expect(padded.text).toBe(unpadded.text);
		});

		it('throws when an ADR number has no matching file', async () => {
			await expect(server.client.readResource({ uri: 'adr://9999' })).rejects.toThrow(
				/ADR 9999 not found/,
			);
		});
	});

	describe('compliance resource', () => {
		it('compliance://index lists every .md slug, README included', async () => {
			const c = await readText(server.client, 'compliance://index');
			const slugs = parseIndexSlugs(c.text);
			expect(slugs).toContain('owasp-asvs-l2');
			expect(slugs).toContain('wcag-2.2-aa');
			expect(slugs).toContain('README');
			// no .md extension leaks into the index
			expect(c.text).not.toMatch(/\.md/);
			// ordered by the sorted .md filenames the slugs were derived from
			// (default code-unit sort on `${slug}.md`, mirroring the resource impl)
			expectSortedByFilename(slugs);
		});

		it('compliance://<slug> returns the markdown body for a real checklist', async () => {
			const c = await readText(server.client, 'compliance://owasp-asvs-l2');
			expectMarkdownContent(c);
		});

		it('rejects path-traversal slugs containing ".."', async () => {
			await expect(server.client.readResource({ uri: 'compliance://..' })).rejects.toThrow(
				/Invalid compliance slug/,
			);
		});

		it('surfaces ENOENT when a well-formed slug has no file', async () => {
			await expect(
				server.client.readResource({ uri: 'compliance://no-such-checklist' }),
			).rejects.toThrow(/ENOENT/);
		});
	});

	describe('compose resource', () => {
		it('compose://index lists every recipe slug', async () => {
			const c = await readText(server.client, 'compose://index');
			const slugs = parseIndexSlugs(c.text);
			expect(slugs).toContain('auth-oidc');
			expect(slugs.length).toBeGreaterThan(5);
			expectSortedByFilename(slugs);
		});

		it('compose://<slug> returns the markdown body for a real recipe', async () => {
			const c = await readText(server.client, 'compose://auth-oidc');
			expectMarkdownContent(c);
		});

		it('rejects slugs containing ".." via the handler guard', async () => {
			await expect(server.client.readResource({ uri: 'compose://a..b' })).rejects.toThrow(
				/Invalid compose slug/,
			);
		});

		it('a literal slash is rejected by the URI-template matcher before the handler', async () => {
			// The {slug} template only matches a single path segment, so `a/b`
			// never reaches the handler; the SDK rejects it as an unknown resource.
			await expect(server.client.readResource({ uri: 'compose://a/b' })).rejects.toThrow(/-32602/);
		});

		it('surfaces ENOENT when a well-formed slug has no file', async () => {
			await expect(server.client.readResource({ uri: 'compose://nope-xyz' })).rejects.toThrow(
				/ENOENT/,
			);
		});
	});
});

describe('resources against a synthetic docs/ tree', () => {
	const server = useSyntheticServer('mcp-resources-', [
		'docs/adr',
		'docs/compose',
		'docs/compliance',
	]);

	it('compose://index is an empty string when no recipes exist', async () => {
		const c = await readText(server.client, 'compose://index');
		expect(c.text).toBe('');
	});

	it('compose://index ignores non-markdown files', async () => {
		await writeFile(join(server.root, 'docs', 'compose', 'notes.txt'), 'ignore me');
		await writeFile(join(server.root, 'docs', 'compose', 'alpha.md'), '# alpha');
		const c = await readText(server.client, 'compose://index');
		expect(c.text).toBe('- alpha');
	});

	it('adr://index throws when README.md is missing from docs/adr', async () => {
		await expect(server.client.readResource({ uri: 'adr://index' })).rejects.toThrow(/ENOENT/);
	});

	it('adr://<n> matches the first file whose name starts with the padded number', async () => {
		await writeFile(join(server.root, 'docs', 'adr', '0042-answer.md'), '# the answer');
		const c = await readText(server.client, 'adr://42');
		expect(c.text).toBe('# the answer');
	});

	it('compliance://index sorts slugs deterministically', async () => {
		await writeFile(join(server.root, 'docs', 'compliance', 'zeta.md'), 'z');
		await writeFile(join(server.root, 'docs', 'compliance', 'alpha.md'), 'a');
		const c = await readText(server.client, 'compliance://index');
		expect(c.text).toBe('- alpha\n- zeta');
	});
});
