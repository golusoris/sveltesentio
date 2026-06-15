// Pure view model for the example node components (<ProcessNode>, <DecisionNode>,
// <DataNode>). The node `.svelte` files stay presentational; the testable
// label/aria derivation lives here so `tsc` (which skips `.svelte`) type-checks
// it and the node-kind copy is unit-tested without jsdom.

import type { FlowNode } from './node-palette.js';

/** The shape of `data` the example nodes read (all optional, all narrowed). */
export interface ExampleNodeData extends Record<string, unknown> {
  /** Visible node title. Falls back to the kind's default label. */
  readonly label?: string;
  /** Optional one-line description, surfaced via `aria-describedby`. */
  readonly description?: string;
}

/** A node typed over {@link ExampleNodeData} for the example node components. */
export type ExampleFlowNode = FlowNode<ExampleNodeData>;

/** The node kinds the example palette ships. */
export type ExampleNodeKind = 'process' | 'decision' | 'data';

/** Default human label per kind, used when `data.label` is absent. */
export const DEFAULT_NODE_LABELS: Readonly<Record<ExampleNodeKind, string>> = Object.freeze({
  process: 'Process',
  decision: 'Decision',
  data: 'Data',
});

/** Screen-reader role-name prefix per kind (read before the label). */
export const NODE_KIND_NAMES: Readonly<Record<ExampleNodeKind, string>> = Object.freeze({
  process: 'Process step',
  decision: 'Decision branch',
  data: 'Data store',
});

/** The derived, render-ready view of a node. */
export interface NodeView {
  readonly kind: ExampleNodeKind;
  readonly label: string;
  readonly description: string | undefined;
  /** `"{kind name}: {label}"` — the node's accessible name. */
  readonly ariaLabel: string;
  /** Whether a description paragraph (and its `aria-describedby` link) renders. */
  readonly hasDescription: boolean;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Derives the render-ready {@link NodeView} for `kind` from `data`. Narrows
 * `data.label` / `data.description` from `unknown` defensively (the renderer
 * passes arbitrary `Record<string, unknown>`); falls back to the kind's default
 * label so a node is never anonymous to assistive tech.
 */
export function deriveNodeView(kind: ExampleNodeKind, data: ExampleNodeData = {}): NodeView {
  const label = readString(data.label) ?? DEFAULT_NODE_LABELS[kind];
  const description = readString(data.description);
  return {
    kind,
    label,
    description,
    ariaLabel: `${NODE_KIND_NAMES[kind]}: ${label}`,
    hasDescription: description !== undefined,
  };
}
