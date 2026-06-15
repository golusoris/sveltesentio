export {
  type DagNodeLike,
  type DagEdgeLike,
  type Adjacency,
  CycleError,
  buildAdjacency,
  topologicalSort,
  findCycles,
  reachableFrom,
  hasCycle,
} from './dag.js';

export {
  type ElkDirection,
  type ElkAlgorithm,
  type ElkLayoutOptions,
  type ElkFactory,
  type SizedNode,
  type PositionedNode,
  type ElkLayoutResult,
  createElkLayout,
} from './layout.js';

export {
  type XYPosition,
  type FlowNode,
  type NodeIdFactory,
  type NodeTypeDef,
  type CreateNodeOptions,
  type NodePaletteOptions,
  NodePalette,
  createCounterIdFactory,
  createNodePalette,
} from './node-palette.js';

// `<FlowCanvas>` and the example node components live on the `./canvas` and
// `./nodes` subpaths (plain `tsc` does not resolve `.svelte`); their typed,
// unit-tested cores are re-exported here.
export {
  type CanvasNodeLike,
  type CanvasEdgeLike,
  type FallbackNodeSize,
  type FocusDirection,
  type OnLayout,
  resolveNodeSize,
  applyElkLayout,
  focusOrder,
  nextFocusTarget,
  canvasAriaLabel,
} from './canvas-model.js';

export {
  type ExampleNodeData,
  type ExampleFlowNode,
  type ExampleNodeKind,
  type NodeView,
  DEFAULT_NODE_LABELS,
  NODE_KIND_NAMES,
  deriveNodeView,
} from './node-view.js';
