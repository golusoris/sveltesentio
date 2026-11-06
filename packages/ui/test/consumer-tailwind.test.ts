import { describe, expect, it } from 'vitest';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

interface ScannedConsumer {
	outputCss: string;
	sources: Array<{ base: string; pattern: string; negated: boolean }>;
	candidates: string[];
}

const IO_TIMEOUT_MS = 5000;

async function compileConsumerStylesheet(
	consumerCss: string,
	base: string = dirname(require.resolve('@sveltesentio/ui/tailwind.css')),
): Promise<ScannedConsumer> {
	const twEntry = require.resolve('tailwindcss/index.css');

	const compiled = await compile(consumerCss, {
		base,
		loadStylesheet: async (id: string, loadBase: string) => {
			let targetPath: string;
			if (id === 'tailwindcss') {
				targetPath = twEntry;
			} else if (id.startsWith('@sveltesentio/ui/')) {
				targetPath = require.resolve(id);
			} else {
				targetPath = resolve(loadBase, id);
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

	const scanner = new Scanner({ sources: compiled.sources });
	const candidates = scanner.scan();
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
		expect(resolved).toBe(fileURLToPath(new URL('../src/tailwind.css', import.meta.url)));
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

	it('omits dialog utility rules when consumer stylesheet negates dialog path via @source not', async () => {
		const consumerCss = [
			'@import "tailwindcss";',
			'@import "@sveltesentio/ui/tailwind.css";',
			'@source not "./dialog/**";',
		].join('\n');

		const result = await compileConsumerStylesheet(consumerCss);

		expect(result.candidates).not.toContain('bg-black/80');
		expect(result.candidates).not.toContain('top-1/2');

		expect(result.outputCss).not.toContain('.bg-black\\/80');
		expect(result.outputCss).not.toContain('.top-1\\/2');
	});
});
