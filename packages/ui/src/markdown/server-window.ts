/**
 * SSR-only seam: builds a jsdom `window` for DOMPurify when no browser DOM
 * exists. Isolated in its own module so the browser code path (guarded by the
 * `BROWSER` const in `sanitize.ts`) never imports jsdom, keeping the ~3 MB jsdom
 * cost out of client bundles while remaining a plain synchronous call on Node.
 */

import { JSDOM } from 'jsdom';
import type { WindowLike } from 'dompurify';

/** Create a fresh jsdom-backed `window` usable as a DOMPurify root. */
export function createServerWindow(): WindowLike {
	// jsdom's DOMWindow is structurally a superset of DOMPurify's WindowLike.
	return new JSDOM('').window;
}
