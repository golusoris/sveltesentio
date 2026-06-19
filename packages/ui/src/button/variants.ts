/**
 * Button variant resolver (ADR-0014). The shadcn-svelte Button is delivered as
 * source into the consuming app, but `@sveltesentio/ui` ships a first-class,
 * peer-free default that matches shadcn's Tailwind class contract so apps get a
 * working, a11y-correct button before running the CLI. This module is the pure,
 * unit-tested class logic; `Button.svelte` is the thin view over it.
 *
 * Classes resolve the oklch semantic tokens (`bg-primary`, `text-foreground`, …)
 * emitted by `../tokens` so variants follow the active theme automatically.
 */

/** Visual emphasis. Mirrors shadcn-svelte's variant set. */
export type ButtonVariant =
	| 'default'
	| 'destructive'
	| 'outline'
	| 'secondary'
	| 'ghost'
	| 'link';

/** Control size. `icon` is a square target for icon-only buttons. */
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

/** Shared base: layout, focus ring, disabled + a11y affordances. */
export const BUTTON_BASE =
	'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md ' +
	'text-sm font-medium transition-colors outline-none ' +
	'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
	'focus-visible:ring-offset-background ' +
	'disabled:pointer-events-none disabled:opacity-50 ' +
	'aria-disabled:pointer-events-none aria-disabled:opacity-50';

/** Per-variant token-backed colour classes. */
export const BUTTON_VARIANTS: Readonly<Record<ButtonVariant, string>> = {
	default: 'bg-primary text-primary-foreground hover:bg-primary/90',
	destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
	outline:
		'border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
	secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
	ghost: 'hover:bg-accent hover:text-accent-foreground',
	link: 'text-primary underline-offset-4 hover:underline',
};

/**
 * Per-size classes. Heights map to the preset `--ui-control-height`; the icon
 * size is square so an icon-only button keeps a ≥ target-size hit area.
 */
export const BUTTON_SIZES: Readonly<Record<ButtonSize, string>> = {
	default: 'h-9 px-4 py-2',
	sm: 'h-8 rounded-md px-3 text-xs',
	lg: 'h-10 rounded-md px-6',
	icon: 'h-9 w-9',
};

/**
 * Resolve the full class string for a variant/size pair. Extra `className`
 * tokens are appended last so consumers can override. Falsy class fragments are
 * dropped and whitespace is collapsed for stable, testable output.
 */
export function buttonClass(
	variant: ButtonVariant = 'default',
	size: ButtonSize = 'default',
	className?: string,
): string {
	return [BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className]
		.filter((part): part is string => Boolean(part))
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
}
