import { describe, expect, it } from 'vitest';
import { compile } from 'tailwindcss';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface ScannedConsumer {
	outputCss: string;
	sources: Array<{ base: string; pattern: string; negated: boolean }>;
	candidates: string[];
}

const IO_TIMEOUT_MS = 5000;
const MAX_SCANNED_FILES = 300;

function isFileNegated(
	fullPath: string,
	baseDir: string,
	negatedPatterns: readonly string[],
): boolean {
	const rel = relative(baseDir, fullPath);
	for (const pattern of negatedPatterns) {
		if (pattern.includes('.stories.svelte') && rel.includes('.stories.svelte')) {
			return true;
		}
		if (pattern.includes('.test.ts') && rel.endsWith('.test.ts')) {
			return true;
		}
	}
	return false;
}

async function extractTokensFromFile(filePath: string): Promise<string[]> {
	const content = await readFile(filePath, {
		encoding: 'utf8',
		signal: AbortSignal.timeout(IO_TIMEOUT_MS),
	});
	const tokens = content.match(/[a-zA-Z0-9_\-/[\]:]+/g);
	return tokens ?? [];
}

async function scanSources(
	sources: ReadonlyArray<{ base: string; pattern: string; negated: boolean }>,
): Promise<string[]> {
	const positive = sources.filter((s) => !s.negated);
	const negatedPatterns = sources.filter((s) => s.negated).map((s) => s.pattern);
	const candidates = new Set<string>();
	let fileCount = 0;

	for (const src of positive) {
		const stack = [src.base];
		while (stack.length > 0 && fileCount < MAX_SCANNED_FILES) {
			const current = stack.pop();
			if (current === undefined) break;

			let entries;
			try {
				entries = await readdir(current, { withFileTypes: true });
			} catch {
				continue;
			}

			for (const ent of entries) {
				const full = join(current, ent.name);
				if (ent.isDirectory()) {
					if (ent.name !== 'node_modules' && !ent.name.startsWith('.')) {
						stack.push(full);
					}
				} else if (ent.isFile()) {
					if (isFileNegated(full, src.base, negatedPatterns)) continue;
					fileCount += 1;
					const tokens = await extractTokensFromFile(full);
					for (const tok of tokens) candidates.add(tok);
				}
			}
		}
	}

	return Array.from(candidates);
}

async function compileConsumerStylesheet(consumerCss: string): Promise<ScannedConsumer> {
	const twEntry = require.resolve('tailwindcss/index.css');

	const compiled = await compile(consumerCss, {
		base: process.cwd(),
		loadStylesheet: async (id: string, base: string) => {
			let targetPath: string;
			if (id === 'tailwindcss') {
				targetPath = twEntry;
			} else if (id.startsWith('@sveltesentio/ui/')) {
				targetPath = require.resolve(id);
			} else {
				targetPath = resolve(base, id);
			}
			const content = await readFile(targetPath, {
				encoding: 'utf8',
				signal: AbortSignal.timeout(IO_TIMEOUT_MS),
			});
			return {
				path: targetPath,
				base: dirname(targetPath),
				content,
			};
		},
	});

	const candidates = await scanSources(compiled.sources);
	const outputCss = compiled.build(candidates);

	return {
		outputCss,
		sources: compiled.sources,
		candidates,
	};
}

describe('Tailwind v4 consumer source scanning', () => {
	it('resolves @sveltesentio/ui/tailwind.css through package.json exports', () => {
		const resolved = require.resolve('@sveltesentio/ui/tailwind.css');
		expect(resolved).toMatch(/packages\/ui\/src\/tailwind\.css$/);
	});

	it('refuses unexported CSS subpaths via package.json exports', () => {
		expect(() => require.resolve('@sveltesentio/ui/unexported.css')).toThrow(
			/Package subpath '\.\/unexported\.css' is not defined by "exports"/,
		);
	});

	it('emits dialog utility rules when consumer imports @sveltesentio/ui/tailwind.css', async () => {
		const consumerCss = ['@import "tailwindcss";', '@import "@sveltesentio/ui/tailwind.css";'].join(
			'\n',
		);

		const result = await compileConsumerStylesheet(consumerCss);

		expect(result.sources.length).toBeGreaterThan(0);
		expect(result.sources[0]?.pattern).toBe('.');
		expect(result.candidates).toContain('bg-black/80');
		expect(result.candidates).toContain('top-1/2');

		expect(result.outputCss).toContain('.bg-black\\/80');
		expect(result.outputCss).toContain('.top-1\\/2');
	});

	it('omits dialog utility rules when consumer stylesheet lacks the entry (red gap proof)', async () => {
		const consumerCss = '@import "tailwindcss";';

		const result = await compileConsumerStylesheet(consumerCss);

		expect(result.sources).toEqual([]);
		expect(result.candidates).not.toContain('bg-black/80');
		expect(result.candidates).not.toContain('top-1/2');

		expect(result.outputCss).not.toContain('.bg-black\\/80');
		expect(result.outputCss).not.toContain('.top-1\\/2');
	});

	it('excludes story files via @source not directive', async () => {
		const consumerCss = ['@import "tailwindcss";', '@import "@sveltesentio/ui/tailwind.css";'].join(
			'\n',
		);

		const result = await compileConsumerStylesheet(consumerCss);
		const negated = result.sources.filter((s) => s.negated);
		expect(negated.some((s) => s.pattern.includes('.stories.svelte'))).toBe(true);
	});
});
