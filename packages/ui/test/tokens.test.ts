import { describe, expect, it } from 'vitest';
import {
	darkTokens,
	lightTokens,
	themeCss,
	tokensToCssVars,
	type SemanticTokens,
} from '../src/tokens/index.js';

const EXPECTED_LIGHT_VARS = [
	'\t--color-background: oklch(1 0 0);',
	'\t--color-foreground: oklch(0.145 0 0);',
	'\t--color-card: oklch(1 0 0);',
	'\t--color-card-foreground: oklch(0.145 0 0);',
	'\t--color-popover: oklch(1 0 0);',
	'\t--color-popover-foreground: oklch(0.145 0 0);',
	'\t--color-primary: oklch(0.205 0 0);',
	'\t--color-primary-foreground: oklch(0.985 0 0);',
	'\t--color-secondary: oklch(0.97 0 0);',
	'\t--color-secondary-foreground: oklch(0.205 0 0);',
	'\t--color-muted: oklch(0.97 0 0);',
	'\t--color-muted-foreground: oklch(0.556 0 0);',
	'\t--color-accent: oklch(0.97 0 0);',
	'\t--color-accent-foreground: oklch(0.205 0 0);',
	'\t--color-destructive: oklch(0.577 0.245 27.325);',
	'\t--color-destructive-foreground: oklch(0.985 0 0);',
	'\t--color-border: oklch(0.922 0 0);',
	'\t--color-input: oklch(0.922 0 0);',
	'\t--color-ring: oklch(0.708 0 0);',
].join('\n');

const EXPECTED_DARK_VARS = [
	'\t--color-background: oklch(0.145 0 0);',
	'\t--color-foreground: oklch(0.985 0 0);',
	'\t--color-card: oklch(0.205 0 0);',
	'\t--color-card-foreground: oklch(0.985 0 0);',
	'\t--color-popover: oklch(0.205 0 0);',
	'\t--color-popover-foreground: oklch(0.985 0 0);',
	'\t--color-primary: oklch(0.922 0 0);',
	'\t--color-primary-foreground: oklch(0.205 0 0);',
	'\t--color-secondary: oklch(0.269 0 0);',
	'\t--color-secondary-foreground: oklch(0.985 0 0);',
	'\t--color-muted: oklch(0.269 0 0);',
	'\t--color-muted-foreground: oklch(0.708 0 0);',
	'\t--color-accent: oklch(0.269 0 0);',
	'\t--color-accent-foreground: oklch(0.985 0 0);',
	'\t--color-destructive: oklch(0.704 0.191 22.216);',
	'\t--color-destructive-foreground: oklch(0.985 0 0);',
	'\t--color-border: oklch(0.269 0 0);',
	'\t--color-input: oklch(0.269 0 0);',
	'\t--color-ring: oklch(0.556 0 0);',
].join('\n');

const EXPECTED_DEFAULT_THEME_CSS = `:root {\n${EXPECTED_LIGHT_VARS}\n}\n\n.dark {\n${EXPECTED_DARK_VARS}\n}`;

