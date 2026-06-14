# Flow basics — `@sveltesentio/flow` (xyflow + elkjs + Yjs)

`@sveltesentio/flow` is a **thin** wrapper around `@xyflow/svelte@^1.5`
that ships: a11y-defaulted node/edge primitives, edge styles bound to
`@sveltesentio/ui` tokens, an elkjs-layout helper (Sugiyama layered +
ORTHOGONAL routing default), a category-themed palette component, and
a Yjs sync adapter. App-specific canvas logic (smart handle routing,
collision-aware drop) stays in app code — see
[flow-advanced.md](flow-advanced.md) (pending).

See [ADR-0004](../adr/0004-flow-thin-xyflow-wrapper.md) (thin-wrapper
decision) and [ADR-0010](../adr/0010-xyflow-svelte-flow-canvas.md)
(xyflow pin). Related: [collab.md](collab.md) (Yjs sync adapter),
[theming.md](theming.md) (edge token bindings).

## Install

```bash
pnpm add @sveltesentio/flow @xyflow/svelte elkjs
pnpm add '@xyflow/svelte/dist/style.css' # stylesheet side-effect
```

Peer range: `@xyflow/svelte@^1.5`, `elkjs@^0.9`, `svelte@^5`. The
xyflow stylesheet must be imported once at the app root (`+layout.svelte`
or `app.html`):

```svelte
<script lang="ts">
  import '@xyflow/svelte/dist/style.css';
</script>
```

## Minimal graph

```svelte
<!-- src/routes/flows/[id]/+page.svelte -->
<script lang="ts">
  import { SvelteFlow, Controls, Background, MiniMap } from '@xyflow/svelte';
  import { Node, Edge, FlowProvider } from '@sveltesentio/flow';
  import type { NodeSpec, EdgeSpec } from '@sveltesentio/flow';

  let { data } = $props();
  let nodes = $state<NodeSpec[]>(data.nodes);
  let edges = $state<EdgeSpec[]>(data.edges);
</script>

<FlowProvider>
  <SvelteFlow
    bind:nodes
    bind:edges
    nodeTypes={{ task: Node.Task, gateway: Node.Gateway }}
    edgeTypes={{ default: Edge.Default }}
    fitView
    minZoom={0.2}
    maxZoom={2}
  >
    <Background gap={16} />
    <Controls position="bottom-right" />
    <MiniMap pannable zoomable position="top-right" />
  </SvelteFlow>
</FlowProvider>
```

`FlowProvider` wires the theme (reads oklch tokens from
[theming.md](theming.md)) and installs the a11y defaults on every
rendered node + edge. `SvelteFlow` is xyflow's root component — the
wrapper stays out of its way.

## Node primitives

`Node.Task`, `Node.Gateway`, `Node.Event`, `Node.Note` cover the common
shapes. Each is keyboard-focusable, announces role + label to screen
readers, and respects `prefers-reduced-motion` on transitions.

Custom node types extend `Node.Base`:

```svelte
<!-- src/lib/flow/MyNode.svelte -->
<script lang="ts">
  import { Node } from '@sveltesentio/flow';
  import type { NodeProps } from '@xyflow/svelte';

  let { id, data, selected }: NodeProps<{ title: string; status: 'ok' | 'failed' }> = $props();
</script>

<Node.Base {id} {selected} ariaLabel={data.title}>
  <div class="rounded-md border border-border bg-bg px-3 py-2">
    <p class="font-medium text-fg">{data.title}</p>
    <p class="text-muted-fg text-sm">
      {data.status === 'ok' ? '✅' : '❌'}
    </p>
  </div>
</Node.Base>
```

`Node.Base` supplies: `tabindex="0"`, `role="group"`, `aria-label`,
`aria-selected`, keyboard delete on `Backspace` / `Delete`. Don't
re-implement these per node.

### Handles

Handles (connection anchors) are xyflow primitives:

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
</script>

<Node.Base {id} {selected}>
  <Handle type="target" position={Position.Left} />
  <!-- node content -->
  <Handle type="source" position={Position.Right} />
</Node.Base>
```

Handle positioning is xyflow's responsibility; the wrapper doesn't
layer over it. For smart handle routing (auto-pick source/target
position by geometry), see [flow-advanced.md](flow-advanced.md).

## Edge primitives

`Edge.Default`, `Edge.Conditional`, `Edge.Error` cover the common
semantic categories. Colors bind to oklch tokens:

| Edge type | Token |
|---|---|
| `Edge.Default` | `--color-border` |
| `Edge.Conditional` | `--color-accent` (dashed) |
| `Edge.Error` | `--color-danger` |

Custom edges compose `Edge.Base`:

```svelte
<script lang="ts">
  import { Edge } from '@sveltesentio/flow';
  import { BaseEdge, getBezierPath } from '@xyflow/svelte';
  import type { EdgeProps } from '@xyflow/svelte';

  let props: EdgeProps = $props();
  const [path] = $derived(getBezierPath(props));
</script>

<Edge.Base {...props}>
  <BaseEdge {path} class="stroke-[var(--color-accent)]" />
</Edge.Base>
```

`Edge.Base` adds `role="img"` + `aria-label` (derived from `data.label`
when present), keyboard delete, and the reduced-motion guard.

## elkjs layout

The wrapper ships `layoutGraph(nodes, edges, opts?)` — a promise that
returns a laid-out copy of `nodes` with `{ x, y }` set per elkjs. Default
algorithm is Sugiyama layered + ORTHOGONAL edge routing:

```ts
// src/routes/flows/[id]/+page.svelte
import { layoutGraph } from '@sveltesentio/flow';

