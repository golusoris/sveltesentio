<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import type { Node, Edge } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import FlowCanvas from '../FlowCanvas.svelte';
  import { exampleNodeTypes } from '../nodes.js';

  // <ProcessNode>/<DecisionNode>/<DataNode> wrap <NodeBody> with `@xyflow/svelte`
  // <Handle>s, which throw outside the SvelteFlow node context ("Handle must be
  // used within a Custom Node component"). They therefore cannot render bare —
  // they must mount inside <SvelteFlow> via `nodeTypes`. So these stories drive
  // them through <FlowCanvas nodeTypes={exampleNodeTypes}>, the same path apps
  // use. NodeBody.stories.svelte covers the peer-free body standalone.
  //
  // `@xyflow/svelte` is an OPTIONAL peer; it is present in this workspace, so the
  // canvas renders in `storybook dev`. The Storybook *build* only compiles the
  // stories (it does not execute them), so the build stays green regardless.

  const { Story } = defineMeta({
    title: 'flow/nodes/ExampleNodes',
    component: FlowCanvas,
    tags: ['autodocs'],
  });

  function node(
    id: string,
    type: string,
    x: number,
    y: number,
    label: string,
    description?: string,
  ): Node {
    return { id, type, position: { x, y }, data: { label, description } };
  }
</script>

{#snippet canvas(nodes: Node[], edges: Edge[], readonly = false)}
  <div style:height="320px" style:width="480px" style:border="1px solid currentColor">
    <FlowCanvas {nodes} {edges} nodeTypes={exampleNodeTypes} {readonly} ariaLabel="Example flow" />
  </div>
{/snippet}

<!-- A process node with incoming (top) + outgoing (bottom) handles. -->
<Story name="Process node">
  {@render canvas(
    [node('p1', 'process', 80, 80, 'Validate input', 'Reject malformed requests early.')],
    [],
  )}
</Story>

<!-- A decision node with one incoming + two outgoing ("yes"/"no") handles. -->
<Story name="Decision node">
  {@render canvas([node('d1', 'decision', 80, 80, 'Is authenticated?')], [])}
</Story>

<!-- A data node (dashed accent) with left-in / right-out handles. -->
<Story name="Data node">
  {@render canvas([node('s1', 'data', 80, 80, 'User table', 'Source of truth for accounts.')], [])}
</Story>

<!--
	All three kinds wired into one small graph: process → decision, decision (yes)
	→ data. Exercises the example `nodeTypes` map end-to-end.
-->
<Story name="Connected graph">
  {@render canvas(
    [
      node('p1', 'process', 40, 20, 'Receive order'),
      node('d1', 'decision', 40, 140, 'In stock?'),
      node('s1', 'data', 260, 240, 'Inventory'),
    ],
    [
      { id: 'e1', source: 'p1', target: 'd1' },
      { id: 'e2', source: 'd1', sourceHandle: 'yes', target: 's1' },
    ],
  )}
</Story>

<!-- Read-only: `role="img"`, no drag/select/connect; the same nodes render static. -->
<Story name="Read-only">
  {@render canvas(
    [node('p1', 'process', 40, 20, 'Receive order'), node('d1', 'decision', 40, 140, 'In stock?')],
    [{ id: 'e1', source: 'p1', target: 'd1' }],
    true,
  )}
</Story>
