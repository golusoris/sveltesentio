<!--
@component
ProcessNode — an example `@xyflow/svelte` custom node for a process/step in a
flow (ADR-0004 / ADR-0010). Registered under the `"process"` node type and
typed over `NodeProps`. The focusable, labelled body is the
`@xyflow/svelte`-free `<NodeBody>` (render/axe-tested standalone); this shell
adds the connection `<Handle>`s, which require the SvelteFlow node context.

WCAG 2.2 AA:
- `<NodeBody>` is a focusable `role="group"` named `"Process step: {label}"`.
- The `<Handle>`s carry off-screen labels (target = incoming, source = outgoing).
-->
<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { deriveNodeView, type ExampleNodeData } from '../node-view.js';
  import NodeBody from './NodeBody.svelte';

  const { id, data, selected }: NodeProps = $props();
  const view = $derived(deriveNodeView('process', (data ?? {}) as ExampleNodeData));
</script>

<Handle type="target" position={Position.Top} aria-label="Incoming connection" />
<NodeBody {id} {view} {selected} kind="process" />
<Handle type="source" position={Position.Bottom} aria-label="Outgoing connection" />
