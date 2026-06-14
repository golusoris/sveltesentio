// Pure, framework-agnostic builder for the screen-reader data-table fallback
// that every chart rendered through <ChartFigure> must expose (ADR-0013 §3).
// Charts are inaccessible without a structured text alternative (WCAG 2.2 AA,
// SC 1.1.1 Non-text Content). This module turns {series, x, y} into a normalised
// table model that the Svelte component renders verbatim — no DOM, no runes,
// so it is unit-testable in plain Node.

/** A single data series (one line / bar group / scatter cluster). */
export interface ChartSeries<TDatum> {
  /** Stable key — used for the table column header and as the React-less list key. */
  key: string;
  /** Human label for the column header; falls back to {@link key}. */
  label?: string;
  /** The ordered data points for this series. */
  data: readonly TDatum[];
}

/** Maps a datum to its x (category / time) and y (value) cells. */
export interface ChartAccessors<TDatum> {
  x: (datum: TDatum) => string | number;
  y: (datum: TDatum) => number | null | undefined;
}

/** Formatting + labelling options for the generated table. */
export interface BuildTableOptions<TDatum> {
  /** Header for the x-axis (category) column. Default: `"Category"`. */
  xLabel?: string;
  /** Formats an x value into its cell text. Default: `String(value)`. */
  formatX?: (value: string | number) => string;
  /** Formats a y value into its cell text. Default: localized number, `"—"` for nullish. */
  formatY?: (value: number | null | undefined, series: ChartSeries<TDatum>) => string;
}

/** One row of the data table: an x value plus one cell per series. */
export interface DataTableRow {
  /** The raw x value (key for the row). */
  readonly x: string | number;
  /** Formatted x cell text. */
  readonly head: string;
  /** Formatted y cell text per series, aligned to {@link DataTableModel.columns}. */
  readonly cells: readonly string[];
}

/** The normalised table model consumed by <ChartFigure>'s off-screen `<table>`. */
export interface DataTableModel {
  /** x-axis column header. */
  readonly xLabel: string;
  /** Series column headers, in stable order. */
  readonly columns: readonly string[];
  /** One row per distinct x value, in first-seen order. */
  readonly rows: readonly DataTableRow[];
}

const defaultFormatY = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat().format(value);
};

/**
 * Build the screen-reader data-table model from one or more chart series.
 *
 * Rows are keyed by x value and unioned across series in first-seen order, so a
 * sparse series (missing some x values) still renders `"—"` in the gaps rather
 * than mis-aligning columns. Pure — safe to call in SSR and in tests.
 */
export function buildDataTableModel<TDatum>(
  series: readonly ChartSeries<TDatum>[],
  accessors: ChartAccessors<TDatum>,
  options: BuildTableOptions<TDatum> = {},
): DataTableModel {
  const xLabel = options.xLabel ?? 'Category';
  const formatX = options.formatX ?? ((value) => String(value));
  const formatY = options.formatY ?? ((value) => defaultFormatY(value));

  const columns = series.map((s) => s.label ?? s.key);

  // Union of x values in first-seen order, with per-series lookup tables.
  const order: (string | number)[] = [];
  const seen = new Set<string>();
  const lookups: Map<string, number | null | undefined>[] = [];

  for (const s of series) {
    const lookup = new Map<string, number | null | undefined>();
    for (const datum of s.data) {
      const xValue = accessors.x(datum);
      const xKey = String(xValue);
      if (!seen.has(xKey)) {
        seen.add(xKey);
        order.push(xValue);
      }
      lookup.set(xKey, accessors.y(datum));
    }
    lookups.push(lookup);
  }

  const rows: DataTableRow[] = order.map((xValue) => {
    const xKey = String(xValue);
    const cells = series.map((s, i) => {
      const lookup = lookups[i];
      const yValue = lookup?.has(xKey) ? lookup.get(xKey) : undefined;
      return formatY(yValue, s);
    });
    return { x: xValue, head: formatX(xValue), cells };
  });

  return { xLabel, columns, rows };
}
