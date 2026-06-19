/**
 * `@sveltesentio/ui/button` — peer-free default Button matching the shadcn-svelte
 * class contract (ADR-0014). The pure variant/size class resolver is exported and
 * unit-tested here; the thin `Button.svelte` view ships via the package's `svelte`
 * export condition (`tsc` does not type-check `.svelte`, so it is not re-exported
 * from this barrel — import it as `@sveltesentio/ui/button` in a Svelte consumer).
 * Swap for the CLI-delivered shadcn Button (`bits-ui`) when you need `asChild`.
 */

export {
	type ButtonVariant,
	type ButtonSize,
	BUTTON_BASE,
	BUTTON_VARIANTS,
	BUTTON_SIZES,
	buttonClass,
} from './variants.js';
