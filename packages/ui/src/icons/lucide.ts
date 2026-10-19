/**
 * Default `@lucide/svelte` adapter (ADR-0002). Lucide is an OPTIONAL peer, so it
 * is never statically imported here — that would force every consumer to
 * install it. Two wiring paths:
 *
 * - `createLucideLoader(icons)` — synchronous; pass a record of per-icon imports
 *   (e.g. `{ ArrowLeft }`). Recommended for production builds so icons are
 *   bundled statically.
 * - `lucideDynamicLoader` — (deprecated) resolves each name via
 *   `import('@lucide/svelte/icons/<kebab-name>')` on demand. Works only where the
 *   runtime resolves bare specifiers (Node, SSR, Vite dev), not in production
 *   browser bundles.
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
 * Dynamically imports the per-icon module on demand.
 *
 * @deprecated Works only where the runtime resolves bare specifiers (Node, SSR,
 * Vite dev), not in a production browser bundle. Use
 * `createLucideLoader({ ArrowLeft, ... })` over per-icon imports
 * (`import ArrowLeft from '@lucide/svelte/icons/arrow-left'`).
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
