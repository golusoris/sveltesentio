<!--
@component
NodeBody — the presentational, `@xyflow/svelte`-free body shared by the example
node components (<ProcessNode>, <DecisionNode>, <DataNode>). It renders the
labelled group; the node components wrap it with `<Handle>`s (which require the
SvelteFlow node context). Because this body has no `@xyflow/svelte` dependency it
renders standalone under jsdom, so the node a11y is render- and axe-testable
without mounting the whole canvas.

WCAG 2.2 AA:
- `role="group"` with an accessible name (`view.ariaLabel`) and an optional
  `aria-describedby` pointing at the description paragraph.
- Tab focus + `aria-roledescription="node"` are owned by `@xyflow/svelte`'s
  `NodeWrapper` (which already renders `tabindex="0"` on the node element); this
  body is not separately focusable, so focus is not duplicated.
-->
<script lang="ts">
  import { DEFAULT_NODE_LABELS, type ExampleNodeKind, type NodeView } from '../node-view.js';

  interface Props {
    /** The node id — used to derive a stable description element id. */
    id: string;
    /** The derived view (label/aria/description) from `deriveNodeView`. */
    view: NodeView;
    /** Whether the node is currently selected (drives the focus ring). */
    selected?: boolean;
    /** The node kind — drives the accent modifier class + the kind eyebrow. */
    kind: ExampleNodeKind;
  }

  const { id, view, selected = false, kind }: Props = $props();
  const descId = $derived(`${id}-desc`);
  // The kind eyebrow is decorative (the role-name is already in `aria-label`),
  // so it is hidden from assistive tech to avoid a duplicate announcement.
  const kindLabel = $derived(DEFAULT_NODE_LABELS[kind]);
</script>

<div
  class="ssentio-flow-node ssentio-flow-node--{kind}"
  role="group"
  aria-label={view.ariaLabel}
  aria-describedby={view.hasDescription ? descId : undefined}
  aria-current={selected ? 'true' : undefined}
  data-selected={selected ? 'true' : undefined}
  data-kind={kind}
>
  <span class="ssentio-flow-node__kind" aria-hidden="true">{kindLabel}</span>
  <span class="ssentio-flow-node__label">{view.label}</span>
  {#if view.hasDescription}
    <span id={descId} class="ssentio-flow-node__desc">{view.description}</span>
  {/if}
</div>

<style>
  .ssentio-flow-node {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-inline-size: 8rem;
    min-block-size: var(--ui-min-target-size, 44px);
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--ui-border, currentColor);
    border-radius: 0.375rem;
    background: var(--ui-surface, Canvas);
    color: var(--ui-text, CanvasText);
    font-size: 0.875rem;
  }

  .ssentio-flow-node:focus-visible,
  .ssentio-flow-node[data-selected='true'] {
    outline: 2px solid var(--ui-ring, currentColor);
    outline-offset: 2px;
  }

  .ssentio-flow-node--process {
    border-left: 3px solid var(--ui-accent, currentColor);
  }

  .ssentio-flow-node--decision {
    border-left: 3px solid var(--ui-warning, currentColor);
  }

  .ssentio-flow-node--data {
    border-left: 3px solid var(--ui-info, currentColor);
    border-style: dashed;
  }

  .ssentio-flow-node__kind {
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.7;
  }

  .ssentio-flow-node__label {
    font-weight: 600;
  }

  .ssentio-flow-node__desc {
    font-size: 0.75rem;
    opacity: 0.8;
  }
</style>
