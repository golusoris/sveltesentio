/**
 * `@sveltesentio/ui/theme-customizer` — tier-3 end-user token overrides
 * (ADR-0046). The pure validation + CSS-emission + (de)serialisation logic is
 * exported and unit-tested here; the thin, peer-free `ThemeCustomizer.svelte` view
 * ships via the package's `svelte` export condition. Persistence has NO default —
 * the consumer wires the `onchange` callback to its own user-preferences endpoint.
 */

export {
	type ThemeOverride,
	type ThemeOverrideChange,
	TOKEN_KEYS,
	isValidOklch,
	sanitizeOverride,
	overrideToInlineStyle,
	overrideCss,
	serializeOverride,
	parseOverride,
} from './customizer.js';
