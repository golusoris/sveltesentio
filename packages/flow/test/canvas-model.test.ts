import { describe, it, expect } from 'vitest';
import {
  resolveNodeSize,
  applyElkLayout,
  focusOrder,
  nextFocusTarget,
  canvasAriaLabel,
  type CanvasNodeLike,
  type CanvasEdgeLike,
} from '../src/canvas-model.js';
import type { ElkLayoutOptions } from '../src/layout.js';

const node = (id: string, overrides: Partial<CanvasNodeLike> = {}): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  ...overrides,
});

describe('resolveNodeSize', () => {
  it('prefers the renderer-measured size', () => {
    const size = resolveNodeSize(node('a', { measured: { width: 200, height: 80 }, width: 10 }));
    expect(size).toEqual({ width: 200, height: 80 });
  });

  it('falls back to explicit width/height when not measured', () => {
    expect(resolveNodeSize(node('a', { width: 120, height: 60 }))).toEqual({
      width: 120,
      height: 60,
    });
  });

  it('falls back to the default box when neither measured nor explicit', () => {
    expect(resolveNodeSize(node('a'))).toEqual({ width: 150, height: 50 });
  });

  it('honours a custom fallback box', () => {
    expect(resolveNodeSize(node('a'), { width: 64, height: 32 })).toEqual({
      width: 64,
      height: 32,
    });
  });
});

describe('applyElkLayout', () => {
  // A fake ELK that places each node at (index*100, index*100) so the test does
  // not load the real elkjs bundle (deterministic + fast, mirrors layout.test).
  function fakeLayoutFactory(_options: ElkLayoutOptions = {}) {
    return async function layout<E extends CanvasEdgeLike>(
      nodes: readonly { id: string; width: number; height: number }[],
      edges: readonly E[],
    ) {
      return {
        nodes: nodes.map((n, i) => ({
          id: n.id,
          x: i * 100,
          y: i * 100,
          width: n.width,
          height: n.height,
        })),
        edges,
        width: nodes.length * 100,
        height: nodes.length * 100,
      };
    };
  }

  it('returns a new array with ELK-computed positions, preserving node identity fields', async () => {
    const nodes: (CanvasNodeLike & { type: string; data: { label: string } })[] = [
      { id: 'a', position: { x: 5, y: 5 }, type: 'process', data: { label: 'A' } },
      { id: 'b', position: { x: 9, y: 9 }, type: 'data', data: { label: 'B' } },
    ];
    const edges: CanvasEdgeLike[] = [{ source: 'a', target: 'b' }];

    const next = await applyElkLayout(nodes, edges, {}, undefined, fakeLayoutFactory);

    expect(next).not.toBe(nodes);
    expect(next[0]).toMatchObject({ id: 'a', type: 'process', position: { x: 0, y: 0 } });
    expect(next[1]).toMatchObject({ id: 'b', type: 'data', position: { x: 100, y: 100 } });
    // Original array untouched (immutability).
    expect(nodes[0].position).toEqual({ x: 5, y: 5 });
  });

  it('keeps a node at its original position when ELK does not place it', async () => {
    function partialFactory() {
      return async function layout<E extends CanvasEdgeLike>(
        _nodes: readonly { id: string; width: number; height: number }[],
        edges: readonly E[],
      ) {
        return {
          nodes: [{ id: 'a', x: 42, y: 7, width: 10, height: 10 }],
          edges,
          width: 100,
          height: 100,
        };
      };
    }
    const nodes = [node('a'), node('b', { position: { x: 11, y: 22 } })];
    const next = await applyElkLayout(nodes, [], {}, undefined, partialFactory);

    expect(next[0].position).toEqual({ x: 42, y: 7 });
    expect(next[1].position).toEqual({ x: 11, y: 22 });
    expect(next[1]).toBe(nodes[1]);
  });
});

describe('focusOrder', () => {
  it('returns node ids in array order', () => {
    expect(focusOrder([node('c'), node('a'), node('b')])).toEqual(['c', 'a', 'b']);
  });
});

describe('nextFocusTarget', () => {
  const nodes = [node('a'), node('b'), node('c')];
  const edges: CanvasEdgeLike[] = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
  ];

  it('follows the first outgoing edge on "next"', () => {
    expect(nextFocusTarget(nodes, edges, 'a', 'next')).toBe('b');
  });

  it('follows the first incoming edge on "previous"', () => {
    expect(nextFocusTarget(nodes, edges, 'c', 'previous')).toBe('b');
  });

  it('breaks outgoing ties by sorted id', () => {
    const fanout: CanvasEdgeLike[] = [
      { source: 'a', target: 'c' },
      { source: 'a', target: 'b' },
    ];
    expect(nextFocusTarget(nodes, fanout, 'a', 'next')).toBe('b');
  });

  it('wraps to the next node in array order when there is no outgoing edge', () => {
    // "c" has no outgoing edge → wraps forward to "a".
    expect(nextFocusTarget(nodes, edges, 'c', 'next')).toBe('a');
  });

  it('wraps to the previous node in array order when there is no incoming edge', () => {
    // "a" has no incoming edge → wraps backward to "c".
    expect(nextFocusTarget(nodes, edges, 'a', 'previous')).toBe('c');
  });

  it('returns the same id for a single-node graph', () => {
    expect(nextFocusTarget([node('solo')], [], 'solo', 'next')).toBe('solo');
  });

  it('returns undefined for an unknown id', () => {
    expect(nextFocusTarget(nodes, edges, 'missing', 'next')).toBeUndefined();
  });
});

describe('canvasAriaLabel', () => {
  it('summarises node and edge counts with correct pluralisation', () => {
    expect(canvasAriaLabel([node('a'), node('b')], [{ source: 'a', target: 'b' }])).toBe(
      'Flow diagram, 2 nodes, 1 connection',
    );
  });

  it('uses singular for one node and plural for zero connections', () => {
    expect(canvasAriaLabel([node('a')], [])).toBe('Flow diagram, 1 node, 0 connections');
  });

  it('prefixes a supplied label', () => {
    expect(canvasAriaLabel([], [], 'Pipeline')).toBe(
      'Pipeline: Flow diagram, 0 nodes, 0 connections',
    );
  });
});
