// SPDX-FileCopyrightText: 2026 lusoris <lusoris@pm.me>
// SPDX-License-Identifier: EUPL-1.2

import { tokensToCssVars, type SemanticTokens } from '../tokens/index.js';

export interface PaletteTokens extends SemanticTokens {
	readonly brand: string;
	readonly brandForeground: string;
	readonly navActive: string;
	readonly navActiveForeground: string;
}

export interface PalettePreset {
	readonly name: string;
	readonly light: PaletteTokens;
	readonly dark: PaletteTokens;
}

/**
 * SnatchArr Palette A: deep purple-indigo theme with WCAG 2.2 AA contrast.
 */
export const presetSnatchArr: PalettePreset = {
	name: 'snatcharr',
	light: {
		background: 'oklch(0.985 0.015 285)',
		foreground: 'oklch(0.18 0.04 285)',
		card: 'oklch(1 0 0)',
		cardForeground: 'oklch(0.18 0.04 285)',
		popover: 'oklch(1 0 0)',
		popoverForeground: 'oklch(0.18 0.04 285)',
		primary: 'oklch(0.38 0.16 285)',
		primaryForeground: 'oklch(0.985 0.005 285)',
		secondary: 'oklch(0.94 0.02 285)',
		secondaryForeground: 'oklch(0.20 0.04 285)',
		muted: 'oklch(0.94 0.02 285)',
		mutedForeground: 'oklch(0.48 0.05 285)',
		accent: 'oklch(0.92 0.03 285)',
		accentForeground: 'oklch(0.20 0.04 285)',
		destructive: 'oklch(0.55 0.22 25)',
		destructiveForeground: 'oklch(0.985 0 0)',
		border: 'oklch(0.90 0.02 285)',
		input: 'oklch(0.60 0.04 285)',
		ring: 'oklch(0.50 0.15 285)',
		brand: 'oklch(0.38 0.16 285)',
		brandForeground: 'oklch(0.985 0.005 285)',
		navActive: 'oklch(0.93 0.035 285)',
		navActiveForeground: 'oklch(0.20 0.10 285)',
	},
	dark: {
		background: 'oklch(0.14 0.035 285)',
		foreground: 'oklch(0.96 0.015 285)',
		card: 'oklch(0.20 0.045 285)',
		cardForeground: 'oklch(0.96 0.015 285)',
		popover: 'oklch(0.20 0.045 285)',
		popoverForeground: 'oklch(0.96 0.015 285)',
		primary: 'oklch(0.76 0.16 290)',
		primaryForeground: 'oklch(0.14 0.04 285)',
		secondary: 'oklch(0.26 0.05 285)',
		secondaryForeground: 'oklch(0.96 0.015 285)',
		muted: 'oklch(0.26 0.05 285)',
		mutedForeground: 'oklch(0.72 0.04 285)',
		accent: 'oklch(0.28 0.06 285)',
		accentForeground: 'oklch(0.96 0.015 285)',
		destructive: 'oklch(0.55 0.22 25)',
		destructiveForeground: 'oklch(0.985 0 0)',
		border: 'oklch(0.28 0.04 285)',
		input: 'oklch(0.60 0.04 285)',
		ring: 'oklch(0.70 0.15 290)',
		brand: 'oklch(0.76 0.16 290)',
		brandForeground: 'oklch(0.14 0.04 285)',
		navActive: 'oklch(0.24 0.055 285)',
		navActiveForeground: 'oklch(0.92 0.08 290)',
	},
};

/**
 * Emit a palette token set as `--color-*` custom property declarations.
 * Reuses `tokensToCssVars` for the 19 standard semantic tokens, then appends
 * the 4 palette-specific tokens.
 */
export function paletteToCssVars(tokens: PaletteTokens): string {
	const semantic: SemanticTokens = {
		background: tokens.background,
		foreground: tokens.foreground,
		card: tokens.card,
		cardForeground: tokens.cardForeground,
		popover: tokens.popover,
		popoverForeground: tokens.popoverForeground,
		primary: tokens.primary,
		primaryForeground: tokens.primaryForeground,
		secondary: tokens.secondary,
		secondaryForeground: tokens.secondaryForeground,
		muted: tokens.muted,
		mutedForeground: tokens.mutedForeground,
		accent: tokens.accent,
		accentForeground: tokens.accentForeground,
		destructive: tokens.destructive,
		destructiveForeground: tokens.destructiveForeground,
		border: tokens.border,
		input: tokens.input,
		ring: tokens.ring,
	};
	const base = tokensToCssVars(semantic);
	const extra = [
		`\t--color-brand: ${tokens.brand};`,
		`\t--color-brand-foreground: ${tokens.brandForeground};`,
		`\t--color-nav-active: ${tokens.navActive};`,
		`\t--color-nav-active-foreground: ${tokens.navActiveForeground};`,
	].join('\n');
	return base.length > 0 ? `${base}\n${extra}` : extra;
}

/**
 * Emit a flash-free light/dark palette stylesheet matching `themeCss` layout.
 */
export function paletteCss(preset: PalettePreset, darkSelector = '.dark'): string {
	return [
		`:root {\n${paletteToCssVars(preset.light)}\n}`,
		`${darkSelector} {\n${paletteToCssVars(preset.dark)}\n}`,
	].join('\n\n');
}
