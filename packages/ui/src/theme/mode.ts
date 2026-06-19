/**
 * Theme-mode logic — tier 2 of the three-tier theming model (ADR-0046, ADR-0048).
 * Pure, unit-tested functions for the light / dark / system tri-state: resolving
 * `system` against `prefers-color-scheme`, serialising the `theme` cookie, and
 * computing the `<html>` class. `ThemeToggle.svelte` is the thin view; the actual
 * class flip is delegated to `mode-watcher` (an OPTIONAL peer) in the consuming
 * app, but every decision it needs is computed here without that dependency.
 */

/** The user-facing tri-state: an explicit choice or "follow the OS". */
export type ThemeMode = 'light' | 'dark' | 'system';

/** Callback fired with the next mode after a toggle activation. */
export type ThemeModeChange = (next: ThemeMode) => void;

/** The concrete applied scheme after resolving `system`. */
export type ResolvedMode = 'light' | 'dark';

/** The ordered tri-state cycle a single toggle steps through. */
export const MODE_CYCLE: readonly ThemeMode[] = ['light', 'dark', 'system'];

/** Cookie name carrying the mode across requests (ADR-0048). */
export const THEME_COOKIE = 'theme';

/** Type guard: is `value` a valid {@link ThemeMode}? */
export function isThemeMode(value: unknown): value is ThemeMode {
	return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * Resolve a {@link ThemeMode} to the concrete scheme. `light`/`dark` pass through;
 * `system` resolves against `systemPrefersDark` (the result of a
 * `matchMedia('(prefers-color-scheme: dark)')` query, or the
 * `Sec-CH-Prefers-Color-Scheme` header server-side).
 */
export function resolveMode(mode: ThemeMode, systemPrefersDark: boolean): ResolvedMode {
	if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
	return mode;
}

/**
 * Step the tri-state cycle: light → dark → system → light. An invalid current
 * value restarts the cycle at `light`.
 */
export function nextMode(current: ThemeMode): ThemeMode {
	const index = MODE_CYCLE.indexOf(current);
	const next = MODE_CYCLE[(index + 1) % MODE_CYCLE.length];
	return next ?? 'light';
}

/**
 * The class applied to `<html>` for a resolved scheme. Dark gets `dark` (matching
 * the `.dark` selector in `themeCss`); light gets the empty string (no class).
 */
export function htmlClassFor(resolved: ResolvedMode): string {
	return resolved === 'dark' ? 'dark' : '';
}

/** Parse the `theme` cookie value, falling back to `system` when absent/invalid. */
export function parseThemeCookie(value: string | null | undefined): ThemeMode {
	return isThemeMode(value) ? value : 'system';
}

/**
 * Serialise the `theme` cookie. `maxAge` defaults to one year; the cookie is
 * `SameSite=Lax`, `Path=/`, no `HttpOnly` (the client toggle must read it).
 * Server-set per ADR-0048 for flash-free SSR.
 */
export function serializeThemeCookie(mode: ThemeMode, maxAgeSeconds = 60 * 60 * 24 * 365): string {
	return `${THEME_COOKIE}=${mode}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

/** Human-readable label for a mode (toggle `aria-label` / tooltip text). */
export function modeLabel(mode: ThemeMode): string {
	switch (mode) {
		case 'light':
			return 'Light';
		case 'dark':
			return 'Dark';
		case 'system':
			return 'System';
	}
}
