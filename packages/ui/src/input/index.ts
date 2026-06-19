/**
 * `@sveltesentio/ui/input` — peer-free default Input matching the shadcn-svelte
 * class contract (ADR-0014). The pure class resolver is exported and unit-tested
 * here; the thin `Input.svelte` view ships via the package's `svelte` export
 * condition. Pairs with a `<label for>` or `aria-label`.
 */

export { INPUT_BASE, INPUT_INVALID, inputClass } from './variants.js';
