/**
 * Headless LQIP (low-quality image placeholder) / blur-up helpers for the
 * `<Image>` wrapper. Builds the inline background style for the blurred
 * placeholder and resolves the layout-shift-free aspect ratio. Pure and
 * DOM-free so the styling logic is unit-tested without rendering.
 *
 * @see docs/compose/image-optimization.md — LCP < 2.5 s / CLS < 0.1 gates.
 */

/** A placeholder source: an inline data-URI (or any URL) plus an optional solid colour. */
export interface LqipPlaceholder {
	/** Tiny blurred image, typically a base64 data-URI. */
	readonly src?: string;
	/** Solid fallback colour shown before the blurred image decodes. */
	readonly color?: string;
}

/**
 * Build the `background` CSS for the placeholder layer. A data-URI / URL becomes
 * a covering `background-image` (with an optional solid colour beneath it);
 * a colour-only placeholder becomes a flat fill. Returns `undefined` when no
 * placeholder is supplied, so the caller can omit the layer entirely.
 */
export function buildPlaceholderStyle(placeholder: LqipPlaceholder | undefined): string | undefined {
	if (placeholder === undefined) return undefined;
	const { src, color } = placeholder;
	if (src !== undefined && src !== '') {
		const layers = [`url("${cssEscapeUrl(src)}") center / cover no-repeat`];
		if (color !== undefined && color !== '') layers.push(color);
		return `background: ${layers.join(', ')};`;
	}
	if (color !== undefined && color !== '') return `background: ${color};`;
	return undefined;
}

/** Escape the characters that would break out of a CSS `url("…")` token. */
function cssEscapeUrl(url: string): string {
	return url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Resolve an `aspect-ratio` CSS value from intrinsic width/height. Returns
 * `undefined` when either dimension is missing or non-positive, so the caller
 * only reserves space when it can do so correctly (avoids a wrong-ratio CLS).
 */
export function resolveAspectRatio(
	width: number | undefined,
	height: number | undefined,
): string | undefined {
	if (
		width === undefined ||
		height === undefined ||
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0 ||
		height <= 0
	) {
		return undefined;
	}
	return `${width} / ${height}`;
}

/** Loading priority for the underlying `<img>`. */
export type ImageLoadingPriority = 'auto' | 'high';

export interface ImageLoadingAttrs {
	readonly loading: 'lazy' | 'eager';
	readonly fetchpriority: 'high' | 'auto';
	readonly decoding: 'async';
}

/**
 * Derive the `loading` / `fetchpriority` / `decoding` attributes. `high`
 * priority (an above-the-fold LCP hero) eager-loads with `fetchpriority="high"`;
 * everything else lazy-loads. `decoding` is always `async` to keep the main
 * thread free.
 */
export function imageLoadingAttrs(priority: ImageLoadingPriority = 'auto'): ImageLoadingAttrs {
	return priority === 'high'
		? { loading: 'eager', fetchpriority: 'high', decoding: 'async' }
		: { loading: 'lazy', fetchpriority: 'auto', decoding: 'async' };
}
