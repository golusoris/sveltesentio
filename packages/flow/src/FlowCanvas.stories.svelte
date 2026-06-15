<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import type { Node, Edge } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import FlowCanvas from './FlowCanvas.svelte';
  import { exampleNodeTypes } from './nodes.js';

  // FlowCanvas is a thin, accessible wrapper over `@xyflow/svelte`'s
  // <SvelteFlowProvider> + <SvelteFlow>. `@xyflow/svelte` is an OPTIONAL peer —
  // present in this workspace, so the canvas renders in `storybook dev`. The
  // Storybook *build* only compiles stories (no execution), so the build is
  // green either way. The canvas needs a sized parent (it is `height: 100%`),
  // hence the fixed-size wrapper around each Story.

  const { Story } = defineMeta({
    title: 'flow/FlowCanvas',
    component: FlowCanvas,
    tags: ['autodocs'],
    argTypes: {
      readonly: { control: 'boolean' },
      fitView: { control: 'boolean' },
      ariaLabel: { control: 'text' },
    },
    args: {
      ariaLabel: 'Order pipeline',
    },
  });

  const nodes: Node[] = [
    { id: 'p1', type: 'process', position: { x: 40, y: 20 }, data: { label: 'Receive order' } },
    { id: 'd1', type: 'decision', position: { x: 40, y: 140 }, data: { label: 'In stock?' } },
    { id: 's1', type: 'data', position: { x: 280, y: 240 }, data: { label: 'Inventory' } },
  ];
  const edges: Edge[] = [
    { id: 'e1', source: 'p1', target: 'd1' },
    { id: 'e2', source: 'd1', sourceHandle: 'yes', target: 's1' },
  ];
</script>

<!-- Interactive canvas: `role="application"`, drag/select/connect enabled. -->
<Story name="Interactive">
  <div style:height="360px" style:width="520px" style:border="1px solid currentColor">
    <FlowCanvas {nodes} {edges} nodeTypes={exampleNodeTypes} ariaLabel="Order pipeline" />
  </div>
</Story>

<!-- Read-only: `role="img"`, no drag/select; the aria-label still summarises counts. -->
<Story name="Read-only">
  <div style:height="360px" style:width="520px" style:border="1px solid currentColor">
    <FlowCanvas {nodes} {edges} nodeTypes={exampleNodeTypes} readonly ariaLabel="Order pipeline" />
  </div>
</Story>

<!-- Empty: no nodes/edges; the aria-label degrades gracefully to the prefix. -->
<Story name="Empty">
  <div style:height="240px" style:width="520px" style:border="1px solid currentColor">
    <FlowCanvas nodes={[]} edges={[]} nodeTypes={exampleNodeTypes} ariaLabel="Empty canvas" />
  </div>
</Story>
