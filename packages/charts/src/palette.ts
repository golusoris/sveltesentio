// Semantic chart-series palette (ADR-0013). The palette is *semantic, not
// decorative*: series N maps to the `--color-chart-N` custom property that the
// shadcn-svelte Chart theme already emits (LayerChart's simplified charts read
// the same convention). Each entry falls back to an oklch literal so a chart
// renders with distinguishable, WCAG-contrast-aware hues even when a consumer
// has not wired the theme variables. Pure data — no Svelte, no DOM — so it is
// unit-testable in plain Node.

/**
 * oklch fallback hues for series 1..5. Chosen for perceptual separation and
 * to stay legible on both light and dark surfaces; superseded at runtime by
 * the `--color-chart-N` theme variable when present.
 */
const CHART_OKLCH_FALLBACKS: readonly string[] = [
	'oklch(0.646 0.222 41.116)',
	'oklch(0.6 0.118 184.704)',
	'oklch(0.398 0.07 227.392)',
	'oklch(0.828 0.189 84.429)',
	'oklch(0.769 0.188 70.08)',
];

/** Number of distinct semantic series colors before the palette repeats. */
export const CHART_PALETTE_SIZE = CHART_OKLCH_FALLBACKS.length;

/**
 * The full ordered palette as CSS color strings, each
 * `var(--color-chart-N, <oklch fallback>)`. Index 0 is series 1.
 */
export const chartPalette: readonly string[] = CHART_OKLCH_FALLBACKS.map(
	(fallback, i) => `var(--color-chart-${i + 1}, ${fallback})`,
);

/**
 * Resolve the semantic color for series `index` (0-based). Wraps around the
 * palette so charts with more than {@link CHART_PALETTE_SIZE} series still get
 * a deterministic, repeatable color rather than `undefined`.
 */
export function chartSeriesColor(index: number): string {
	if (!Number.isFinite(index) || index < 0) return chartPalette[0]!;
	return chartPalette[Math.floor(index) % CHART_PALETTE_SIZE]!;
}
