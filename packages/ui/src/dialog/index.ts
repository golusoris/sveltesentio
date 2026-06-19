/**
 * `@sveltesentio/ui/dialog` — peer-free modal dialog matching the shadcn-svelte
 * Dialog surface (ADR-0014). The pure focus-trap + class logic is exported and
 * unit-tested here; the thin `Dialog.svelte` view ships via the package's `svelte`
 * export condition. Swap for the CLI-delivered shadcn Dialog (`bits-ui`) when you
 * need its full composition API.
 */

export {
	DIALOG_OVERLAY,
	DIALOG_CONTENT,
	FOCUSABLE_SELECTOR,
	dialogContentClass,
	focusableElements,
	nextTrapTarget,
} from './dialog.js';
