# Flow advanced — smart handles, AABB collision drop, snapshot undo

[flow-basics.md](flow-basics.md) covers the shipped `@sveltesentio/flow`
surface. This recipe documents patterns that **do not** ship in the
wrapper per [ADR-0004](../adr/0004-flow-thin-xyflow-wrapper.md) —
subdo-specific canvas logic that apps own locally. Forcing these on
future consumers is premature abstraction; documenting them here keeps
the escape hatch transparent.

Three patterns:

1. **Smart handle routing** — pick the edge handle closest to the
   target, not the one the user dragged from.
2. **Collision-aware AABB drop** — block palette drops that overlap
   existing nodes; nudge to the nearest free cell.
3. **Full-snapshot undo** — store `{ nodes, edges }` snapshots per
   user action instead of using `Y.UndoManager` (works cleanly with
   Yjs collab; keeps undo stack local-only).

If you need all three, copy them to `src/lib/flow/` in your app. They
total ~200 LOC — thinner than any wrapper would be.

## Smart handle routing

xyflow renders edges between the exact handle IDs the user connected.
For dense graphs that creates crossings. Smart routing picks the
nearest source+target handle pair:

```ts
// src/lib/flow/smart-handles.ts
import type { Node, Edge, XYPosition } from '@xyflow/svelte';

type HandleId = 'top' | 'right' | 'bottom' | 'left';

const HANDLE_POSITIONS: Record<HandleId, (n: Node) => XYPosition> = {
  top:    (n) => ({ x: n.position.x + (n.width ?? 0) / 2, y: n.position.y }),
  right:  (n) => ({ x: n.position.x + (n.width ?? 0),     y: n.position.y + (n.height ?? 0) / 2 }),
  bottom: (n) => ({ x: n.position.x + (n.width ?? 0) / 2, y: n.position.y + (n.height ?? 0) }),
  left:   (n) => ({ x: n.position.x,                      y: n.position.y + (n.height ?? 0) / 2 }),
};

function dist(a: XYPosition, b: XYPosition) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function routeSmartEdge(
  edge: Edge,
  nodes: Node[],
): Edge {
  const source = nodes.find((n) => n.id === edge.source);
  const target = nodes.find((n) => n.id === edge.target);
  if (!source || !target) return edge;

  const handles: HandleId[] = ['top', 'right', 'bottom', 'left'];
  let best = { src: edge.sourceHandle as HandleId, tgt: edge.targetHandle as HandleId, d: Infinity };

  for (const src of handles) {
    for (const tgt of handles) {
      const d = dist(HANDLE_POSITIONS[src](source), HANDLE_POSITIONS[tgt](target));
      if (d < best.d) best = { src, tgt, d };
    }
  }

  return { ...edge, sourceHandle: best.src, targetHandle: best.tgt };
}
```

Wire into your flow page via `$derived`:

```svelte
<script lang="ts">
  import { routeSmartEdge } from '$lib/flow/smart-handles';

  const smartEdges = $derived(edges.map((e) => routeSmartEdge(e, nodes)));
</script>

<SvelteFlow bind:nodes edges={smartEdges} …>
```

Cost is O(E × 16) per render — trivial up to ~1000 edges. Above that,
memoize per edge (cache `{edgeId, srcPos, tgtPos}` → routed) and only
recompute when a node moves.

**Trade-off.** If you store `sourceHandle` in Yjs (collab), smart
routing becomes a render-time derivation, not a persisted choice.
Don't persist the routed handles — remote peers re-derive. Persist
only user-intent handles (null-allowed) and let the router decide.

## Collision-aware palette drop

When a palette item drops on an existing node, xyflow places it
overlapping by default. Prevent that with AABB intersection + nudge:

