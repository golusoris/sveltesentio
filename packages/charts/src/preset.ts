// Dashboard preset — sensible LayerChart defaults for admin / observability
// panels (ADR-0013). Kept as a plain typed config object rather than a wrapped
// component so it survives LayerChart v2-next's volatile pre-release API: a
// consumer spreads these props onto `<Chart>` / `<Svg>` / `<Axis>` and adjusts
// only what differs. Pure data — no Svelte, no DOM.

/** Per-side inner padding (px) reserved for axes / labels. */
export interface ChartPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Grid-line visibility for the dashboard look. */
export interface GridPreset {
  readonly x: boolean;
  readonly y: boolean;
}

/** Tooltip behaviour defaults. `mode` mirrors LayerChart's `Tooltip` mode union. */
export interface TooltipPreset {
  readonly mode: 'bisect-x' | 'bisect-y' | 'bisect-band' | 'band' | 'voronoi' | 'quadtree';
  readonly snapToDataX: boolean;
  readonly snapToDataY: boolean;
}

/** Animation defaults; `duration` is 0 under reduced-motion. */
export interface MotionPreset {
  /** Tween duration in ms (0 disables). */
  readonly duration: number;
  /** D3 easing name hint for the consumer. */
  readonly easing: 'cubicOut' | 'linear';
}

/** The full dashboard preset surface. */
export interface DashboardPreset {
  readonly padding: ChartPadding;
  readonly grid: GridPreset;
  readonly tooltip: TooltipPreset;
  readonly motion: MotionPreset;
}

/** Options for {@link dashboardPreset}. */
export interface DashboardPresetOptions {
  /**
   * When `true`, motion duration collapses to 0 (WCAG 2.2 SC 2.3.3 / 2.2.2).
   * Pass `prefersReducedMotion()` from the component so it stays SSR-safe.
   */
  reducedMotion?: boolean;
  /** Override individual padding sides. */
  padding?: Partial<ChartPadding>;
}

const BASE_PADDING: ChartPadding = { top: 8, right: 16, bottom: 28, left: 40 };

/**
 * Build the dashboard chart preset. Defaults target a typical admin panel:
 * room for a bottom time axis + left value axis, both grids on, an x-bisect
 * tooltip, and a short cubic-out entry tween that is disabled under reduced
 * motion. Deterministic and pure — call it in `$derived` and it re-runs only
 * when its inputs change.
 */
/**
 * Fills each padding side from the override, falling back to the base per side.
 *
 * Per-side rather than whole-object so a caller widening only the left gutter for
 * long axis labels keeps the tuned defaults on the other three.
 */
function resolvePadding(override: Partial<ChartPadding> | undefined): ChartPadding {
  return {
    top: override?.top ?? BASE_PADDING.top,
    right: override?.right ?? BASE_PADDING.right,
    bottom: override?.bottom ?? BASE_PADDING.bottom,
    left: override?.left ?? BASE_PADDING.left,
  };
}

export function dashboardPreset(options: DashboardPresetOptions = {}): DashboardPreset {
  return {
    padding: resolvePadding(options.padding),
    grid: { x: true, y: true },
    tooltip: { mode: 'bisect-x', snapToDataX: true, snapToDataY: false },
    motion: options.reducedMotion
      ? { duration: 0, easing: 'linear' }
      : { duration: 300, easing: 'cubicOut' },
  };
}

/**
 * Read the user's reduced-motion preference. SSR-safe: returns `false` when
 * `matchMedia` is unavailable (server render), so first paint matches the
 * non-reduced default and the component can refine in an `$effect`.
 */
export function prefersReducedMotion(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
