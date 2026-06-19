// High-frequency / >5k-point escape hatch over uPlot (ADR-0013, recipe in
// docs/compose/charts-realtime.md). LayerChart's SVG pipeline degrades past
// ~5k visible points or ≥30 Hz refresh; uPlot is a canvas-only ~40 KB library
// that handles those feeds. It is an *optional* peer: this module never imports
// `uplot` at the top level, so the base `@sveltesentio/charts` bundle stays
// clean. The constructor is loaded via dynamic `import('uplot')` at mount time,
// or supplied directly (for tests / pre-bundled apps) via the `uPlot` option.
//
// The data→options mapping is split into the pure `buildUPlotOptions()` so it is
// unit-testable in plain Node without a canvas, a DOM, or uPlot installed. The
// lifecycle handle (`mount` / `update` / `setSize` / `destroy`) is exercised
// against an injected fake constructor.

import { chartSeriesColor } from './palette.js';

/**
 * uPlot's aligned-data shape: the first array is the shared x scale (typically
 * unix-seconds timestamps), each subsequent array is one series' y values,
 * index-aligned to x. `null` marks a gap. Mirrors uPlot's `AlignedData`.
 */
export type AlignedData = readonly [
  xValues: readonly number[],
  ...seriesValues: readonly (readonly (number | null)[])[],
];

/** A configured y-series for the realtime chart (one canvas line). */
export interface UPlotSeriesConfig {
  /** Human label — column header in the SR table, legend label in uPlot. */
  readonly label: string;
  /** Stroke color; defaults to the semantic palette slot for its index. */
  readonly stroke?: string;
  /** Stroke width in px. Default `1` — thin lines keep dense series legible. */
  readonly width?: number;
  /** Optional fill color under the line (area style). */
  readonly fill?: string;
}

/** Inputs to {@link buildUPlotOptions}. Pure data — no DOM, no uPlot. */
export interface UPlotChartConfig {
  /** Canvas width in px. */
  readonly width: number;
  /** Canvas height in px. */
  readonly height: number;
  /** One entry per y-series, in x-aligned order. */
  readonly series: readonly UPlotSeriesConfig[];
  /** Axis stroke color (both axes share it). Default a 60%-opacity fg token. */
  readonly axisStroke?: string;
  /** When `true`, the x scale is treated as unix-time. Default `true`. */
  readonly time?: boolean;
}

/** uPlot axis descriptor (the subset this wrapper emits). */
export interface UPlotAxis {
  readonly stroke: string;
}

/** uPlot scales descriptor (the subset this wrapper emits). */
export interface UPlotScales {
  readonly x: { readonly time: boolean };
}

/** One series entry in uPlot's options. Index 0 is the implicit x series. */
export interface UPlotOptionsSeries {
  /** Present only on y-series; the x-series entry is label-less. */
  readonly label?: string;
  readonly stroke?: string;
  readonly width?: number;
  readonly fill?: string;
}

/**
 * The uPlot options object this wrapper produces. Structurally compatible with
 * uPlot's `Options` for the fields we set — passed straight to `new uPlot(...)`.
 */
export interface UPlotOptions {
  readonly width: number;
  readonly height: number;
  readonly series: readonly UPlotOptionsSeries[];
  readonly scales: UPlotScales;
  readonly axes: readonly UPlotAxis[];
}

/** Minimal structural view of a live uPlot instance (the methods we drive). */
export interface UPlotInstance {
  setData(data: AlignedData): void;
  setSize(size: { width: number; height: number }): void;
  destroy(): void;
}

/**
 * Structural type of uPlot's default export — `new uPlot(opts, data, target)`.
 * Injected in tests; otherwise resolved from `import('uplot')` at mount.
 */
export type UPlotConstructor = new (
  opts: UPlotOptions,
  data: AlignedData,
  target: HTMLElement,
) => UPlotInstance;

/** Resolves the uPlot constructor — the default dynamic-imports `uplot`. */
export type UPlotLoader = () => Promise<UPlotConstructor>;

/** Options for {@link createUPlotChart}. */
export interface CreateUPlotChartOptions {
  /** The chart geometry + series mapping. */
  readonly config: UPlotChartConfig;
  /** Initial aligned data. Defaults to one empty x array + empty per series. */
  readonly data?: AlignedData;
  /**
   * Inject the uPlot constructor synchronously (tests, or apps that pre-bundle
   * uPlot). Takes precedence over {@link CreateUPlotChartOptions.loadUPlot}.
   */
  readonly uPlot?: UPlotConstructor;
  /**
   * Override how the constructor is loaded on first mount. Defaults to
   * {@link loadUPlotModule}, which dynamic-imports `uplot` so the base bundle
   * never pulls in the ~40 KB canvas library. Primarily a test seam.
   */
  readonly loadUPlot?: UPlotLoader;
}

/** The handle returned by {@link createUPlotChart}. */
export interface UPlotChartHandle {
  /**
   * Instantiate uPlot into `target`. Resolves once the canvas is live. Calling
   * twice without {@link UPlotChartHandle.destroy} is a no-op on the second
   * call (the first instance stays mounted) to avoid leaking canvases.
   */
  mount(target: HTMLElement): Promise<void>;
  /** Replace the chart data. No-op before {@link UPlotChartHandle.mount}. */
  update(data: AlignedData): void;
  /** Resize the canvas. No-op before {@link UPlotChartHandle.mount}. */
  setSize(size: { width: number; height: number }): void;
  /** Tear down the uPlot instance and release the canvas. Idempotent. */
  destroy(): void;
  /** The options object derived from `config` (frozen). Stable across calls. */
  readonly options: UPlotOptions;
  /** `true` between a resolved {@link UPlotChartHandle.mount} and `destroy`. */
  readonly mounted: boolean;
}

