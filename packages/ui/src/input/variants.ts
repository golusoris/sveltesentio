/**
 * Input class resolver (ADR-0014). Peer-free default matching the shadcn-svelte
 * Input class contract; the pure, unit-tested logic lives here and `Input.svelte`
 * is the thin view over it. Classes resolve the oklch tokens from `../tokens`
 * (`border-input`, `ring-ring`, `text-foreground`) so the field follows the theme.
 */

/** Base field classes: sizing, border, focus ring, disabled + placeholder. */
export const INPUT_BASE =
	'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 ' +
	'text-sm text-foreground shadow-sm transition-colors ' +
	'file:border-0 file:bg-transparent file:text-sm file:font-medium ' +
	'placeholder:text-muted-foreground outline-none ' +
	'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
	'focus-visible:ring-offset-background ' +
	'disabled:cursor-not-allowed disabled:opacity-50';

/** Classes applied additionally when the field is in an invalid state. */
export const INPUT_INVALID = 'border-destructive ring-destructive focus-visible:ring-destructive';

/**
 * Resolve the full class string. `invalid` appends the destructive-token classes
 * (paired with `aria-invalid` on the element); extra `className` is appended last
 * so consumers can override. Whitespace is collapsed for stable, testable output.
 */
export function inputClass(invalid = false, className?: string): string {
	return [INPUT_BASE, invalid ? INPUT_INVALID : '', className]
		.filter((part): part is string => Boolean(part))
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
}
