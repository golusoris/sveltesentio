// uPlot-backed, reduced-motion-aware, a11y-wrapped charts.
import { dashboardPreset, chartPalette, prefersReducedMotion } from '@sveltesentio/charts';

const opts = dashboardPreset({
  series: [{ label: 'Requests', stroke: chartPalette.primary }],
  animate: !prefersReducedMotion(),
});
