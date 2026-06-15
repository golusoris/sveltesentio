/**
 * `renderMarkdown` — the runtime markdown XSS boundary (ADR-0026). Pipeline:
 * `marked.parse()` (untrusted markdown → raw HTML) then `DOMPurify.sanitize()`
 * with the hardened {@link ALLOWLIST}. Works in BOTH the browser (global
 * `window` DOMPurify) and SSR/Node (jsdom-backed DOMPurify) behind an
 * auto-detected window seam. The SSR path is mandatory — apps render markdown
 * server-side and some flows ship the rendered HTML onward.
 */

import { BROWSER } from 'esm-env';
import { Marked } from 'marked';
import createDOMPurify, { type Config, type DOMPurify, type WindowLike } from 'dompurify';
import { ALLOWLIST } from './allowlist.js';
import { createServerWindow } from './server-window.js';

export { ALLOWLIST, ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP } from './allowlist.js';

/** Options for {@link renderMarkdown}. */
export interface RenderMarkdownOptions {
	/**
	 * Tighten the DOMPurify config for a single call. Merged over
	 * {@link ALLOWLIST}, but the security floor (URI allowlist, unknown-protocol
	 * + data-attribute rejection, the forbidden-tag/attr set) is ALWAYS
	 * re-applied afterwards and danger-widening keys are dropped — so this can
	 * only restrict, never widen, the allowlist. See {@link mergeConfig}.
	 */
	readonly config?: Config;
	/**
	 * Inject a DOM `window` for sanitisation. Defaults to the global `window` in
	 * the browser and a lazily-created jsdom window on the server. Used by tests
	 * and advanced SSR setups.
	 */
	readonly window?: WindowLike;
	/** Enable GitHub-Flavoured Markdown (tables, strikethrough, ...). Default `true`. */
	readonly gfm?: boolean;
}

/** A configured `marked` instance: GFM on, synchronous, no HTML pass-through tricks. */
const marked = new Marked({ gfm: true, breaks: false, async: false });

/** Only these `data:` image MIME types are permitted; `svg+xml` is scriptable. */
const SAFE_DATA_URI = /^data:image\/(?:png|jpe?g|gif|webp)[;,]/i;

/**
 * Strip C0 controls + space (code point ≤ 0x20) from a URL before a protocol
 * test — browsers ignore them in attribute values, so an attacker could splice
 * them into `da\tta:` to mask a `data:` URI from a naive prefix check.
 */
function stripControlChars(value: string): string {
	let out = '';
	for (const ch of value) if (ch.charCodeAt(0) > 0x20) out += ch;
	return out;
}

/**
 * DOMPurify keys a caller config may NOT set — each can re-enable XSS (raw-HTML
 * profiles, arbitrary added tags/attrs/safe-URI attrs, returning live DOM).
 * Stripped from caller config so the `config` option is tighten-only.
 */
const FORBIDDEN_OVERRIDE_KEYS = [
	'ADD_TAGS',
	'ADD_ATTR',
	'ADD_URI_SAFE_ATTR',
	'ADD_DATA_URI_TAGS',
	'WHOLE_DOCUMENT',
	'USE_PROFILES',
	'RETURN_DOM',
	'RETURN_DOM_FRAGMENT',
	'RETURN_DOM_IMPORT',
] as const;

/**
 * Merge a caller config over {@link ALLOWLIST} as a TIGHTEN-ONLY surface. The
 * caller may restrict the tag/attr lists, but the security floor is forced back
 * on AFTER their config (a shallow `{...ALLOWLIST, ...config}` would let a
 * caller-supplied `ALLOWED_URI_REGEXP` re-admit `javascript:` with no backstop),
 * and danger-widening keys are deleted. So the documented escape hatch cannot
 * re-open XSS.
 */
