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

export {
  chartPalette,
  chartSeriesColor,
  CHART_PALETTE_SIZE,
} from './palette.js';

export {
  resolveSeriesColors,
  toFigureSeries,
  categoricalToFigure,
  type CartesianSeries,
  type LayerSeries,
  type KeyAccessor,
  type ValueAccessor,
} from './chart-series.js';

export {
  buildUPlotOptions,
  createUPlotChart,
  emptyAlignedData,
  loadUPlotModule,
  uPlotCtorFromModule,
  type AlignedData,
  type UPlotSeriesConfig,
  type UPlotChartConfig,
  type UPlotOptions,
  type UPlotOptionsSeries,
  type UPlotAxis,
  type UPlotScales,
  type UPlotInstance,
  type UPlotConstructor,
  type UPlotLoader,
  type CreateUPlotChartOptions,
  type UPlotChartHandle,
} from './uplot.js';
