# Collab — Yjs + y-websocket + `createYjsStore`

`@sveltesentio/collab` wraps `yjs@^13.6` + `y-websocket@^3` with a
runes-first helper (`createYjsStore<T>`) so components can read a
shared Y.Doc as if it were local `$state`. No `y-svelte` binding — we
own the subscribe/unsubscribe lifecycle.

See [ADR-0009](../adr/0009-yjs-y-websocket-collab.md) (Yjs + y-websocket
framework lock), [ADR-0039](../adr/0039-y-websocket-createYjsStore.md)
(runes helper decision), [ADR-0008](../adr/0008-tanstack-svelte-query-v6.md)
(why this is **not** TanStack Query).

## Install

```bash
pnpm add @sveltesentio/collab yjs y-websocket
# Optional opt-ins:
pnpm add y-indexeddb   # offline persistence — see collab-persistence.md (pending)
pnpm add y-webrtc      # peer-to-peer — see collab-p2p.md (pending)
```

`y-indexeddb` and `y-webrtc` are **not** bundled by default per ADR-0009.

## Architecture

```text
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│ Browser  │────▶│ Y.Doc (CRDT) │────▶│  y-websocket │
│ (Svelte) │◀────│  + awareness │◀────│   provider   │
└──────────┘     └──────────────┘     └──────┬───────┘
                                             │ WS
                                             ▼
                                      ┌──────────────┐
                                      │  Golusoris   │
                                      │ /collab/:id  │
                                      └──────────────┘
```

Every edit routes through the Y.Doc; the provider syncs the resulting
update vector to the server, which rebroadcasts to other peers.
Presence ("who's online, where's their cursor") flows through the
provider's `awareness` channel — not the Y.Doc.

## Wiring a Y.Doc + provider

```ts
// src/lib/collab.ts
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

export function connectFlow(flowId: string) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(
    import.meta.env.VITE_COLLAB_WS_URL, // wss://golusoris.example/collab
    flowId,
    doc,
    { connect: true },
  );

  provider.awareness.setLocalStateField('user', {
    name: currentUser.name,
    color: currentUser.color,
  });

  return { doc, provider };
}
```

`WebsocketProvider` reconnects with exponential backoff by default. For
dev without a running server, pass `{ connect: false }` and flip it later
via `provider.connect()`.

## Consuming Y types from components

`createYjsStore<T>` wraps a `Y.Array<T>` in a `$state`-backed proxy.
The proxy is read-only for rendering; mutations route through the Y type.

```svelte
<!-- src/routes/flows/[id]/+page.svelte -->
<script lang="ts">
  import { createYjsStore } from '@sveltesentio/collab';
  import { onMount, onDestroy } from 'svelte';
  import { connectFlow } from '$lib/collab';

  let { data } = $props();
  let doc: Y.Doc;
  let provider: WebsocketProvider;

  onMount(() => {
    ({ doc, provider } = connectFlow(data.flowId));
  });

  onDestroy(() => provider?.destroy());

  const nodes = createYjsStore<FlowNode>(() => doc.getArray<FlowNode>('nodes'));

  function addNode() {
    doc.transact(() => {
      doc.getArray<FlowNode>('nodes').push([{ id: crypto.randomUUID(), x: 0, y: 0 }]);
    });
  }
</script>

{#each nodes.value as node (node.id)}
  <div style:transform="translate({node.x}px, {node.y}px)">{node.id}</div>
{/each}

<button onclick={addNode}>Add node</button>
```

`createYjsStore` subscribes via `observe()` on `$effect` mount, unsubscribes
on destroy, and calls `.toArray()` to snapshot the initial value. The
returned object exposes `.value` — a `$state`-backed array that re-renders
on every Y.Doc update.

For `Y.Map`, use `createYjsMap<K, V>`:

```ts
const cursors = createYjsMap<string, Cursor>(() => doc.getMap<Cursor>('cursors'));
// cursors.value is Map<string, Cursor>
```

## Transactions

Always wrap multi-step mutations in `doc.transact()` — one update
broadcast, one observer fire, atomic from peers' perspectives.

