/**
 * Font-preset helper (ADR-0049). The framework default is a zero-download system
 * font stack; named presets (Inter / Geist / mono) are opt-in. Each preset names
 * a Fontsource variable family and exposes its `font-family` stack plus the CSS
 * needed to load it with correct LCP semantics (`font-display: swap`). Pure +
 * unit-tested; the consumer imports a preset and emits its `@font-face` + the
 * `--font-sans` / `--font-mono` custom properties.
 *
 * This module declares the presets as DATA — it does NOT import a Fontsource
 * package (those are app-level opt-in peers). Consumers `import '@fontsource-
 * variable/<id>'` themselves; this helper only describes the family + stack.
 */

/** Built-in preset identifiers. `system` is the zero-download default. */
export type FontPresetId = 'system' | 'inter' | 'geist' | 'mono';

/** Generic CSS family a stack falls back to. */
export type GenericFamily = 'sans-serif' | 'monospace' | 'serif';

export interface FontPreset {
	readonly id: FontPresetId;
	/** Primary family name (`''` for the pure system stack). */
	readonly family: string;
	/** The Fontsource package to `import` (undefined for `system`). */
	readonly fontsource?: string;
	/** The `@font-face` `src` family (variable font), undefined for `system`. */
	readonly variable: boolean;
	/** The generic the stack terminates in. */
	readonly generic: GenericFamily;
}

/** Zero-download system sans stack (ADR-0049 default). */
export const SYSTEM_SANS =
	"ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Zero-download system mono stack (ADR-0049 default). */
export const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const fontPresets: Readonly<Record<FontPresetId, FontPreset>> = {
	system: { id: 'system', family: '', variable: false, generic: 'sans-serif' },
	inter: {
		id: 'inter',
		family: 'Inter Variable',
		fontsource: '@fontsource-variable/inter',
		variable: true,
		generic: 'sans-serif',
	},
	geist: {
		id: 'geist',
		family: 'Geist Variable',
		fontsource: '@fontsource-variable/geist',
		variable: true,
		generic: 'sans-serif',
	},
	mono: {
		id: 'mono',
		family: 'Geist Mono Variable',
		fontsource: '@fontsource-variable/geist-mono',
		variable: true,
		generic: 'monospace',
	},
};

/**
 * Build the CSS `font-family` stack for a preset: the preset family (quoted when
 * it contains whitespace) prepended to the matching system fallback so text
 * always paints, even before/without the web font (`font-display: swap`).
 */
export function fontStack(preset: FontPresetId | FontPreset): string {
	const resolved = typeof preset === 'string' ? fontPresets[preset] : preset;
	const fallback = resolved.generic === 'monospace' ? SYSTEM_MONO : SYSTEM_SANS;
	if (resolved.family === '') return fallback;
	const quoted = /\s/.test(resolved.family) ? `'${resolved.family}'` : resolved.family;
	return `${quoted}, ${fallback}`;
}

/**
 * Emit the `--font-sans` / `--font-mono` custom property for a preset, scoped to
 * `selector` (default `:root`). Maps the preset onto the variable Tailwind 4
 * reads. A sans/serif preset sets `--font-sans`; a mono preset sets `--font-mono`.
 */
export function fontPresetCss(preset: FontPresetId | FontPreset, selector = ':root'): string {
	const resolved = typeof preset === 'string' ? fontPresets[preset] : preset;
	const varName = resolved.generic === 'monospace' ? '--font-mono' : '--font-sans';
	return `${selector} {\n\t${varName}: ${fontStack(resolved)};\n}`;
}

/**
 * Emit the `@font-face` declaration for a preset's variable font, with the
 * correct LCP semantics: `font-display: swap` (text paints before the font
 * loads). Returns `''` for the `system` preset (no `@font-face`). `url` points at
 * the consumer-hosted (Fontsource) woff2; `weightRange` is the variable axis.
 */
export function fontFaceCss(
	preset: FontPresetId | FontPreset,
	url: string,
	weightRange = '100 900',
): string {
	const resolved = typeof preset === 'string' ? fontPresets[preset] : preset;
	if (!resolved.variable || resolved.family === '') return '';
	return [
		'@font-face {',
		`\tfont-family: '${resolved.family}';`,
		'\tfont-style: normal;',
		`\tfont-weight: ${weightRange};`,
		'\tfont-display: swap;',
		`\tsrc: url('${url}') format('woff2-variations');`,
		'}',
	].join('\n');
}

/**
 * Build the `<link rel="preload">` attributes for a preset's above-the-fold font
 * (ADR-0049 LCP guidance). Returns `undefined` for `system` (nothing to preload).
 */
export function fontPreloadLink(
	preset: FontPresetId | FontPreset,
	url: string,
): { rel: 'preload'; as: 'font'; type: 'font/woff2'; href: string; crossorigin: 'anonymous' } | undefined {
	const resolved = typeof preset === 'string' ? fontPresets[preset] : preset;
	if (!resolved.variable) return undefined;
	return { rel: 'preload', as: 'font', type: 'font/woff2', href: url, crossorigin: 'anonymous' };
}
