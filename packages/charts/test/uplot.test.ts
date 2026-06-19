import { describe, expect, it, vi } from 'vitest';
import {
  buildUPlotOptions,
  createUPlotChart,
  emptyAlignedData,
  loadUPlotModule,
  uPlotCtorFromModule,
  type AlignedData,
  type UPlotConstructor,
  type UPlotInstance,
  type UPlotOptions,
} from '../src/uplot.js';
import { chartSeriesColor } from '../src/palette.js';

// A fake uPlot constructor: records its construction args and the calls made on
// the instance, so the lifecycle handle can be driven without a canvas / DOM.
interface FakeRecord {
  readonly opts: UPlotOptions;
  readonly data: AlignedData;
  readonly target: HTMLElement;
  readonly instance: FakeInstance;
}

interface FakeInstance extends UPlotInstance {
  readonly setDataCalls: AlignedData[];
  readonly setSizeCalls: { width: number; height: number }[];
  destroyed: boolean;
}

function makeFakeCtor(): { ctor: UPlotConstructor; records: FakeRecord[] } {
  const records: FakeRecord[] = [];
  const ctor = function (opts: UPlotOptions, data: AlignedData, target: HTMLElement): FakeInstance {
    const instance: FakeInstance = {
      setDataCalls: [],
      setSizeCalls: [],
      destroyed: false,
      setData(next) {
        this.setDataCalls.push(next);
      },
      setSize(size) {
        this.setSizeCalls.push(size);
      },
      destroy() {
        this.destroyed = true;
      },
    };
    records.push({ opts, data, target, instance });
    return instance;
  } as unknown as UPlotConstructor;
  return { ctor, records };
}

// A stand-in for an HTMLElement target — the fake ctor never touches the DOM.
const fakeTarget = {} as HTMLElement;

describe('buildUPlotOptions', () => {
  it('prepends the implicit x series and maps each y series in order', () => {
    const opts = buildUPlotOptions({
      width: 800,
      height: 280,
      series: [{ label: 'rps' }, { label: 'errors' }],
    });
    expect(opts.series).toHaveLength(3);
    // Index 0 is uPlot's x series — label-less.
    expect(opts.series[0]).toEqual({});
    expect(opts.series[1]?.label).toBe('rps');
    expect(opts.series[2]?.label).toBe('errors');
  });

  it('defaults series stroke to the semantic palette slot by index', () => {
    const opts = buildUPlotOptions({
      width: 400,
      height: 200,
      series: [{ label: 'a' }, { label: 'b' }],
    });
    expect(opts.series[1]?.stroke).toBe(chartSeriesColor(0));
    expect(opts.series[2]?.stroke).toBe(chartSeriesColor(1));
  });

  it('preserves an explicit stroke, width, and fill', () => {
    const opts = buildUPlotOptions({
      width: 400,
      height: 200,
      series: [{ label: 'a', stroke: 'tomato', width: 3, fill: 'rgba(0,0,0,0.1)' }],
    });
    expect(opts.series[1]).toEqual({
      label: 'a',
      stroke: 'tomato',
      width: 3,
      fill: 'rgba(0,0,0,0.1)',
    });
  });

  it('defaults width to 1 and omits fill when not provided', () => {
    const opts = buildUPlotOptions({ width: 400, height: 200, series: [{ label: 'a' }] });
    expect(opts.series[1]?.width).toBe(1);
    expect(opts.series[1]).not.toHaveProperty('fill');
  });

  it('carries width / height through and defaults the x scale to time', () => {
    const opts = buildUPlotOptions({ width: 640, height: 320, series: [] });
    expect(opts.width).toBe(640);
    expect(opts.height).toBe(320);
    expect(opts.scales.x.time).toBe(true);
  });

  it('honours an explicit non-time x scale', () => {
    const opts = buildUPlotOptions({ width: 100, height: 100, series: [], time: false });
    expect(opts.scales.x.time).toBe(false);
  });

  it('emits two axes sharing the default fg token stroke', () => {
    const opts = buildUPlotOptions({ width: 100, height: 100, series: [{ label: 'a' }] });
    expect(opts.axes).toHaveLength(2);
    expect(opts.axes[0]?.stroke).toBe('var(--color-fg, oklch(0.2 0 0))');
    expect(opts.axes[1]?.stroke).toBe(opts.axes[0]?.stroke);
  });

  it('honours a custom axisStroke on both axes', () => {
    const opts = buildUPlotOptions({
      width: 100,
      height: 100,
      series: [{ label: 'a' }],
      axisStroke: 'oklch(0.5 0 0)',
    });
    expect(opts.axes.map((a) => a.stroke)).toEqual(['oklch(0.5 0 0)', 'oklch(0.5 0 0)']);
  });
});