```ts
doc.transact(() => {
  yNodes.delete(0, 1);
  yNodes.insert(0, [newNode]);
  yEdges.push([{ from: newNode.id, to: 'n-42' }]);
}, 'local'); // origin tag — filter in observers to skip own edits
```

## Awareness (presence + cursors)

Awareness is **not** persisted — it's live-only state keyed by client ID.

```ts
// src/lib/presence.ts
import { onDestroy } from 'svelte';
import type { Awareness } from 'y-protocols/awareness';

export function usePresence(awareness: Awareness) {
  let peers = $state<PresenceState[]>([]);

  $effect(() => {
    const onUpdate = () => {
      peers = [...awareness.getStates().entries()]
        .filter(([id]) => id !== awareness.clientID)
        .map(([id, s]) => ({ id, ...(s.user ?? {}) }));
    };
    awareness.on('change', onUpdate);
    onUpdate();
    return () => awareness.off('change', onUpdate);
  });

  return { get peers() { return peers; } };
}
```

Call `awareness.setLocalStateField('cursor', { x, y })` on pointermove
(throttled ~50ms) and render peer cursors from `peers`.

## Undo

`Y.UndoManager` is opt-in — not bundled. For undo/redo:

```ts
import * as Y from 'yjs';

const undoManager = new Y.UndoManager(yNodes, {
  trackedOrigins: new Set(['local']),
  captureTimeout: 500,
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'z') undoManager.undo();
  if (e.ctrlKey && e.key === 'y') undoManager.redo();
});
```

`trackedOrigins` must match the origin tag passed to `doc.transact()`.
Without it, remote edits get undone too — bad UX.

## Offline persistence (opt-in)

`y-indexeddb` caches the Y.Doc in IndexedDB so reloading restores local
edits even without server connectivity.

```ts
import { IndexeddbPersistence } from 'y-indexeddb';

const persistence = new IndexeddbPersistence(`flow:${flowId}`, doc);
persistence.once('synced', () => {
  console.warn('[collab] IndexedDB restored');
});
```

See `collab-persistence.md` (pending) for the full lifecycle.

## SSR considerations

Yjs is client-only. Guard with `browser` from `$app/environment`:

```ts
import { browser } from '$app/environment';

onMount(() => {
  if (!browser) return;
  ({ doc, provider } = connectFlow(data.flowId));
});
```

SSR renders a server-snapshot of the collab state (from Golusoris's
`GET /collab/:id/snapshot`); the Y.Doc takes over after hydration.

## Testing

`@sveltesentio/testing` ships a `mockProvider` that bypasses WebSocket and
drives updates in-memory — two Y.Docs synced through a fake channel.

```ts
import { mockProvider } from '@sveltesentio/testing/collab';

const docA = new Y.Doc();
const docB = new Y.Doc();
const { disconnect } = mockProvider(docA, docB);

docA.getArray('nodes').push([{ id: 'n-1' }]);
expect(docB.getArray('nodes').toArray()).toHaveLength(1);
disconnect();
```

## Anti-patterns

- **Mutating the `$state` proxy directly.** The proxy is a view. Writes
  must go through the Y type: `doc.getArray('nodes').push(...)`, not
  `nodes.value.push(...)`.
- **Reading `awareness.getStates()` during render.** It mutates on every
  peer update — subscribe via the `change` event and store in `$state`.
- **Putting server-fetched data in Y.Doc.** Y.Doc is for collaborative
  state (peers editing together). Use TanStack Query for server data
  (see [server-state.md](server-state.md)).
- **Creating a Y.Doc per component.** One Y.Doc per collab room, scoped
  at the route level. Multiple Y.Docs for the same room fork state.
- **Forgetting `provider.destroy()` on navigation.** Leaks a WS
  connection per visit. Always clean up in `onDestroy`.
- **Using `y-svelte`.** Pre-runes, stale. Use `createYjsStore` per
  ADR-0039.

## References

- ADR-0009 — Yjs + y-websocket lock.
- ADR-0039 — `createYjsStore` runes helper.
- Yjs docs: <https://docs.yjs.dev>.
- `y-websocket` README: <https://github.com/yjs/y-websocket>.
- Golusoris `collab/` README — server-side WS endpoint + snapshot shape.