const DEFAULT_AXIS_STROKE = 'var(--color-fg, oklch(0.2 0 0))';
const DEFAULT_SERIES_WIDTH = 1;

/**
 * Build a uPlot empty-data tuple for `seriesCount` y-series: one empty x array
 * plus one empty array per series, so `new uPlot(opts, emptyData(n), el)` is
 * valid before any samples have streamed in.
 */
export function emptyAlignedData(seriesCount: number): AlignedData {
  const count = Number.isFinite(seriesCount) && seriesCount > 0 ? Math.floor(seriesCount) : 0;
  const series: (readonly (number | null)[])[] = [];
  for (let i = 0; i < count; i += 1) series.push([]);
  return [[], ...series];
}

/** Narrows a dynamically-imported `uplot` module to its default constructor. */
export function uPlotCtorFromModule(mod: unknown): UPlotConstructor {
  const ctor = (mod as { default?: unknown }).default;
  if (typeof ctor !== 'function') {
    throw new Error('@sveltesentio/charts: "uplot" did not provide a default export constructor.');
  }
  return ctor as UPlotConstructor;
}

/**
 * Default uPlot loader: dynamic-imports the optional `uplot` peer and returns
 * its default-export constructor. Throws a directive error when the peer is not
 * installed or exports no constructor. Kept separate so {@link createUPlotChart}
 * can stay synchronous up to mount and so the load path is independently testable
 * via the injectable `importModule` seam.
 */
export async function loadUPlotModule(
  importModule: () => Promise<unknown> = () => import(/* @vite-ignore */ 'uplot'),
): Promise<UPlotConstructor> {
  // uPlot is an OPTIONAL peer — only loaded when a consumer actually mounts a
  // uPlot chart, so the base bundle never pulls in the ~40 KB canvas library.
  // It has no Svelte 5 surface to type-check against and is not a dev dependency
  // of this package, so the module is resolved structurally through `unknown`.
  let mod: unknown;
  try {
    mod = await importModule();
  } catch (cause) {
    throw new Error(
      '@sveltesentio/charts createUPlotChart() requires the optional peer "uplot". Install it (pnpm add uplot) or inject a constructor via the `uPlot` option.',
      { cause },
    );
  }
  return uPlotCtorFromModule(mod);
}

/**
 * Map the typed {@link UPlotChartConfig} to a uPlot `Options` object. Pure and
 * deterministic — no DOM, no uPlot, no clock. Series colors default to the
 * semantic palette (same `--color-chart-N` tokens as the LayerChart path), so a
 * uPlot panel and a LayerChart panel on the same dashboard share hues.
 *
 * The leading options series entry (index 0) is the implicit x series uPlot
 * requires and carries no label; y-series follow in `config.series` order.
 */
export function buildUPlotOptions(config: UPlotChartConfig): UPlotOptions {
  const axisStroke = config.axisStroke ?? DEFAULT_AXIS_STROKE;
  const time = config.time ?? true;

  const ySeries: UPlotOptionsSeries[] = config.series.map((s, i) => {
    const entry: { -readonly [K in keyof UPlotOptionsSeries]: UPlotOptionsSeries[K] } = {
      label: s.label,
      stroke: s.stroke ?? chartSeriesColor(i),
      width: s.width ?? DEFAULT_SERIES_WIDTH,
    };
    if (s.fill !== undefined) entry.fill = s.fill;
    return entry;
  });

  return {
    width: config.width,
    height: config.height,
    // Index 0 is uPlot's implicit x series — no stroke / label of its own.
    series: [{}, ...ySeries],
    scales: { x: { time } },
    // Two axes (x bottom, y left) share the muted token stroke.
    axes: [{ stroke: axisStroke }, { stroke: axisStroke }],
  };
}

/**
 * Create a uPlot chart handle. The data→options mapping runs eagerly (pure), so
 * `handle.options` is available immediately; the canvas is created lazily on
 * {@link UPlotChartHandle.mount}, which loads the constructor via
 * {@link loadUPlotModule} (dynamic `import('uplot')`) unless one was injected via
 * {@link CreateUPlotChartOptions.uPlot} / {@link CreateUPlotChartOptions.loadUPlot}.
 *
 * `update` / `setSize` before mount (or after destroy) are safe no-ops, so a
 * component can stream data into the handle and let the first resolved mount
 * pick up the latest snapshot.
 */
export function createUPlotChart(options: CreateUPlotChartOptions): UPlotChartHandle {
  const opts = Object.freeze(buildUPlotOptions(options.config));
  let data: AlignedData = options.data ?? emptyAlignedData(options.config.series.length);
  let instance: UPlotInstance | null = null;

  const load: UPlotLoader = options.loadUPlot ?? loadUPlotModule;

  async function resolveCtor(): Promise<UPlotConstructor> {
    if (options.uPlot) return options.uPlot;
    return load();
  }

  return {
    options: opts,
    get mounted(): boolean {
      return instance !== null;
    },
    async mount(target: HTMLElement): Promise<void> {
      if (instance !== null) return;
      const Ctor = await resolveCtor();
      instance = new Ctor(opts, data, target);
    },
    update(next: AlignedData): void {
      data = next;
      instance?.setData(next);
    },
    setSize(size: { width: number; height: number }): void {
      instance?.setSize(size);
    },
    destroy(): void {
      instance?.destroy();
      instance = null;
    },
  };
}
