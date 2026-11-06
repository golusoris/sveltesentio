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

type LoadedStylesheet = { path: string; base: string; content: string };

/**
 * Resolves a stylesheet target path for virtual, package, or relative specifiers.
 * Emulates Tailwind compiler stylesheet resolution across monorepo package boundaries.
 */
function resolveStylesheetPath(id: string, loadBase: string, twEntry: string): string {
	if (id === 'tailwindcss') {
		return twEntry;
	}
	if (id.startsWith('@sveltesentio/ui/')) {
		return require.resolve(id);
	}
	return resolve(loadBase, id);
}

/**
 * Resolves and reads stylesheet content for Tailwind CSS compiler imports with an explicit I/O timeout.
 * Prevents hanging compile passes when encountering circular or missing filesystem imports.
 */
async function loadStylesheet(id: string, base: string, tw: string): Promise<LoadedStylesheet> {
	const targetPath = resolveStylesheetPath(id, base, tw);
	const content = await readFile(targetPath, {
		encoding: 'utf8',
		signal: AbortSignal.timeout(IO_TIMEOUT_MS),
	});
	return {
		path: targetPath,
		base: dirname(targetPath),
		content,
	};
}

/**
 * Compiles a consumer Tailwind CSS stylesheet and executes oxide source scanning on candidate tokens.
 * Verifies that utility classes from component and package sources are emitted into final CSS.
 */
async function compileConsumerStylesheet(css: string, base?: string): Promise<ScannedConsumer> {
	const targetBase = base ?? dirname(require.resolve('@sveltesentio/ui/tailwind.css'));
	const twEntry = require.resolve('tailwindcss/index.css');

	const compiled = await compile(css, {
		base: targetBase,
		loadStylesheet: (id: string, loadBase: string) => loadStylesheet(id, loadBase, twEntry),
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

/**
 * Asserts that dialog utility classes and rules are absent from scan candidates and built CSS.
 * Prevents regressions where unimported or negated dialog components leak utilities into consumer bundles.
 */
function assertDialogUtilitiesAbsent(result: ScannedConsumer): void {
	expect(result.candidates).not.toContain('bg-black/80');
	expect(result.candidates).not.toContain('top-1/2');

	expect(result.outputCss).not.toContain('.bg-black\\/80');
	expect(result.outputCss).not.toContain('.top-1\\/2');
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
		assertDialogUtilitiesAbsent(result);
	});

	it('excludes story files via @source not directive', async () => {
		const consumerCss = ['@import "tailwindcss";', '@import "@sveltesentio/ui/tailwind.css";'].join(
			'\n',
		);

		const result = await compileConsumerStylesheet(consumerCss);
		const negated = result.sources.filter((s) => s.negated).map((s) => s.pattern);
		expect(negated).toContain('./**/*.stories.*');
		expect(negated).toContain('./**/*.{test,spec}.*');

		// Behavioural check of the shipped @source lines: compile the text of
		// src/tailwind.css against a fixture directory, where FixtureComponent
		// uses font-semibold and only FixtureComponent.stories uses tracking-tighter.
		const fixtureBase = fileURLToPath(new URL('./fixtures/story-exclusion', import.meta.url));
		const shipped = await readFile(require.resolve('@sveltesentio/ui/tailwind.css'), {
			encoding: 'utf8',
			signal: AbortSignal.timeout(IO_TIMEOUT_MS),
		});
		const fixtureCss = ['@import "tailwindcss";', shipped].join('\n');
		const fixtureResult = await compileConsumerStylesheet(fixtureCss, fixtureBase);

		expect(fixtureResult.candidates).toContain('font-semibold');
		expect(fixtureResult.candidates).not.toContain('tracking-tighter');
		expect(fixtureResult.outputCss).toContain('.font-semibold');
		expect(fixtureResult.outputCss).not.toContain('.tracking-tighter');
	});

	it('omits dialog utility rules when consumer stylesheet negates dialog path via @source not', async () => {
		const consumerCss = [
			'@import "tailwindcss";',
			'@import "@sveltesentio/ui/tailwind.css";',
			'@source not "./dialog/**";',
		].join('\n');

		const result = await compileConsumerStylesheet(consumerCss);
		assertDialogUtilitiesAbsent(result);
	});
});
