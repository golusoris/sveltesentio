<!--
@component
DataNode — an example `@xyflow/svelte` custom node for a data store/artifact in
a flow (ADR-0004 / ADR-0010). Registered under the `"data"` node type and typed
over `NodeProps`. The focusable, labelled body is the `@xyflow/svelte`-free
`<NodeBody>` (render/axe-tested standalone); this shell adds the connection
`<Handle>`s (left = incoming, right = outgoing), which require the SvelteFlow
node context.

WCAG 2.2 AA:
- `<NodeBody>` is a focusable `role="group"` named `"Data store: {label}"`.
- The `<Handle>`s carry off-screen labels (left = incoming, right = outgoing).
-->
<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { deriveNodeView, type ExampleNodeData } from '../node-view.js';
  import NodeBody from './NodeBody.svelte';

  const { id, data, selected }: NodeProps = $props();
  const view = $derived(deriveNodeView('data', (data ?? {}) as ExampleNodeData));
</script>

<Handle type="target" position={Position.Left} aria-label="Incoming connection" />
<NodeBody {id} {view} {selected} kind="data" />
<Handle type="source" position={Position.Right} aria-label="Outgoing connection" />
