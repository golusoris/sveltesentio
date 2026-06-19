/**
 * `@sveltesentio/ui/theme-toggle` — tier-2 light/dark/system mode toggle
 * (ADR-0046, ADR-0048). The pure tri-state + cookie logic is exported and
 * unit-tested here; the thin, peer-free `ThemeToggle.svelte` view ships via the
 * package's `svelte` export condition. The actual `<html class="dark">` flip is
 * delegated to the consumer (typically `mode-watcher`, an OPTIONAL peer) via the
 * component's `onchange` callback.
 */

export {
	type ThemeMode,
	type ResolvedMode,
	type ThemeModeChange,
	MODE_CYCLE,
	THEME_COOKIE,
	isThemeMode,
	resolveMode,
	nextMode,
	htmlClassFor,
	parseThemeCookie,
	serializeThemeCookie,
	modeLabel,
} from './mode.js';
