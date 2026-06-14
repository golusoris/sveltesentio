// @sveltesentio/charts — LayerChart-backed chart wrappers with a baked-in
// accessibility envelope (ADR-0013). The <ChartFigure> component is exported
// from its own subpath (`@sveltesentio/charts/figure`) because plain `tsc`
// does not resolve `.svelte` modules; the type-checked, unit-tested core
// (data-table model + dashboard preset) is re-exported here.

export {
  buildDataTableModel,
  type ChartSeries,
  type ChartAccessors,
  type BuildTableOptions,
  type DataTableRow,
  type DataTableModel,
} from './a11y-table.js';

export {
  dashboardPreset,
  prefersReducedMotion,
  type DashboardPreset,
  type DashboardPresetOptions,
  type ChartPadding,
  type GridPreset,
  type TooltipPreset,
  type MotionPreset,
} from './preset.js';
