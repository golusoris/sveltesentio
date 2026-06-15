/**
 * Headless carousel helpers shared by the `<Carousel>` shell and any consumer
 * driving `embla-carousel-svelte` directly: a preset-aware embla options
 * builder that bakes in the two obligations ADR-0012 leaves to the caller —
 * reduced-motion (collapse transition duration to 0) and target-size
 * (WCAG 2.5.8 nav-button sizing per interface preset). Pure and DOM-free.
 *
 * @see ADR-0012 (embla via shadcn) — the three consumer obligations.
 */

/** Interface-type preset governing nav-button target size (ADR-0047). */
export type CarouselPreset = 'desktop' | 'handheld' | 'tv';

/** Carousel scroll axis. */
export type CarouselOrientation = 'horizontal' | 'vertical';

/**
 * The subset of `embla-carousel`'s options this helper sets. Structural so the
 * package needs no `embla-carousel-svelte` dependency (it is an optional peer);
 * the result spreads onto embla's own options object.
 */
export interface EmblaOptionsLike {
	readonly loop: boolean;
	readonly align: 'start' | 'center' | 'end';
	readonly axis: 'x' | 'y';
	readonly duration: number;
	readonly dragFree: boolean;
	/**
	 * Per-media-query option overrides. The reduced-motion query collapses the
	 * transition duration so SC 2.3.3 / 2.2.2 are honoured without JS.
	 */
	readonly breakpoints: Readonly<Record<string, { readonly duration: number }>>;
}

export interface CarouselOptionsInput {
	/** Wrap from last slide to first. Default `false`. */
	readonly loop?: boolean;
	/** Slide alignment within the viewport. Default `'start'`. */
	readonly align?: 'start' | 'center' | 'end';
	/** Scroll axis. Default `'horizontal'`. */
	readonly orientation?: CarouselOrientation;
	/** Embla transition duration (embla time units). Default `25`. */
	readonly duration?: number;
	/** Allow free-scroll momentum dragging. Default `false`. */
	readonly dragFree?: boolean;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Build embla options with the reduced-motion breakpoint always present, so a
 * consumer who forgets obligation (a) from ADR-0012 still gets a
 * reduced-motion-correct carousel. The breakpoint sets `duration: 0` (instant
 * snap) under `prefers-reduced-motion: reduce`.
 */
export function buildCarouselOptions(input: CarouselOptionsInput = {}): EmblaOptionsLike {
	return {
		loop: input.loop ?? false,
		align: input.align ?? 'start',
		axis: (input.orientation ?? 'horizontal') === 'vertical' ? 'y' : 'x',
		duration: input.duration ?? 25,
		dragFree: input.dragFree ?? false,
		breakpoints: {
			[REDUCED_MOTION_QUERY]: { duration: 0 },
		},
	};
}

/**
 * Minimum CSS px target size for the carousel's prev/next buttons per preset.
 * `handheld` / `tv` upgrade to 44 px (WCAG 2.5.8 enhanced / touch + 10-foot
 * reach); `desktop` keeps the shadcn `size="icon"` 32 px default — above the
 * 24 px AA minimum (SC 2.5.8).
 */
export function navButtonTargetPx(preset: CarouselPreset): number {
	return preset === 'desktop' ? 32 : 44;
}

/** Whether the user has requested reduced motion. SSR-safe (`false` server-side). */
export function carouselPrefersReducedMotion(): boolean {
	if (typeof globalThis.matchMedia !== 'function') return false;
	return globalThis.matchMedia(REDUCED_MOTION_QUERY).matches;
}
