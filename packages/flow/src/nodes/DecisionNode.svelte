<!--
@component
DecisionNode — an example `@xyflow/svelte` custom node for a branch/decision in
a flow (ADR-0004 / ADR-0010). Registered under the `"decision"` node type and
typed over `NodeProps`. The focusable, labelled body is the
`@xyflow/svelte`-free `<NodeBody>` (render/axe-tested standalone); this shell
adds the one incoming + two outgoing ("yes"/"no") `<Handle>`s, which require the
SvelteFlow node context.

WCAG 2.2 AA:
- `<NodeBody>` is a focusable `role="group"` named `"Decision branch: {label}"`.
- Each outgoing `<Handle>` carries an off-screen label ("yes" / "no") so the two
  branches are distinguishable to assistive tech.
-->
<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { deriveNodeView, type ExampleNodeData } from '../node-view.js';
  import NodeBody from './NodeBody.svelte';

  const { id, data, selected }: NodeProps = $props();
  const view = $derived(deriveNodeView('decision', (data ?? {}) as ExampleNodeData));
</script>

<Handle type="target" position={Position.Top} aria-label="Incoming connection" />
<NodeBody {id} {view} {selected} kind="decision" />
<Handle id="yes" type="source" position={Position.Bottom} aria-label="Branch: yes" />
<Handle id="no" type="source" position={Position.Right} aria-label="Branch: no" />
