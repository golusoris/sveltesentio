// Pure, framework-agnostic glue between `createElkLayout` (./layout), the DAG
// adjacency (./dag) and the `@xyflow/svelte` node/edge arrays the `<FlowCanvas>`
// component binds. No DOM, no runes, no `@xyflow/svelte` import — so this stays
// unit-testable in plain Node and `<FlowCanvas>`'s testable behaviour is asserted
// here rather than under jsdom (where the canvas measures a viewport it has not).

import { buildAdjacency } from './dag.js';
import { createElkLayout, type ElkLayoutOptions } from './layout.js';
import type { XYPosition } from './node-palette.js';

/**
 * The minimal node shape `<FlowCanvas>` consumes — a structural subset of
 * `@xyflow/svelte`'s `Node` (`{id, position}` plus optional measured size). Kept
 * structural so this model never imports the optional `@xyflow/svelte` peer.
 */
export interface CanvasNodeLike {
  readonly id: string;
  readonly position: XYPosition;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly measured?: { readonly width?: number | null; readonly height?: number | null };
}

/** The minimal edge shape — `@xyflow/svelte`'s `Edge` is a structural superset. */
export interface CanvasEdgeLike {
  readonly source: string;
  readonly target: string;
}

/** Fallback node size used when a node has not been measured by the renderer yet. */
export interface FallbackNodeSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Callback `<FlowCanvas>` invokes after `runLayout()` re-positions the graph.
 * Declared here (a `.ts` module) rather than inline in the `.svelte` `Props`
 * interface so the function-type parameter is checked by the TS-aware lint lane.
 */
export type OnLayout<N extends CanvasNodeLike = CanvasNodeLike> = (nodes: readonly N[]) => void;

const DEFAULT_FALLBACK_SIZE: FallbackNodeSize = { width: 150, height: 50 };

/**
 * Reads the effective width/height of a node: the renderer's `measured` size
 * wins, then the explicit `width`/`height`, then the supplied fallback. ELK needs
 * a non-zero box per node or it collapses the layout onto the origin.
 */
export function resolveNodeSize(
  node: CanvasNodeLike,
  fallback: FallbackNodeSize = DEFAULT_FALLBACK_SIZE,
): { width: number; height: number } {
  const width = node.measured?.width ?? node.width ?? fallback.width;
  const height = node.measured?.height ?? node.height ?? fallback.height;
  return { width, height };
}

/**
 * Runs ELK over `nodes`/`edges` and returns a NEW node array with each node's
 * `position` replaced by the computed coordinate. Nodes ELK did not place keep
 * their original position. The renderer-facing shape (`type`, `data`, …) is
 * preserved by spreading the original node — only `position` changes.
 */
export async function applyElkLayout<N extends CanvasNodeLike, E extends CanvasEdgeLike>(
  nodes: readonly N[],
  edges: readonly E[],
  options: ElkLayoutOptions = {},
  fallback: FallbackNodeSize = DEFAULT_FALLBACK_SIZE,
  layoutFactory = createElkLayout,
): Promise<N[]> {
  const layout = layoutFactory(options);
  const sized = nodes.map((n) => ({ id: n.id, ...resolveNodeSize(n, fallback) }));
  const result = await layout(sized, edges as readonly CanvasEdgeLike[]);
  const placed = new Map(result.nodes.map((p) => [p.id, p] as const));
  return nodes.map((n) => {
    const pos = placed.get(n.id);
    if (!pos) return n;
    return { ...n, position: { x: pos.x, y: pos.y } };
  });
}

/**
 * The keyboard focus order across the canvas: nodes in their array order, so
 * Tab/Shift+Tab and the SR node list are deterministic regardless of layout
 * coordinates.
 */
export function focusOrder(nodes: readonly CanvasNodeLike[]): string[] {
  return nodes.map((n) => n.id);
}

/** Direction an arrow-key press moves focus along the graph. */
export type FocusDirection = 'next' | 'previous';

/**
 * Resolves the node id focus should move to when an arrow key is pressed on
 * `currentId`. Uses DAG adjacency: `next` follows the first outgoing edge,
 * `previous` follows the first incoming edge. When there is no connected node in
 * that direction it wraps to the next/previous node in array order so the whole
 * graph stays keyboard-reachable even when disconnected. Returns `undefined`
 * when `currentId` is not in `nodes`.
 */
export function nextFocusTarget(
  nodes: readonly CanvasNodeLike[],
  edges: readonly CanvasEdgeLike[],
  currentId: string,
  direction: FocusDirection,
): string | undefined {
  const order = focusOrder(nodes);
  const index = order.indexOf(currentId);
  if (index === -1) return undefined;

  const { outgoing, incoming } = buildAdjacency(nodes, edges);
  const connected = direction === 'next' ? outgoing.get(currentId) : incoming.get(currentId);
  if (connected && connected.length > 0) {
    const [first] = [...connected].sort();
    return first;
  }

  if (order.length === 1) return currentId;
  const step = direction === 'next' ? 1 : -1;
  const wrapped = (index + step + order.length) % order.length;
  return order[wrapped];
}

/**
 * The accessible label for the canvas region, summarising node + edge counts so
 * a screen reader announces graph size on focus (the visual canvas is otherwise
 * non-text content, WCAG 2.2 SC 1.1.1).
 */
export function canvasAriaLabel(
  nodes: readonly CanvasNodeLike[],
  edges: readonly CanvasEdgeLike[],
  label?: string,
): string {
  const nodeWord = nodes.length === 1 ? 'node' : 'nodes';
  const edgeWord = edges.length === 1 ? 'connection' : 'connections';
  const summary = `Flow diagram, ${nodes.length} ${nodeWord}, ${edges.length} ${edgeWord}`;
  return label ? `${label}: ${summary}` : summary;
}