describe('emptyAlignedData', () => {
  it('produces one empty x array plus one empty array per series', () => {
    const data = emptyAlignedData(2);
    expect(data).toEqual([[], [], []]);
    expect(data).toHaveLength(3);
  });

  it('produces a bare x array for zero series', () => {
    expect(emptyAlignedData(0)).toEqual([[]]);
  });

  it('clamps negative / non-finite counts to zero series', () => {
    expect(emptyAlignedData(-3)).toEqual([[]]);
    expect(emptyAlignedData(Number.NaN)).toEqual([[]]);
  });

  it('floors fractional counts', () => {
    expect(emptyAlignedData(2.9)).toEqual([[], [], []]);
  });
});

describe('createUPlotChart — options + pre-mount', () => {
  it('exposes a frozen options object derived from config', () => {
    const handle = createUPlotChart({
      uPlot: makeFakeCtor().ctor,
      config: { width: 200, height: 100, series: [{ label: 'a' }] },
    });
    expect(Object.isFrozen(handle.options)).toBe(true);
    expect(handle.options.series[1]?.label).toBe('a');
  });

  it('starts unmounted', () => {
    const handle = createUPlotChart({
      uPlot: makeFakeCtor().ctor,
      config: { width: 200, height: 100, series: [{ label: 'a' }] },
    });
    expect(handle.mounted).toBe(false);
  });

  it('treats update / setSize before mount as no-ops', () => {
    const handle = createUPlotChart({
      uPlot: makeFakeCtor().ctor,
      config: { width: 200, height: 100, series: [{ label: 'a' }] },
    });
    expect(() => handle.update([[1], [2]])).not.toThrow();
    expect(() => handle.setSize({ width: 10, height: 10 })).not.toThrow();
    expect(handle.mounted).toBe(false);
  });

  it('destroy before mount is a safe no-op', () => {
    const handle = createUPlotChart({
      uPlot: makeFakeCtor().ctor,
      config: { width: 200, height: 100, series: [] },
    });
    expect(() => handle.destroy()).not.toThrow();
    expect(handle.mounted).toBe(false);
  });
});

describe('createUPlotChart — lifecycle with injected ctor', () => {
  it('constructs uPlot on mount with the frozen opts and initial data', async () => {
    const { ctor, records } = makeFakeCtor();
    const initial: AlignedData = [[1, 2], [10, 20]];
    const handle = createUPlotChart({
      uPlot: ctor,
      config: { width: 200, height: 100, series: [{ label: 'a' }] },
      data: initial,
    });
    await handle.mount(fakeTarget);

    expect(records).toHaveLength(1);
    expect(records[0]?.opts).toBe(handle.options);
    expect(records[0]?.data).toBe(initial);
    expect(records[0]?.target).toBe(fakeTarget);
    expect(handle.mounted).toBe(true);
  });

  it('defaults initial data to an empty aligned tuple sized to the series count', async () => {
    const { ctor, records } = makeFakeCtor();
    const handle = createUPlotChart({
      uPlot: ctor,
      config: { width: 200, height: 100, series: [{ label: 'a' }, { label: 'b' }] },
    });
    await handle.mount(fakeTarget);
    expect(records[0]?.data).toEqual([[], [], []]);
  });

  it('mount is idempotent — a second mount does not construct a second instance', async () => {
    const { ctor, records } = makeFakeCtor();
    const handle = createUPlotChart({
      uPlot: ctor,
      config: { width: 200, height: 100, series: [{ label: 'a' }] },
    });
    await handle.mount(fakeTarget);
    await handle.mount(fakeTarget);
    expect(records).toHaveLength(1);
  });

  it('update after mount forwards setData to the live instance', async () => {
    const { ctor, records } = makeFakeCtor();
    const handle = createUPlotChart({
      uPlot: ctor,
      config: { width: 200, height: 100, series: [{ label: 'a' }] },
    });
    await handle.mount(fakeTarget);
    const next: AlignedData = [[3, 4], [30, 40]];
    handle.update(next);
    expect(records[0]?.instance.setDataCalls).toEqual([next]);
  });

  it('mount picks up the latest data streamed in before mount resolved', async () => {
    const { ctor, records } = makeFakeCtor();
    const handle = createUPlotChart({
      uPlot: ctor,
      config: { width: 200, height: 100, series: [{ label: 'a' }] },
      data: [[1], [10]],
    });
    const streamed: AlignedData = [[1, 2, 3], [10, 20, 30]];
    handle.update(streamed); // before mount — buffered, not forwarded
    await handle.mount(fakeTarget);
    // The buffered snapshot is what uPlot is constructed with.
    expect(records[0]?.data).toBe(streamed);
    expect(records[0]?.instance.setDataCalls).toEqual([]);
  });

  it('setSize after mount forwards to the live instance', async () => {
    const { ctor, records } = makeFakeCtor();
    const handle = createUPlotChart({
      uPlot: ctor,
      config: { width: 200, height: 100, series: [{ label: 'a' }] },
    });
    await handle.mount(fakeTarget);
    handle.setSize({ width: 320, height: 180 });
    expect(records[0]?.instance.setSizeCalls).toEqual([{ width: 320, height: 180 }]);
  });

  it('destroy tears down the instance and resets mounted; it is idempotent', async () => {
    const { ctor, records } = makeFakeCtor();
    const handle = createUPlotChart({
      uPlot: ctor,
      config: { width: 200, height: 100, series: [{ label: 'a' }] },
    });
    await handle.mount(fakeTarget);
    handle.destroy();
    expect(records[0]?.instance.destroyed).toBe(true);
    expect(handle.mounted).toBe(false);
    expect(() => handle.destroy()).not.toThrow();
  });

  it('can be re-mounted after destroy, constructing a fresh instance', async () => {
    const { ctor, records } = makeFakeCtor();
    const handle = createUPlotChart({
      uPlot: ctor,
      config: { width: 200, height: 100, series: [{ label: 'a' }] },
    });
    await handle.mount(fakeTarget);
    handle.destroy();
    await handle.mount(fakeTarget);
    expect(records).toHaveLength(2);
    expect(handle.mounted).toBe(true);
  });

  it('update / setSize after destroy are no-ops (no setData on the dead instance)', async () => {
    const { ctor, records } = makeFakeCtor();
    const handle = createUPlotChart({
      uPlot: ctor,
      config: { width: 200, height: 100, series: [{ label: 'a' }] },
    });
    await handle.mount(fakeTarget);
    handle.destroy();
    handle.update([[9], [99]]);
    handle.setSize({ width: 1, height: 1 });
    expect(records[0]?.instance.setDataCalls).toEqual([]);
    expect(records[0]?.instance.setSizeCalls).toEqual([]);
  });
});

