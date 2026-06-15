// `./nodes` sub-export — the example `@xyflow/svelte` custom node components
// (<ProcessNode>, <DecisionNode>, <DataNode>) plus the pure `./node-view` model
// they derive their label/aria from, and a ready-made `nodeTypes` map for
// `<FlowCanvas nodeTypes={exampleNodeTypes}>`.

import type { NodeTypes } from '@xyflow/svelte';
import ProcessNode from './nodes/ProcessNode.svelte';
import DecisionNode from './nodes/DecisionNode.svelte';
import DataNode from './nodes/DataNode.svelte';

export { default as ProcessNode } from './nodes/ProcessNode.svelte';
export { default as DecisionNode } from './nodes/DecisionNode.svelte';
export { default as DataNode } from './nodes/DataNode.svelte';

export {
  type ExampleNodeData,
  type ExampleFlowNode,
  type ExampleNodeKind,
  type NodeView,
  DEFAULT_NODE_LABELS,
  NODE_KIND_NAMES,
  deriveNodeView,
} from './node-view.js';

/**
 * The example node-type map for `<FlowCanvas nodeTypes={exampleNodeTypes}>`:
 * `process` → `<ProcessNode>`, `decision` → `<DecisionNode>`, `data` →
 * `<DataNode>`. The keys match the node `type` strings the palette mints.
 */
export const exampleNodeTypes: NodeTypes = {
  process: ProcessNode,
  decision: DecisionNode,
  data: DataNode,
};