```ts
// src/lib/flow/aabb-drop.ts
import type { Node, XYPosition } from '@xyflow/svelte';

export type Size = { width: number; height: number };

function intersects(a: Node, b: { position: XYPosition } & Size) {
  const aw = a.width ?? 0, ah = a.height ?? 0;
  return (
    a.position.x < b.position.x + b.width &&
    a.position.x + aw > b.position.x &&
    a.position.y < b.position.y + b.height &&
    a.position.y + ah > b.position.y
  );
}

export function resolveDrop(
  candidate: XYPosition,
  size: Size,
  nodes: Node[],
  grid = 16,
): XYPosition {
  const snapped = {
    x: Math.round(candidate.x / grid) * grid,
    y: Math.round(candidate.y / grid) * grid,
  };

  const conflicts = nodes.filter((n) => intersects(n, { position: snapped, ...size }));
  if (conflicts.length === 0) return snapped;

  // Spiral out in grid steps until free.
  for (let r = 1; r < 20; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const trial = { x: snapped.x + dx * grid, y: snapped.y + dy * grid };
        const hit = nodes.some((n) => intersects(n, { position: trial, ...size }));
        if (!hit) return trial;
      }
    }
  }
  return snapped; // give up — user can drag to reposition
}
```

Integration:

```svelte
<script lang="ts">
  import { resolveDrop } from '$lib/flow/aabb-drop';
  import { useSvelteFlow } from '@xyflow/svelte';

  const { screenToFlowPosition } = useSvelteFlow();

  function ondrop(e: DragEvent) {
    e.preventDefault();
    const spec = JSON.parse(e.dataTransfer!.getData('application/flow-node'));
    const raw = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const position = resolveDrop(raw, { width: 160, height: 80 }, nodes);
    nodes.push({ id: crypto.randomUUID(), type: spec.type, position, data: spec.data });
  }
</script>

<div role="region" aria-label="Flow canvas" ondragover={(e) => e.preventDefault()} {ondrop}>
  <SvelteFlow bind:nodes …/>
</div>
```

Spiral radius cap (20 grid cells ~= 320 px at `grid=16`) is defensive
— very dense canvases fall through to the raw drop, which the user
can drag to reposition. Don't infinite-loop.

Announce nudges to SR users:

```ts
if (trial.x !== snapped.x || trial.y !== snapped.y) {
  announce('Node placed near drop target to avoid overlap.');
}
```

`announce()` is an `aria-live="polite"` helper — see
[toast.md](toast.md).

## Full-snapshot undo (collab-compatible)

`Y.UndoManager` undoes remote operations too unless `trackedOrigins`
is carefully scoped. Subdo sidesteps that by storing full `{nodes,
edges}` snapshots in a local ring buffer:

```ts
// src/lib/flow/history.ts
import type { Node, Edge } from '@xyflow/svelte';

type Snapshot = { nodes: Node[]; edges: Edge[]; label: string; ts: number };

export function createHistory(limit = 50) {
  const past = $state<Snapshot[]>([]);
  const future = $state<Snapshot[]>([]);

  return {
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    push(snap: Omit<Snapshot, 'ts'>) {
      past.push({ ...snap, ts: Date.now() });
      if (past.length > limit) past.shift();
      future.length = 0;
    },
    undo(current: Snapshot): Snapshot | null {
      const prev = past.pop();
      if (!prev) return null;
      future.push(current);
      return prev;
    },
    redo(current: Snapshot): Snapshot | null {
      const next = future.pop();
      if (!next) return null;
      past.push(current);
      return next;
    },
  };
}
```

Wire keyboard shortcuts via tinykeys (see
[command-palette.md](command-palette.md)):

```svelte
<script lang="ts">
  import tinykeys from 'tinykeys';
  import { createHistory } from '$lib/flow/history';

  const history = createHistory();

  function snap(label: string) {
    history.push({ nodes: structuredClone(nodes), edges: structuredClone(edges), label });
  }

  onMount(() => tinykeys(window, {
    '$mod+z': () => {
      const prev = history.undo({ nodes, edges, label: 'current', ts: Date.now() });
      if (prev) { nodes = prev.nodes; edges = prev.edges; }
    },
    '$mod+Shift+z': () => {
      const next = history.redo({ nodes, edges, label: 'current', ts: Date.now() });
      if (next) { nodes = next.nodes; edges = next.edges; }
    },
  }));
</script>
```

Snapshot cadence — call `snap()` per user-intent action (drop,
connect, delete), **not** per nodes mutation. Continuous-drag would
otherwise blow past the limit.