describe('createUPlotChart — loader seam', () => {
  it('calls the injected loader once on mount when no ctor is given', async () => {
    const { ctor, records } = makeFakeCtor();
    const loadUPlot = vi.fn(() => Promise.resolve(ctor));
    const handle = createUPlotChart({
      loadUPlot,
      config: { width: 100, height: 100, series: [{ label: 'a' }] },
    });
    await handle.mount(fakeTarget);
    expect(loadUPlot).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(handle.mounted).toBe(true);
  });

  it('prefers an injected ctor over the loader (loader is never called)', async () => {
    const { ctor, records } = makeFakeCtor();
    const loadUPlot = vi.fn(() => Promise.resolve(ctor));
    const handle = createUPlotChart({
      uPlot: ctor,
      loadUPlot,
      config: { width: 100, height: 100, series: [{ label: 'a' }] },
    });
    await handle.mount(fakeTarget);
    expect(loadUPlot).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
  });

  it('propagates a loader rejection and leaves the handle unmounted', async () => {
    const loadUPlot = vi.fn(() =>
      Promise.reject(new Error('@sveltesentio/charts ... optional peer "uplot"')),
    );
    const handle = createUPlotChart({
      loadUPlot,
      config: { width: 100, height: 100, series: [{ label: 'a' }] },
    });
    await expect(handle.mount(fakeTarget)).rejects.toThrow(/optional peer "uplot"/);
    expect(handle.mounted).toBe(false);
  });
});

describe('uPlotCtorFromModule', () => {
  it('returns the default export when it is a constructor function', () => {
    const { ctor } = makeFakeCtor();
    expect(uPlotCtorFromModule({ default: ctor })).toBe(ctor);
  });

  it('throws when the module lacks a function default export', () => {
    expect(() => uPlotCtorFromModule({})).toThrow(/default export constructor/);
    expect(() => uPlotCtorFromModule({ default: 42 })).toThrow(/default export constructor/);
  });
});

describe('loadUPlotModule', () => {
  it('resolves the real uplot default-export constructor when the peer is present', async () => {
    // uplot is hoisted into the workspace store (transitively via layerchart),
    // so the default loader resolves a real constructor function. We do not
    // construct it here — that needs a canvas; the lifecycle is covered above
    // with the fake ctor.
    const Ctor = await loadUPlotModule();
    expect(typeof Ctor).toBe('function');
  });

  it('narrows the default export through the injectable importer seam', async () => {
    const { ctor } = makeFakeCtor();
    const Ctor = await loadUPlotModule(() => Promise.resolve({ default: ctor }));
    expect(Ctor).toBe(ctor);
  });

  it('wraps an import rejection in a directive "install the peer" error', async () => {
    await expect(
      loadUPlotModule(() => Promise.reject(new Error('Cannot find module'))),
    ).rejects.toThrow(/requires the optional peer "uplot"/);
  });

  it('preserves the original failure as the error cause', async () => {
    const original = new Error('boom');
    await loadUPlotModule(() => Promise.reject(original)).catch((err: unknown) => {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).cause).toBe(original);
    });
  });
});
