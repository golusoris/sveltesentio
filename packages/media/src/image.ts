/**
 * Pure responsive-image helpers: `srcset` / `sizes` string builders plus a
 * width-descriptor candidate model. Framework-agnostic — no DOM, no Svelte —
 * so the same logic drives a `<picture>`, an `<img srcset>`, or a server-side
 * `Link: rel=preload` header.
 */

/** A `src`-templating function: maps a target pixel width to a URL. */
export type SrcWidthTemplate = (width: number) => string;

/** One `srcset` candidate: a URL paired with its intrinsic pixel width. */
export interface SrcSetCandidate {
	readonly url: string;
	readonly width: number;
}

export interface SrcSetOptions {
	/**
	 * How to derive each candidate URL from a width. Either a template function
	 * or a token-substitution string containing `{w}` (replaced with the width).
	 * When omitted, `?w=<width>` is appended to `src` (or merged into an
	 * existing query string).
	 */
	readonly template?: SrcWidthTemplate | string;
}

const WIDTH_TOKEN = /\{w\}/g;

/** De-duplicate, drop non-positive/non-finite entries, and sort ascending. */
function normaliseWidths(widths: readonly number[]): number[] {
	const seen = new Set<number>();
	for (const w of widths) {
		if (Number.isFinite(w) && w > 0) seen.add(Math.round(w));
	}
	return [...seen].sort((a, b) => a - b);
}

/** Append/merge a `w` query param onto a URL without a URL parser dependency. */
function appendWidthQuery(src: string, width: number): string {
	const [base, hash = ''] = src.split('#', 2);
	const safeBase = base ?? src;
	const sep = safeBase.includes('?') ? '&' : '?';
	const suffix = hash ? `#${hash}` : '';
	return `${safeBase}${sep}w=${width}${suffix}`;
}

function resolveTemplate(
	src: string,
	template: SrcWidthTemplate | string | undefined,
): SrcWidthTemplate {
	if (typeof template === 'function') return template;
	if (typeof template === 'string') {
		return (width) => template.replace(WIDTH_TOKEN, String(width));
	}
	return (width) => appendWidthQuery(src, width);
}

/**
 * Build the structured candidate list backing a `srcset`. Widths are
 * normalised (de-duped, positive, integer, ascending) so callers can pass a
 * raw breakpoint list in any order.
 */
export function buildSrcSetCandidates(
	src: string,
	widths: readonly number[],
	options: SrcSetOptions = {},
): SrcSetCandidate[] {
	const resolved = resolveTemplate(src, options.template);
	return normaliseWidths(widths).map((width) => ({
		url: resolved(width),
		width,
	}));
}

/**
 * Build a `srcset` attribute string with `w` width descriptors, e.g.
 * `"/img?w=320 320w, /img?w=640 640w"`. Returns `""` for an empty width list.
 */
export function buildSrcSet(
	src: string,
	widths: readonly number[],
	options: SrcSetOptions = {},
): string {
	return buildSrcSetCandidates(src, widths, options)
		.map((c) => `${c.url} ${c.width}w`)
		.join(', ');
}

/** One `sizes` media-condition / length pair. */
export interface SizesRule {
	/** A media condition, e.g. `"(min-width: 768px)"`. */
	readonly condition: string;
	/** A CSS length, e.g. `"50vw"` or `"600px"`. */
	readonly size: string;
}

export interface BuildSizesOptions {
	/**
	 * The trailing default length applied when no condition matches. Defaults to
	 * `"100vw"` — the responsive-image-correct fallback for a fluid layout.
	 */
	readonly fallback?: string;
}

/**
 * Build a `sizes` attribute string from ordered conditional rules plus a
 * fallback length, e.g. `"(min-width: 768px) 50vw, 100vw"`. Rules are emitted
 * in array order — the browser uses the first matching condition.
 */
export function buildSizes(
	rules: readonly SizesRule[],
	options: BuildSizesOptions = {},
): string {
	const fallback = options.fallback ?? '100vw';
	const conditional = rules.map((r) => `${r.condition} ${r.size}`);
	return [...conditional, fallback].join(', ');
}

export interface ResponsiveImageAttrs {
	readonly src: string;
	readonly srcset: string;
	readonly sizes: string;
}

export interface BuildResponsiveImageOptions extends SrcSetOptions {
	readonly sizes?: readonly SizesRule[];
	readonly sizesFallback?: string;
	/**
	 * Which width to use for the legacy `src` fallback attribute. Defaults to
	 * the largest provided width so non-`srcset` browsers get full quality.
	 */
	readonly fallbackWidth?: number;
}

/**
 * Compose `{ src, srcset, sizes }` ready to spread onto an `<img>`. The `src`
 * fallback targets `fallbackWidth` (default: largest width) so legacy browsers
 * without `srcset` support still receive a sensibly-sized asset.
 */
export function buildResponsiveImage(
	src: string,
	widths: readonly number[],
	options: BuildResponsiveImageOptions = {},
): ResponsiveImageAttrs {
	const candidates = buildSrcSetCandidates(src, widths, options);
	const fallbackWidth =
		options.fallbackWidth ?? candidates.at(-1)?.width;
	const resolved = resolveTemplate(src, options.template);
	const fallbackSrc =
		fallbackWidth === undefined ? src : resolved(fallbackWidth);
	return {
		src: fallbackSrc,
		srcset: candidates.map((c) => `${c.url} ${c.width}w`).join(', '),
		sizes: buildSizes(options.sizes ?? [], {
			...(options.sizesFallback === undefined
				? {}
				: { fallback: options.sizesFallback }),
		}),
	};
}
