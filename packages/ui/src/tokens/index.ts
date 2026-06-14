/**
 * oklch-only semantic color tokens (ADR-0006). No HSL fallback; browser floor
 * Safari >=15.4 / Chrome 111+ / Firefox 113+. Token names mirror the
 * shadcn-svelte surface (ADR-0014) so generated components resolve them.
 */

export interface SemanticTokens {
	readonly background: string;
	readonly foreground: string;
	readonly card: string;
	readonly cardForeground: string;
	readonly popover: string;
	readonly popoverForeground: string;
	readonly primary: string;
	readonly primaryForeground: string;
	readonly secondary: string;
	readonly secondaryForeground: string;
	readonly muted: string;
	readonly mutedForeground: string;
	readonly accent: string;
	readonly accentForeground: string;
	readonly destructive: string;
	readonly destructiveForeground: string;
	readonly border: string;
	readonly input: string;
	readonly ring: string;
}

/** Neutral light theme, all values `oklch(L C H)`. */
export const lightTokens: SemanticTokens = {
	background: 'oklch(1 0 0)',
	foreground: 'oklch(0.145 0 0)',
	card: 'oklch(1 0 0)',
	cardForeground: 'oklch(0.145 0 0)',
	popover: 'oklch(1 0 0)',
	popoverForeground: 'oklch(0.145 0 0)',
	primary: 'oklch(0.205 0 0)',
	primaryForeground: 'oklch(0.985 0 0)',
	secondary: 'oklch(0.97 0 0)',
	secondaryForeground: 'oklch(0.205 0 0)',
	muted: 'oklch(0.97 0 0)',
	mutedForeground: 'oklch(0.556 0 0)',
	accent: 'oklch(0.97 0 0)',
	accentForeground: 'oklch(0.205 0 0)',
	destructive: 'oklch(0.577 0.245 27.325)',
	destructiveForeground: 'oklch(0.985 0 0)',
	border: 'oklch(0.922 0 0)',
	input: 'oklch(0.922 0 0)',
	ring: 'oklch(0.708 0 0)',
};

/** Neutral dark theme, all values `oklch(L C H)`. */
export const darkTokens: SemanticTokens = {
	background: 'oklch(0.145 0 0)',
	foreground: 'oklch(0.985 0 0)',
	card: 'oklch(0.205 0 0)',
	cardForeground: 'oklch(0.985 0 0)',
	popover: 'oklch(0.205 0 0)',
	popoverForeground: 'oklch(0.985 0 0)',
	primary: 'oklch(0.922 0 0)',
	primaryForeground: 'oklch(0.205 0 0)',
	secondary: 'oklch(0.269 0 0)',
	secondaryForeground: 'oklch(0.985 0 0)',
	muted: 'oklch(0.269 0 0)',
	mutedForeground: 'oklch(0.708 0 0)',
	accent: 'oklch(0.269 0 0)',
	accentForeground: 'oklch(0.985 0 0)',
	destructive: 'oklch(0.704 0.191 22.216)',
	destructiveForeground: 'oklch(0.985 0 0)',
	border: 'oklch(0.269 0 0)',
	input: 'oklch(0.269 0 0)',
	ring: 'oklch(0.556 0 0)',
};

/** `cardForeground` -> `--color-card-foreground`. */
function cssVarName(token: string): string {
	return `--color-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** Emit the token set as `--color-*` custom-property declarations (no selector). */
export function tokensToCssVars(tokens: SemanticTokens): string {
	return (Object.keys(tokens) as (keyof SemanticTokens)[])
		.map((key) => `\t${cssVarName(key)}: ${tokens[key]};`)
		.join('\n');
}

export interface ThemeCssOptions {
	readonly light?: SemanticTokens;
	readonly dark?: SemanticTokens;
	/** Selector applied for dark tokens (default `.dark`). */
	readonly darkSelector?: string;
}

/**
 * Emit a flash-free light/dark theme: light tokens on `:root`, dark tokens
 * under `darkSelector` (default `.dark`, matching the cookie-backed mode in
 * ADR-0048).
 */
export function themeCss(options: ThemeCssOptions = {}): string {
	const light = options.light ?? lightTokens;
	const dark = options.dark ?? darkTokens;
	const darkSelector = options.darkSelector ?? '.dark';
	return [
		`:root {\n${tokensToCssVars(light)}\n}`,
		`${darkSelector} {\n${tokensToCssVars(dark)}\n}`,
	].join('\n\n');
}
