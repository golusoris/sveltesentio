/**
 * Theme-customizer logic — tier 3 of the three-tier theming model (ADR-0046).
 * Pure, unit-tested helpers for end-user token overrides: validate an override
 * map against the known semantic tokens, emit it as an inline `--color-*` style
 * (or a scoped CSS rule), and round-trip it through a JSON payload the consumer
 * persists to its own user-preferences endpoint (no default persistence; ADR-0046).
 *
 * Overrides are a partial map — the user tweaks `accent`/`primary`/… and the rest
 * inherit the compile-time `@theme` defaults from `../tokens`.
 */

import { lightTokens, type SemanticTokens } from '../tokens/index.js';

/** A user override: any subset of the semantic tokens, each an oklch string. */
export type ThemeOverride = Partial<Record<keyof SemanticTokens, string>>;

/** Callback fired with the sanitised override after every customiser edit. */
export type ThemeOverrideChange = (next: ThemeOverride) => void;

/** The canonical token keys an override may target. */
export const TOKEN_KEYS = Object.keys(lightTokens) as (keyof SemanticTokens)[];

/** `cardForeground` -> `--color-card-foreground`. */
function cssVarName(token: string): string {
	return `--color-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/**
 * Validate the syntactic shape of an oklch colour string: `oklch(L C H)` or
 * `oklch(L C H / A)`, lightness/chroma/hue/alpha numeric. Intentionally lenient
 * on ranges (clamping is the browser's job) but rejects non-oklch input so a
 * customiser cannot smuggle arbitrary CSS into a `--color-*` value.
 */
export function isValidOklch(value: string): boolean {
	return /^oklch\(\s*[\d.]+%?\s+[\d.]+\s+[\d.]+(?:\s*\/\s*[\d.]+%?)?\s*\)$/.test(value.trim());
}

/**
 * Keep only the entries that target a known token AND carry a valid oklch value.
 * Unknown keys and malformed values are dropped (defence-in-depth for tier 3,
 * which takes user-supplied input — ASVS L2 boundary).
 */
export function sanitizeOverride(override: ThemeOverride): ThemeOverride {
	const out: ThemeOverride = {};
	for (const key of TOKEN_KEYS) {
		const value = override[key];
		if (typeof value === 'string' && isValidOklch(value)) out[key] = value;
	}
	return out;
}

/**
 * Emit a sanitised override as a string of `--color-*: <oklch>;` declarations
 * (no selector) — drop straight into an element's `style` attribute or wrap with
 * `overrideCss`. Returns `''` when nothing survives sanitisation.
 */
export function overrideToInlineStyle(override: ThemeOverride): string {
	const clean = sanitizeOverride(override);
	return TOKEN_KEYS.filter((key) => clean[key] !== undefined)
		.map((key) => `${cssVarName(key)}: ${clean[key]};`)
		.join(' ');
}

/**
 * Emit a sanitised override as a scoped CSS rule. `selector` defaults to `:root`
 * so the overrides cascade over the compile-time defaults. Returns `''` when the
 * override is empty after sanitisation.
 */
export function overrideCss(override: ThemeOverride, selector = ':root'): string {
	const inline = overrideToInlineStyle(override);
	if (inline === '') return '';
	const decls = inline
		.split('; ')
		.map((decl) => `\t${decl.endsWith(';') ? decl : `${decl};`}`)
		.join('\n');
	return `${selector} {\n${decls}\n}`;
}

/** Serialise a sanitised override to the JSON string a consumer persists. */
export function serializeOverride(override: ThemeOverride): string {
	return JSON.stringify(sanitizeOverride(override));
}

/**
 * Parse a persisted override JSON payload back into a sanitised {@link ThemeOverride}.
 * Malformed JSON, non-objects, and invalid entries all collapse to `{}` so a
 * corrupt stored value can never inject CSS.
 */
export function parseOverride(json: string | null | undefined): ThemeOverride {
	if (!json) return {};
	try {
		const parsed: unknown = JSON.parse(json);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
		return sanitizeOverride(parsed);
	} catch {
		return {};
	}
}
