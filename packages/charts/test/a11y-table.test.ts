import { describe, expect, it } from 'vitest';
import { buildDataTableModel, type ChartSeries } from '../src/a11y-table.js';

interface Point {
  t: string;
  v: number | null;
}

const accessors = {
  x: (d: Point) => d.t,
  y: (d: Point) => d.v,
};

describe('buildDataTableModel', () => {
  it('builds a single-series table with default labels + number formatting', () => {
    const series: ChartSeries<Point>[] = [
      {
        key: 'sessions',
        data: [
          { t: 'Mon', v: 1000 },
          { t: 'Tue', v: 2500 },
        ],
      },
    ];
    const model = buildDataTableModel(series, accessors);

    expect(model.xLabel).toBe('Category');
    expect(model.columns).toEqual(['sessions']);
    expect(model.rows).toHaveLength(2);
    expect(model.rows[0]).toEqual({
      x: 'Mon',
      head: 'Mon',
      cells: [new Intl.NumberFormat().format(1000)],
    });
    expect(model.rows[1]?.cells).toEqual([new Intl.NumberFormat().format(2500)]);
  });

  it('uses series.label for the column header when present', () => {
    const series: ChartSeries<Point>[] = [
      { key: 'scan', label: 'Scan progress', data: [{ t: 'A', v: 1 }] },
    ];
    const model = buildDataTableModel(series, accessors);
    expect(model.columns).toEqual(['Scan progress']);
  });

  it('unions x values across series in first-seen order', () => {
    const series: ChartSeries<Point>[] = [
      {
        key: 'a',
        data: [
          { t: 'Mon', v: 1 },
          { t: 'Wed', v: 3 },
        ],
      },
      {
        key: 'b',
        data: [
          { t: 'Tue', v: 20 },
          { t: 'Wed', v: 30 },
        ],
      },
    ];
    const model = buildDataTableModel(series, accessors);

    expect(model.columns).toEqual(['a', 'b']);
    expect(model.rows.map((r) => r.x)).toEqual(['Mon', 'Wed', 'Tue']);
  });

  it('renders the em-dash placeholder for missing cells in sparse series', () => {
    const series: ChartSeries<Point>[] = [
      { key: 'a', data: [{ t: 'Mon', v: 1 }] },
      { key: 'b', data: [{ t: 'Tue', v: 2 }] },
    ];
    const model = buildDataTableModel(series, accessors);

    // row Mon: a present, b missing → '—'
    expect(model.rows[0]?.x).toBe('Mon');
    expect(model.rows[0]?.cells[1]).toBe('—');
    // row Tue: a missing → '—', b present
    expect(model.rows[1]?.x).toBe('Tue');
    expect(model.rows[1]?.cells[0]).toBe('—');
  });

  it('treats null / undefined / NaN y values as the placeholder', () => {
    const series: ChartSeries<Point>[] = [
      {
        key: 'a',
        data: [
          { t: 'Mon', v: null },
          { t: 'Tue', v: Number.NaN },
        ],
      },
    ];
    const model = buildDataTableModel(series, accessors);
    expect(model.rows[0]?.cells).toEqual(['—']);
    expect(model.rows[1]?.cells).toEqual(['—']);
  });

  it('honours custom xLabel, formatX, and formatY options', () => {
    const series: ChartSeries<Point>[] = [{ key: 'bytes', data: [{ t: 'd1', v: 1024 }] }];
    const model = buildDataTableModel(series, accessors, {
      xLabel: 'Day',
      formatX: (x) => `Day ${String(x).slice(1)}`,
      formatY: (y) => (y == null ? 'n/a' : `${y} B`),
    });

    expect(model.xLabel).toBe('Day');
    expect(model.rows[0]?.head).toBe('Day 1');
    expect(model.rows[0]?.cells).toEqual(['1024 B']);
  });

  it('passes the owning series to formatY for per-series units', () => {
    const series: ChartSeries<Point>[] = [{ key: 'pct', label: '%', data: [{ t: 'x', v: 50 }] }];
    const seen: string[] = [];
    buildDataTableModel(series, accessors, {
      formatY: (_y, s) => {
        seen.push(s.key);
        return '';
      },
    });
    expect(seen).toEqual(['pct']);
  });

  it('coerces numeric x values to stable string keys without collisions', () => {
    const numPoints = [
      { n: 1, v: 10 },
      { n: 2, v: 20 },
    ];
    const model = buildDataTableModel([{ key: 's', data: numPoints }], {
      x: (d) => d.n,
      y: (d) => d.v,
    });
    expect(model.rows.map((r) => r.x)).toEqual([1, 2]);
    expect(model.rows.map((r) => r.head)).toEqual(['1', '2']);
  });

  it('returns an empty-rows model for empty series input', () => {
    const model = buildDataTableModel<Point>([], accessors);
    expect(model.columns).toEqual([]);
    expect(model.rows).toEqual([]);
    expect(model.xLabel).toBe('Category');
  });

  it('keeps later duplicate x values, overwriting the earlier datum', () => {
    const series: ChartSeries<Point>[] = [
      {
        key: 'a',
        data: [
          { t: 'Mon', v: 1 },
          { t: 'Mon', v: 9 },
        ],
      },
    ];
    const model = buildDataTableModel(series, accessors);
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]?.cells).toEqual([new Intl.NumberFormat().format(9)]);
  });
});
