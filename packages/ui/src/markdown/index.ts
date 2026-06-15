/**
 * `@sveltesentio/ui/markdown` — the runtime markdown XSS boundary (ADR-0026).
 * `marked` (parse) → `DOMPurify` (sanitise) behind one hardened, auditable
 * allowlist. Use `<Markdown source={value} />` for components, or the pure
 * `renderMarkdown(source)` for non-Svelte sinks. Both SSR (jsdom) and browser.
 *
 * The thin `Markdown.svelte` component is exported via the package's
 * `./markdown/Markdown.svelte` / `svelte` export condition; `tsc` does not
 * type-check `.svelte`, so the tested logic lives in `./sanitize.ts`.
 */

export {
	renderMarkdown,
	type RenderMarkdownOptions,
	ALLOWLIST,
	ALLOWED_TAGS,
	ALLOWED_ATTR,
	ALLOWED_URI_REGEXP,
} from './sanitize.js';
