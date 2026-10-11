/**
 * Server variant of the `#server-window` seam: builds a jsdom `window` for
 * DOMPurify when no browser DOM exists. The package.json `imports` map picks
 * the browser variant under the `browser` condition, which keeps jsdom out of
 * client bundles and out of the browser dev server.
 */

import { JSDOM } from 'jsdom';
import type { WindowLike } from 'dompurify';

/** Create a fresh jsdom-backed `window` usable as a DOMPurify root. */
export function createServerWindow(): WindowLike {
	// jsdom's DOMWindow is structurally a superset of DOMPurify's WindowLike.
	return new JSDOM('').window;
}
