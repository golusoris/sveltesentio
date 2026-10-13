<!--
@component
FlowCanvas — a thin, accessible wrapper over `@xyflow/svelte`'s
`<SvelteFlowProvider>` + `<SvelteFlow>` (ADR-0004 / ADR-0010). It binds typed
`nodes`/`edges`, surfaces change events, and offers one-call ELK auto-layout via
`createElkLayout` (./layout) wired through the pure `./canvas-model` glue.

`@xyflow/svelte` is an OPTIONAL peer: consumers that only use the DAG/layout
helpers never import this file, so the peer stays out of their bundle.

WCAG 2.2 AA (the testable parts live in `./canvas-model`, unit-tested there):
- The canvas region is `role="application"` (interactive) or `role="img"`
  (read-only) with an `aria-label` summarising node/edge counts. An image has
  no focusable content, so the read-only canvas is `inert` (`canvasA11yModel`).
- `aria-roledescription="Flow diagram"` names the widget for screen readers.
- Pan/zoom animation is suppressed under `prefers-reduced-motion: reduce` (CSS).
- Each node is keyboard-focusable (`@xyflow/svelte`'s `NodeWrapper` renders the
  Tab stop); arrow-key focus movement is computed by `nextFocusTarget()` for
  consumers wiring `onnodeclick`.
- The upstream attribution link is recoloured to reach 4.5:1 (1.4.3).

Plain `tsc` does not type-check `.svelte`; the typed core lives in
`./canvas-model` + `./node-view` and is unit-tested there.
-->
<script lang="ts">
	import {
		SvelteFlow,
		SvelteFlowProvider,
		type Node,
		type Edge,
		type NodeTypes,
	} from '@xyflow/svelte';
	import type { Snippet } from 'svelte';
	import {
		applyElkLayout,
		canvasA11yModel,
		canvasAriaLabel,
		type OnLayout,
	} from './canvas-model.js';
	import type { ElkLayoutOptions } from './layout.js';

	interface Props {
		/** The nodes to render. Bindable so drag/position updates flow back out. */
		nodes?: Node[];
		/** The edges to render. Bindable so connection updates flow back out. */
		edges?: Edge[];
		/** Maps node `type` keys to components (e.g. the example node palette). */
		nodeTypes?: NodeTypes;
		/** Fit the viewport to all nodes on mount. Default `true`. */
		fitView?: boolean;
		/** When `true`, the canvas is a non-interactive image (`role="img"`, inert). */
		readonly?: boolean;
		/** Accessible label prefix; node/edge counts are appended automatically. */
		ariaLabel?: string;
		/** ELK options used by {@link runLayout}. */
		layoutOptions?: ElkLayoutOptions;
		/** Notified after `runLayout()` re-positions the nodes. */
		onlayout?: OnLayout<Node>;
		/** Extra canvas children (`<Background>`, `<Controls>`, `<MiniMap>`, …). */
		children?: Snippet;
	}

	let {
		nodes = $bindable([]),
		edges = $bindable([]),
		nodeTypes = {},
		fitView = true,
		readonly = false,
		ariaLabel,
		layoutOptions,
		onlayout,
		children,
	}: Props = $props();

	const label = $derived(canvasAriaLabel(nodes, edges, ariaLabel));
	const a11y = $derived(canvasA11yModel(readonly));

	/** Run ELK auto-layout over the current graph and commit the new positions. */
	export async function runLayout(): Promise<void> {
		const next = await applyElkLayout(nodes, edges, layoutOptions);
		nodes = next;
		onlayout?.(next);
	}
</script>

<div
	class="ssentio-flow-canvas"
	role={a11y.role}
	aria-roledescription="Flow diagram"
	aria-label={label}
>
	<div class="ssentio-flow-canvas__inner" inert={a11y.inert}>
		<SvelteFlowProvider>
			<SvelteFlow
				bind:nodes
				bind:edges
				{nodeTypes}
				{fitView}
				nodesDraggable={a11y.nodesDraggable}
				nodesConnectable={a11y.nodesConnectable}
				elementsSelectable={a11y.elementsSelectable}
				nodesFocusable={a11y.nodesFocusable}
				edgesFocusable={a11y.edgesFocusable}
			>
				{#if children}{@render children()}{/if}
			</SvelteFlow>
		</SvelteFlowProvider>
	</div>
</div>

<style>
	.ssentio-flow-canvas,
	.ssentio-flow-canvas__inner {
		inline-size: 100%;
		block-size: 100%;
	}

	.ssentio-flow-canvas {
		min-block-size: 20rem;
		position: relative;
	}

	/* Upstream draws the attribution link in #999 (2.84:1 on white). */
	.ssentio-flow-canvas :global(.svelte-flow__attribution a) {
		color: #595959;
	}

	.ssentio-flow-canvas :global(.svelte-flow.dark .svelte-flow__attribution a) {
		color: #d4d4d8;
	}

	@media (prefers-reduced-motion: reduce) {
		.ssentio-flow-canvas :global(.svelte-flow__viewport) {
			transition: none !important;
		}
	}
</style>