**Collab trade-off.** Full-snapshot undo is local-only. In a collab
room, your undo reverts everyone's visible state on your machine.
You then push the reverted state back via Yjs, which propagates the
"undo" to peers. This is simpler than `Y.UndoManager`'s
fine-grained origin tracking but can surprise other editors. Document
the behavior or gate undo to solo sessions.

## Keyboard-reachable canvas

Pure drag-based flow editing fails WCAG 2.1.1. Wire keyboard
equivalents:

| Intent | Shortcut | Notes |
|---|---|---|
| Select node | `Tab` | Rely on xyflow's `tabIndex` default |
| Move selected | `Arrow` (+`Shift` fast) | Your handler |
| Delete selected | `Delete` / `Backspace` | xyflow default |
| Connect | Enter-menu "Connect to…" | List reachable nodes |
| Undo / redo | `$mod+z` / `$mod+Shift+z` | history above |
| Palette search | `/` | Filter palette focus |

The Connect-via-menu pattern is the hardest — surface it as a
context-menu item triggered by `Enter` on a focused node. See
[command-palette.md](command-palette.md) for the `defineCommand`
primitive.

## Testing

```ts
// smart-handles.test.ts
test('route picks closest pair', () => {
  const a: Node = { id: 'a', position: { x: 0, y: 0 }, width: 100, height: 50 } as Node;
  const b: Node = { id: 'b', position: { x: 300, y: 0 }, width: 100, height: 50 } as Node;
  const edge = { id: 'e', source: 'a', target: 'b', sourceHandle: 'top', targetHandle: 'bottom' } as Edge;
  expect(routeSmartEdge(edge, [a, b])).toMatchObject({ sourceHandle: 'right', targetHandle: 'left' });
});

// aabb-drop.test.ts
test('resolves overlap to nearest free cell', () => {
  const blocker: Node = { id: 'x', position: { x: 0, y: 0 }, width: 100, height: 50 } as Node;
  const pos = resolveDrop({ x: 16, y: 16 }, { width: 100, height: 50 }, [blocker]);
  expect(pos).not.toEqual({ x: 16, y: 16 });
  expect(Math.abs(pos.x - 16) % 16).toBe(0);
});
```

Playwright keyboard navigation:

```ts
test('keyboard delete removes selected node', async ({ page }) => {
  await page.goto('/flows/demo');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Delete');
  await expect(page.locator('.svelte-flow__node')).toHaveCount(0);
});
```

## When to give up and ship it in `@sveltesentio/flow`

If ≥3 downstream apps adopt the same smart-handle or AABB pattern
unchanged, re-open ADR-0004 with the evidence and propose promotion.
Until then, keep it app-local. Premature wrapper growth is the
anti-pattern this ADR exists to prevent.

## Anti-patterns

- **Persisting smart-routed handle IDs in Yjs.** Re-derive on render.
  Persist only user intent; let peers re-route.
- **AABB check on every pointer-move.** Only run on drop. Moving a
  node through others is fine as a pointer gesture.
- **`Y.UndoManager` with default `trackedOrigins`.** Undoes remote
  ops. Either scope origins carefully (see
  [collab-persistence.md](collab-persistence.md)) or snapshot-undo
  as above.
- **Snapshot push per node mutation.** Continuous drag explodes the
  buffer. Snapshot per user-intent action.
- **Shipping subdo idiosyncrasies back into
  `@sveltesentio/flow`.** ADR-0004 explicitly excludes them. Wait
  for ≥3 app adopters.
- **Mouse-only flow editing.** WCAG 2.1.1 fail. Keyboard must reach
  every interaction.

## References

- ADR-0004 — flow thin-wrapper decision; smart-handle-routing +
  collision-drop explicitly excluded.
- ADR-0010 — xyflow/svelte pin.
- [flow-basics.md](flow-basics.md) — shipped wrapper surface.
- [collab.md](collab.md) — Yjs sync adapter.
- [collab-persistence.md](collab-persistence.md) — `Y.UndoManager`
  `trackedOrigins` trade-offs.
- [command-palette.md](command-palette.md) — tinykeys + command
  primitives.
- xyflow Svelte docs: <https://svelteflow.dev>.
