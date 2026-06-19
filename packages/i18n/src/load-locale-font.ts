// Per-locale font loader (ADR-0018 a11y action item #6). A locale switch can
// pull in a different script — CJK, Arabic, Cyrillic — whose glyphs the base
// font does not cover, producing FOUT or wrong-script system fallbacks. This
// module injects the locale's font assets into <head> as <link> elements
// (preload + stylesheet), idempotently, and returns a cleanup function so a
// caller (e.g. <LangSync>) can revoke the previous locale's links on change.
//
// Pure DOM-only: the target `document` is injected, so it is unit-testable
// under jsdom / a fake document and SSR-safe (no-op when no document exists).
// No runes, no Svelte — keep all branching logic here, unit-tested.

/** A single font asset belonging to a locale's subset. */
export interface LocaleFontAsset {
	/**
	 * The font resource URL. Used both as the `<link href>` and, for preloads,
	 * the deduplication key.
	 */
	href: string;
	/**
	 * Link relationship. `'preload'` emits `<link rel="preload" as="font">`
	 * (early fetch, no FOUT); `'stylesheet'` emits a `@font-face`-bearing CSS
	 * file. Default `'preload'`.
	 */
	rel?: 'preload' | 'stylesheet';
	/**
	 * MIME type for the asset — e.g. `'font/woff2'`. Recommended for preloads so
	 * the browser can skip unsupported formats.
	 */
	type?: string;
	/**
	 * CORS mode. Fonts are CORS-fetched by spec; default `'anonymous'` for
	 * `rel="preload"` (required for the preload to be reused by the font load).
	 */
	crossOrigin?: 'anonymous' | 'use-credentials';
	/**
	 * Subresource Integrity hash (OWASP ASVS — SRI on CDN assets). Applied
	 * verbatim to the `integrity` attribute when present.
	 */
	integrity?: string;
}

/** Maps a locale (or locale prefix) to the font assets its script needs. */
export type LocaleFontMap = Readonly<Record<string, readonly LocaleFontAsset[]>>;

/** Options for {@link loadLocaleFont}. */
export interface LoadLocaleFontOptions {
	/** The active locale (BCP-47 tag, e.g. `'ja-JP'`). */
	locale: string;
	/** Locale → font-asset map. Resolved by exact tag, then language subtag. */
	fonts: LocaleFontMap;
	/**
	 * Target document. Defaults to the ambient `document`; injectable for tests
	 * and SSR (returns a no-op cleanup when no document is available).
	 */
	document?: Document;
	/**
	 * `data-*` attribute marker stamped on injected links so the loader can find
	 * and dedupe its own elements without clobbering caller links.
	 * Default `'data-sentio-locale-font'`.
	 */
	marker?: string;
}

const DEFAULT_MARKER = 'data-sentio-locale-font';

/** Resolve a locale's assets: exact tag first, then its language subtag. */
function resolveAssets(
	locale: string,
	fonts: LocaleFontMap,
): readonly LocaleFontAsset[] {
	const tag = locale.trim();
	if (tag.length === 0) return [];

	const exact = fonts[tag];
	if (exact) return exact;

	const language = tag.split(/[-_]/)[0]?.toLowerCase() ?? '';
	if (language.length > 0 && language !== tag) {
		const byLanguage = fonts[language];
		if (byLanguage) return byLanguage;
	}
	return [];
}

/**
 * Inject the active locale's font links into `<head>`, idempotently.
 *
 * Calling this repeatedly for the same locale does not create duplicate links:
 * an existing link with the same marker, `rel`, and `href` is reused. The
 * returned function removes exactly the links this call is responsible for
 * (links it created plus any it found and reused), making it safe to call on
 * teardown or before loading the next locale.
 *
 * SSR / no-DOM safe: returns a no-op cleanup when no document is available.
 */
export function loadLocaleFont(options: LoadLocaleFontOptions): () => void {
	const doc =
		options.document ?? (typeof document === 'undefined' ? undefined : document);
	if (!doc) return () => {};

	const head = doc.head;
	if (!head) return () => {};

	const marker = options.marker ?? DEFAULT_MARKER;
	const assets = resolveAssets(options.locale, options.fonts);
	if (assets.length === 0) return () => {};

	const links: HTMLLinkElement[] = [];

	for (const asset of assets) {
		const rel = asset.rel ?? 'preload';
		const existing = head.querySelector<HTMLLinkElement>(
			`link[${marker}][rel="${rel}"][href="${cssEscape(asset.href)}"]`,
		);
		if (existing) {
			links.push(existing);
			continue;
		}

		// §2.1 direct-DOM exception: font preload/stylesheet <link>s must live in <head>,
		// which a body-scoped use: action cannot target; doc is injected (SSR-safe + tested).
		const link = doc.createElement('link');
		link.setAttribute(marker, '');
		link.rel = rel;
		link.href = asset.href;
		if (rel === 'preload') link.setAttribute('as', 'font');

		const crossOrigin = asset.crossOrigin ?? (rel === 'preload' ? 'anonymous' : undefined);
		// Set via attributes (not IDL props) so they reflect to the DOM
		// consistently across runtimes — jsdom does not reflect `integrity`.
		if (crossOrigin) link.setAttribute('crossorigin', crossOrigin);
		if (asset.type) link.setAttribute('type', asset.type);
		if (asset.integrity) link.setAttribute('integrity', asset.integrity);

		head.appendChild(link);
		links.push(link);
	}

	return () => {
		for (const link of links) {
			link.parentNode?.removeChild(link);
		}
	};
}

/**
 * Escape a string for safe interpolation into the attribute-value portion of a
 * CSS selector. Uses the platform `CSS.escape` when present, else escapes the
 * characters significant inside a double-quoted attribute selector.
 */
function cssEscape(value: string): string {
	const platform = (
		globalThis as { CSS?: { escape?: (value: string) => string } }
	).CSS;
	if (platform?.escape) return platform.escape(value);
	return value.replace(/["\\]/g, '\\$&');
}
