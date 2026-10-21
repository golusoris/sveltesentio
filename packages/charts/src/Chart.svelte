<!--
@component
Chart — the low-level escape hatch (ADR-0013). Re-exports LayerChart's `Chart`
primitive wrapped in the mandatory <ChartFigure> a11y envelope so a custom
composition (annotations, multiple layers, exotic marks) still ships the
required text alternative. The caller renders LayerChart marks via the `chart`
snippet, which receives nothing — compose `Svg` / `Axis` / `Spline` etc. from
`layerchart` inside it. The SR data table is built from the same {series, x, y}
the caller draws, so the two cannot drift.

Kept thin: this package does not pin LayerChart's volatile v2-next API beyond
the simplified-chart `data` prop; the visual is entirely the caller's.
-->
<script lang="ts" generics="TDatum">
	import ChartFigure, { type ChartFigureProps } from './ChartFigure.svelte';

	const props: ChartFigureProps<TDatum> = $props();
</script>

<ChartFigure {...props} />
