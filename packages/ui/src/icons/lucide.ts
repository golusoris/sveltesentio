/**
 * Default `@lucide/svelte` adapter (ADR-0002). Lucide is an OPTIONAL peer, so it
 * is never statically imported here — that would force every consumer to
 * install it. Two wiring paths:
 *
 * - `createLucideLoader(icons)` — synchronous; pass the `@lucide/svelte/icons`
 *   barrel (PascalCase named exports). Best for tree-shaking when you import the
 *   barrel yourself.
 * - `lucideDynamicLoader` — zero-config; resolves each name via
 *   `import('@lucide/svelte/icons/<kebab-name>')` on demand. Returns a Promise
 *   the `Icon.svelte` consumer awaits.
 */

import type { IconLoader, IconComponent } from './registry.js';

/** A record of PascalCase icon name → Svelte component (the Lucide barrel shape). */
export type LucideIconModule = Record<string, IconComponent>;

/** `arrow-left` / `arrowLeft` / `ArrowLeft` → `ArrowLeft` (Lucide barrel key). */
export function toPascalCase(name: string): string {
	return name
		.replace(/[-_\s]+(.)?/g, (_, chr: string | undefined) => (chr ? chr.toUpperCase() : ''))
		.replace(/^(.)/, (_, chr: string) => chr.toUpperCase());
}

/**
 * `ArrowLeft` / `arrowLeft` / `AArrowDown` → `arrow-left` (Lucide subpath segment).
 *
 * The first step splits a run of capitals before its last one (`AArrow` →
 * `A-Arrow`). It matches a position, not the run: a pattern that consumes the
 * run (`[A-Z]+` followed by a capital and a lowercase letter) rescans the rest of
 * the run from every capital, which is quadratic in the length of a name that
 * is all capitals.
 */
export function toKebabCase(name: string): string {
	return name
		.replace(/(?<=[A-Z])(?=[A-Z][a-z])/g, '-')
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/[\s_]+/g, '-')
		.toLowerCase();
}

/**
 * Build a synchronous loader over a Lucide icon barrel. Resolves both kebab
 * (`arrow-left`) and Pascal (`ArrowLeft`) names; returns `undefined` for misses
 * so the registry can fall through.
 */
export function createLucideLoader(icons: LucideIconModule): IconLoader {
	return (name: string): IconComponent | undefined => {
		const pascal = toPascalCase(name);
		return icons[pascal] ?? icons[name] ?? undefined;
	};
}

/**
 * Zero-config Lucide loader: dynamically imports the per-icon module on demand.
 * The peer is referenced only inside the async body, so bundlers resolve it
 * lazily and `tsc` does not require it to be installed at build time of this
 * package.
 */
export const lucideDynamicLoader: IconLoader = (
	name: string,
): Promise<IconComponent | undefined> => {
	const slug = toKebabCase(name);
	// The specifier is constructed so this package does not hard-depend on the
	// optional peer; the import resolves in the consuming app where it is installed.
	const specifier = `@lucide/svelte/icons/${slug}`;
	return import(/* @vite-ignore */ specifier).then(
		(mod: { default?: IconComponent }) => mod.default,
	);
};
