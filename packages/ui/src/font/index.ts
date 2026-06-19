/**
 * `@sveltesentio/ui/font-preset` — system-font default + Fontsource variable-font
 * opt-in presets (ADR-0049). Pure helpers: build the `font-family` stack, emit
 * `--font-sans` / `--font-mono`, the `@font-face` (with `font-display: swap`), and
 * the `<link rel=preload>` attributes for above-the-fold LCP. Fontsource packages
 * stay app-level opt-in peers; this module only describes the families.
 */

export {
	type FontPresetId,
	type GenericFamily,
	type FontPreset,
	SYSTEM_SANS,
	SYSTEM_MONO,
	fontPresets,
	fontStack,
	fontPresetCss,
	fontFaceCss,
	fontPreloadLink,
} from './preset.js';