function mergeConfig(config?: Config): Config {
	if (!config) return ALLOWLIST;
	const merged: Config = { ...ALLOWLIST, ...config };
	for (const key of FORBIDDEN_OVERRIDE_KEYS) {
		delete (merged as Record<string, unknown>)[key];
	}
	merged.FORBID_TAGS = [...new Set([...(config.FORBID_TAGS ?? []), ...(ALLOWLIST.FORBID_TAGS ?? [])])];
	merged.FORBID_ATTR = [...new Set([...(config.FORBID_ATTR ?? []), ...(ALLOWLIST.FORBID_ATTR ?? [])])];
	merged.ALLOWED_URI_REGEXP = ALLOWLIST.ALLOWED_URI_REGEXP;
	merged.ALLOW_UNKNOWN_PROTOCOLS = false;
	merged.ALLOW_DATA_ATTR = false;
	return merged;
}

/**
 * Post-sanitise hardening hook (runs inside DOMPurify on the parsed DOM):
 *
 * 1. Drops `data:` URIs on `src`/`href`/`xlink:href` unless they are a safe
 *    image MIME. DOMPurify's `DATA_URI_TAGS` allowance lets ANY `data:` through
 *    on `<img>` etc. regardless of `ALLOWED_URI_REGEXP`, so this closes the
 *    `data:image/svg+xml` (scriptable) bypass.
 * 2. Adds `rel="noopener noreferrer"` + `target="_blank"` to external links
 *    (including protocol-relative `//host`) — robust against inline-token
 *    smuggling a `marked` renderer override misses.
 */
function hardenNode(node: Element): void {
	for (const attr of ['src', 'href', 'xlink:href']) {
		const value = node.getAttribute(attr);
		// Strip C0 controls + space before the protocol test so none can mask a
		// `data:` URI (see stripControlChars).
		if (value && /^data:/i.test(stripControlChars(value)) && !SAFE_DATA_URI.test(value)) {
			node.removeAttribute(attr);
		}
	}

	if (node.tagName !== 'A') return;
	const href = node.getAttribute('href') ?? '';
	// Protocol-relative (`//host`) links are external too — rel-harden them.
	if (/^(?:https?:)?\/\//i.test(href)) {
		node.setAttribute('target', '_blank');
		node.setAttribute('rel', 'noopener noreferrer');
	} else if (node.hasAttribute('target')) {
		// A relative/anchor link should not force a new tab; keep rel safe anyway.
		node.setAttribute('rel', 'noopener noreferrer');
	}
}

/** Cache of jsdom-backed instances keyed by the window object that built them. */
const purifierCache = new WeakMap<object, DOMPurify>();

/** A lazily-created server `window` (jsdom), shared across SSR calls. */
let serverWindow: WindowLike | undefined;

/** Resolve a DOMPurify instance bound to the right window, with hooks installed. */
function getPurifier(injected?: WindowLike): DOMPurify {
	if (BROWSER && !injected) {
		// In the browser the default export is already bound to the global window.
		return withHooks(createDOMPurify);
	}

	const win = injected ?? getServerWindow();
	const cached = purifierCache.get(win);
	if (cached) return cached;
	const instance = withHooks(createDOMPurify(win));
	purifierCache.set(win, instance);
	return instance;
}

/** Install the link-hardening hook on an instance exactly once. */
const hooked = new WeakSet<object>();
function withHooks(instance: DOMPurify): DOMPurify {
	if (!hooked.has(instance)) {
		instance.addHook('afterSanitizeAttributes', hardenNode);
		hooked.add(instance);
	}
	return instance;
}

/** Create (once) and return the jsdom-backed SSR window. */
function getServerWindow(): WindowLike {
	if (serverWindow) return serverWindow;
	serverWindow = createServerWindow();
	return serverWindow;
}

/**
 * Render untrusted markdown to a SAFE HTML string. Always sanitised; there is no
 * unsanitised path through this function. Returns `''` for empty/blank input.
 */
export function renderMarkdown(source: string, options: RenderMarkdownOptions = {}): string {
	if (!source) return '';
	const { config, window: injected, gfm } = options;

	const raw =
		gfm === false
			? new Marked({ gfm: false, async: false }).parse(source, { async: false })
			: marked.parse(source, { async: false });

	const purifier = getPurifier(injected);
	return purifier.sanitize(raw, mergeConfig(config));
}
