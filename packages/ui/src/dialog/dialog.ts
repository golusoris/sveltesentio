/**
 * Dialog logic (ADR-0014). The shadcn-svelte Dialog is CLI-delivered (backed by
 * `bits-ui`); `@sveltesentio/ui` ships a peer-free default whose focus-trap and
 * class logic live here as pure, unit-tested functions. `Dialog.svelte` is the
 * thin view that wires these to the DOM + Svelte lifecycle.
 */

/** Overlay (backdrop) classes. */
export const DIALOG_OVERLAY =
	'fixed inset-0 z-50 bg-black/80 ' +
	'data-[state=open]:animate-in data-[state=closed]:animate-out';

/** Content panel classes — centered, token-backed surface, focus ring scope. */
export const DIALOG_CONTENT =
	'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 ' +
	'gap-4 border border-border bg-background p-6 shadow-lg sm:rounded-lg ' +
	'text-foreground outline-none';

/** Resolve the content panel class string, appending consumer overrides last. */
export function dialogContentClass(className?: string): string {
	return [DIALOG_CONTENT, className]
		.filter((part): part is string => Boolean(part))
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** CSS selector matching focusable descendants inside the dialog content. */
export const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])',
].join(',');

/** Collect the in-order focusable elements within `container`. */
export function focusableElements(container: ParentNode): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Compute the element a Tab / Shift+Tab should move focus to, keeping focus
 * trapped inside `elements`. Returns `undefined` when there is nothing to trap
 * (caller should keep focus on the dialog itself). `active` is the currently
 * focused element; `shift` is true for Shift+Tab (reverse).
 *
 * Wrap behaviour: forward off the last element wraps to the first; backward off
 * the first wraps to the last. Focus currently outside the trap snaps to the
 * first (forward) or last (backward) element.
 */
export function nextTrapTarget(
	elements: readonly HTMLElement[],
	active: Element | null,
	shift: boolean,
): HTMLElement | undefined {
	if (elements.length === 0) return undefined;
	const first = elements[0];
	const last = elements[elements.length - 1];
	if (first === undefined || last === undefined) return undefined;

	const index = active instanceof HTMLElement ? elements.indexOf(active) : -1;

	if (index === -1) return shift ? last : first;
	if (shift) return index === 0 ? last : elements[index - 1];
	return index === elements.length - 1 ? first : elements[index + 1];
}