describe('lightTokens', () => {
	it('defines all required semantic tokens in oklch format', () => {
		expect(lightTokens.background).toBe('oklch(1 0 0)');
		expect(lightTokens.foreground).toBe('oklch(0.145 0 0)');
		expect(lightTokens.primary).toBe('oklch(0.205 0 0)');
		expect(lightTokens.primaryForeground).toBe('oklch(0.985 0 0)');
		expect(lightTokens.destructive).toBe('oklch(0.577 0.245 27.325)');
	});

	it('contains zero legacy HSL, RGB, or hex color tokens', () => {
		for (const [key, value] of Object.entries(lightTokens)) {
			expect(value, `token ${key} must use oklch`).toMatch(/^oklch\(/);
			expect(value, `token ${key} must not use hsl/rgb/hex`).not.toMatch(/hsl|rgb|#/i);
		}
	});

	it('has exactly 19 semantic token entries', () => {
		const keys = Object.keys(lightTokens);
		expect(keys).toHaveLength(19);
		expect(keys[0]).toBe('background');
		expect(keys[18]).toBe('ring');
	});
});

describe('darkTokens', () => {
	it('defines dark contrast tokens matching the semantic token surface', () => {
		expect(darkTokens.background).toBe('oklch(0.145 0 0)');
		expect(darkTokens.foreground).toBe('oklch(0.985 0 0)');
		expect(darkTokens.primary).toBe('oklch(0.922 0 0)');
		expect(darkTokens.primaryForeground).toBe('oklch(0.205 0 0)');
		expect(darkTokens.destructive).toBe('oklch(0.704 0.191 22.216)');
	});

	it('inverts background luminance vs light tokens and has no legacy formats', () => {
		expect(darkTokens.background).not.toBe(lightTokens.background);
		for (const [key, value] of Object.entries(darkTokens)) {
			expect(value, `token ${key} must use oklch`).toMatch(/^oklch\(/);
			expect(value, `token ${key} must not use hsl/rgb/hex`).not.toMatch(/hsl|rgb|#/i);
		}
	});

	it('matches the exact key set of lightTokens with length 19', () => {
		const darkKeys = Object.keys(darkTokens);
		const lightKeys = Object.keys(lightTokens);
		expect(darkKeys).toEqual(lightKeys);
		expect(darkKeys).toHaveLength(19);
	});
});

describe('tokensToCssVars', () => {
	it('formats lightTokens as exact custom-property declarations', () => {
		expect(tokensToCssVars(lightTokens)).toBe(EXPECTED_LIGHT_VARS);
	});

	it('formats darkTokens as exact custom-property declarations', () => {
		expect(tokensToCssVars(darkTokens)).toBe(EXPECTED_DARK_VARS);
	});

	it('converts camelCase token names to kebab-case --color-* variables', () => {
		const output = tokensToCssVars(lightTokens);
		expect(output).toContain('--color-card-foreground:');
		expect(output).toContain('--color-primary-foreground:');
		expect(output).toContain('--color-secondary-foreground:');
		expect(output).toContain('--color-muted-foreground:');
		expect(output).toContain('--color-accent-foreground:');
		expect(output).toContain('--color-destructive-foreground:');
		expect(output).not.toContain('--color-cardForeground:');
		expect(output).not.toContain('--color-primaryForeground:');
	});

	it('handles single-entry boundary object without trailing newline', () => {
		const single = { background: 'oklch(0.5 0 0)' } as unknown as SemanticTokens;
		expect(tokensToCssVars(single)).toBe('\t--color-background: oklch(0.5 0 0);');
	});

	it('handles empty token boundary object returning empty string', () => {
		const empty = {} as unknown as SemanticTokens;
		expect(tokensToCssVars(empty)).toBe('');
	});
});

describe('themeCss', () => {
	it('emits the default flash-free theme with :root and .dark selectors', () => {
		expect(themeCss()).toBe(EXPECTED_DEFAULT_THEME_CSS);
	});

	it('honours custom darkSelector option without modifying :root light block', () => {
		const customSelector = '[data-theme="dark"]';
		const expected = `:root {\n${EXPECTED_LIGHT_VARS}\n}\n\n${customSelector} {\n${EXPECTED_DARK_VARS}\n}`;
		const css = themeCss({ darkSelector: customSelector });
		expect(css).toBe(expected);
		expect(css).not.toContain('.dark {');
	});

	it('accepts custom light and dark token sets', () => {
		const customLight = { background: 'oklch(0.9 0 0)' } as unknown as SemanticTokens;
		const customDark = { background: 'oklch(0.1 0 0)' } as unknown as SemanticTokens;
		const expected = `:root {\n\t--color-background: oklch(0.9 0 0);\n}\n\n.mode-dark {\n\t--color-background: oklch(0.1 0 0);\n}`;
		expect(
			themeCss({
				light: customLight,
				dark: customDark,
				darkSelector: '.mode-dark',
			}),
		).toBe(expected);
	});

	it('handles empty options object returning default theme', () => {
		expect(themeCss({})).toBe(EXPECTED_DEFAULT_THEME_CSS);
	});
});