async function autoLayout() {
  const laid = await layoutGraph(nodes, edges, {
    direction: 'RIGHT',     // DOWN | RIGHT | UP | LEFT — default RIGHT
    spacing: { node: 40, layer: 80 },
    routing: 'ORTHOGONAL',  // ORTHOGONAL | SPLINES | POLYLINE
  });
  nodes = laid;
}
```

elkjs runs in a web worker by default (`elk-worker.min.js`) — the main
thread doesn't jank on large graphs. For graphs > 1000 nodes, consider
chunking the layout or pre-computing on the server.

### When to layout

- **On load** — if the server-stored positions are stale or the schema
  changed.
- **On structural change** — a node is added/removed and positions no
  longer fit. Debounce so every drag doesn't re-layout.
- **Never during drag** — user intent overrides elkjs. Re-layout is a
  explicit button ("Auto-arrange").

## Palette (category-themed drawer)

```svelte
<script lang="ts">
  import { Palette, type PaletteCategory } from '@sveltesentio/flow';

  const categories: PaletteCategory[] = [
    {
      id: 'actions',
      label: 'Actions',
      tone: 'accent',
      items: [
        { type: 'task', label: 'HTTP request', data: { kind: 'http' } },
        { type: 'task', label: 'DB query', data: { kind: 'db' } },
      ],
    },
    {
      id: 'control',
      label: 'Control flow',
      tone: 'muted',
      items: [
        { type: 'gateway', label: 'Branch', data: { kind: 'if' } },
      ],
    },
  ];
</script>

<Palette {categories} />
```

Palette items are drag-sources — drop onto the canvas creates a node.
`tone` maps to oklch token roles (`accent` / `muted` / `success` /
`warning` / `danger`). The palette is keyboard-navigable: `Arrow` keys
move focus, `Space` picks an item (subsequent `Arrow` keys move a
ghost on the canvas, `Enter` drops).

## Yjs sync adapter

```ts
// src/routes/flows/[id]/+page.svelte
import { syncWithYjs } from '@sveltesentio/flow';
import { connectFlow } from '$lib/collab'; // from collab.md

const { doc, provider } = connectFlow(data.flowId);

const { nodes, edges, cleanup } = syncWithYjs({
  doc,
  nodes: doc.getArray('nodes'),
  edges: doc.getArray('edges'),
});

onDestroy(cleanup);
```

`syncWithYjs` returns `$state`-backed arrays that push local edits
through `doc.transact()` and observe remote edits via
`observe()` — the same pattern [collab.md](collab.md) documents. Undo
through `Y.UndoManager` works out of the box.

## Reduced motion

xyflow animates on pan / zoom / fit-view. The wrapper disables
animation when `prefers-reduced-motion: reduce` — `Controls` and
`fitView()` both respect it.

## Controlled vs uncontrolled

Both work. Use `bind:nodes` / `bind:edges` for controlled (app owns
state), or pass `defaultNodes` / `defaultEdges` for uncontrolled (xyflow
owns state). Yjs sync requires controlled — the Yjs Y.Array is the
source of truth.

## Testing

Unit tests with Testing Library; Playwright for interaction:

```ts
// Playwright: drag a palette item onto the canvas
test('palette drop creates a node', async ({ page }) => {
  await page.goto('/flows/new');
  await page.getByRole('button', { name: /http request/i }).dragTo(
    page.locator('[data-testid="flow-canvas"]'),
    { targetPosition: { x: 200, y: 200 } },
  );
  await expect(page.getByText('HTTP request')).toBeVisible();
});
```

## Anti-patterns

- **Using `SvelteFlow` without `FlowProvider`.** Loses the a11y
  defaults, token bindings, and reduced-motion guard. Always wrap.
- **Hard-coded colors in node/edge components.** Use `--color-*`
  tokens. Hex/HSL/oklch literals in `packages/flow/**` are a lint
  violation.
- **Rolling node primitives from raw `<div>`.** `Node.Base` enforces
  keyboard + ARIA. Custom nodes **extend** `Node.Base`; they don't
  bypass it.
- **Running elkjs on every drag.** User intent overrides auto-layout.
  Re-layout is an explicit action.
- **Putting nodes/edges in `writable()` stores.** Use `$state` (local)
  or Yjs (collab). `writable()` predates runes and loses SSR
  hydration guarantees.
- **Importing from `@xyflow/svelte` internals.** Stick to the public
  surface. Internals shift between minor versions.
- **Skipping the xyflow stylesheet.** The canvas renders without it
  but handles/edges look broken. Import once at the root.
- **Using `svelvet`.** No adopter evidence; xyflow is pinned by
  ADR-0010.
- **Bundling smart-handle-routing + collision-drop in the wrapper.**
  App-specific; they live in [flow-advanced.md](flow-advanced.md).

## References

- ADR-0004 — thin `@sveltesentio/flow` wrapper decision.
- ADR-0010 — `@xyflow/svelte` pin.
- [collab.md](collab.md) — Yjs sync adapter details.
- [theming.md](theming.md) — token pipeline for edge colors.
- xyflow Svelte docs: <https://svelteflow.dev>.
- elkjs docs: <https://github.com/kieler/elkjs>.
