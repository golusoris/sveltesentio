import type { WindowLike } from 'dompurify';

/**
 * Browser variant of the `#server-window` seam: no jsdom import. `sanitize.ts`
 * uses the global DOMPurify in the browser and does not call this; it returns
 * the global object so that a call is still correct.
 */
export function createServerWindow(): WindowLike {
	return globalThis;
}
