/**
 * Hardened DOMPurify allowlist for runtime markdown (ADR-0026). This is the
 * framework's XSS boundary; every `innerHTML` sink in `ui/markdown` runs
 * through it. Exported so it is auditable and overridable per call, but changes
 * to the default go via ADR amendment — it is a security boundary, not
 * ergonomics.
 */

import type { Config } from 'dompurify';

/**
 * Tags markdown is permitted to emit. No `script`/`style`/`iframe`/`object`/
 * `embed`/`form` — each is an XSS or injection sink. Unknown tags are stripped.
 */
export const ALLOWED_TAGS: readonly string[] = [
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'p',
	'br',
	'hr',
	'span',
	'div',
	'strong',
	'b',
	'em',
	'i',
	'del',
	's',
	'code',
	'pre',
	'kbd',
	'blockquote',
	'ul',
	'ol',
	'li',
	'a',
	'img',
	'table',
	'thead',
	'tbody',
	'tfoot',
	'tr',
	'th',
	'td',
];

/**
 * Attributes markdown is permitted to keep. No `style` (CSS-injection vector)
 * and no `on*` handlers (DOMPurify strips those by construction).
 */
export const ALLOWED_ATTR: readonly string[] = [
	'href',
	'title',
	'src',
	'alt',
	'rel',
	'target',
	'class',
	'align',
	'width',
	'height',
	'loading',
];

/**
 * URI protocol allowlist applied by DOMPurify. Permits `http`/`https`/`mailto`/
 * `tel`, relative URLs (`/path`, `#frag`, `?q`, `./`, `../`), and image-only
 * `data:` URIs (png/jpeg/gif/webp — svg excluded: scriptable). Blocks
 * `javascript:`, `vbscript:`, and `data:text/html` smuggling. A second
 * `afterSanitizeAttributes` hook re-checks `data:` because DOMPurify's
 * `DATA_URI_TAGS` allowance can bypass this regex on `<img>`.
 */
export const ALLOWED_URI_REGEXP =
	/^(?:https?:\/\/|mailto:|tel:|\/|#|\?|\.\/|\.\.\/|data:image\/(?:png|jpe?g|gif|webp)[;,])/i;

/**
 * Default hardened config passed to `DOMPurify.sanitize`. Frozen so callers can
 * read but not mutate the shared default; pass an override object to change it.
 */
export const ALLOWLIST: Config = Object.freeze({
	ALLOWED_TAGS: [...ALLOWED_TAGS],
	ALLOWED_ATTR: [...ALLOWED_ATTR],
	ALLOWED_URI_REGEXP,
	// Belt-and-braces: never allow these even if the tag list is overridden.
	FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'svg', 'math'],
	FORBID_ATTR: ['style', 'srcset'],
	// Reject unknown protocols entirely rather than keeping the attribute.
	ALLOW_UNKNOWN_PROTOCOLS: false,
	// Markdown has no need for `data-*`; attacker-controlled ones can become a
	// sink if app code re-reads them (action params, analytics, hydration).
	ALLOW_DATA_ATTR: false,
	// Keep the text content of an unwrapped tag (DOMPurify already drops the
	// content of dangerous tags like <script>/<style> regardless of this flag),
	// so legitimate inner text inside <code>/<td>/<th> survives sanitisation.
	KEEP_CONTENT: true,
	// We return a string, not a DOM node/fragment.
	RETURN_DOM: false,
	RETURN_DOM_FRAGMENT: false,
});
