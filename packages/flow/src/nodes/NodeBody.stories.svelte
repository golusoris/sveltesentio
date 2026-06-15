<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import NodeBody from './NodeBody.svelte';
  import { deriveNodeView, type ExampleNodeKind } from '../node-view.js';

  // NodeBody is the `@xyflow/svelte`-free presentational body shared by the
  // example node components. Unlike <ProcessNode>/<DecisionNode>/<DataNode>
  // (whose <Handle>s require the SvelteFlow node context), this body renders
  // standalone — so the node label/aria/accent is showcased without mounting a
  // canvas. The `view` arg is built from `deriveNodeView` so the stories mirror
  // exactly what the node shells pass at runtime.
  function view(
    kind: ExampleNodeKind,
    label?: string,
    description?: string,
  ): ReturnType<typeof deriveNodeView> {
    return deriveNodeView(kind, { label, description });
  }

  const { Story } = defineMeta({
    title: 'flow/nodes/NodeBody',
    component: NodeBody,
    tags: ['autodocs'],
    argTypes: {
      kind: { control: 'inline-radio', options: ['process', 'decision', 'data'] },
      selected: { control: 'boolean' },
    },
    args: {
      id: 'node-1',
      kind: 'process',
      selected: false,
      view: view('process', 'Validate input'),
    },
  });
</script>

<!-- Process: the accent border-left + "PROCESS" eyebrow; named "Process step: …". -->
<Story
  name="Process"
  args={{ id: 'n-process', kind: 'process', view: view('process', 'Validate input') }}
/>

<!-- Decision: warning accent; named "Decision branch: …". -->
<Story
  name="Decision"
  args={{ id: 'n-decision', kind: 'decision', view: view('decision', 'Is authenticated?') }}
/>

<!-- Data: dashed info accent; named "Data store: …". -->
<Story name="Data" args={{ id: 'n-data', kind: 'data', view: view('data', 'User table') }} />

<!--
	With a description: a second line renders and is wired via `aria-describedby`,
	so assistive tech reads the label then the description.
-->
<Story
  name="With description"
  args={{
    id: 'n-desc',
    kind: 'process',
    view: view('process', 'Send email', 'Notifies the customer of the order status.'),
  }}
/>

<!-- Selected: the focus ring is forced on via `data-selected`/`aria-current`. -->
<Story
  name="Selected"
  args={{
    id: 'n-selected',
    kind: 'decision',
    selected: true,
    view: view('decision', 'Retry?'),
  }}
/>

<!-- No `data.label`: the body falls back to the kind's default label, never anonymous. -->
<Story name="Default label" args={{ id: 'n-default', kind: 'data', view: view('data') }} />
