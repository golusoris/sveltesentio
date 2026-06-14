# Collab — offline persistence (`y-indexeddb`)

`@sveltesentio/collab` does **not** bundle offline persistence by default
per [ADR-0009](../adr/0009-yjs-y-websocket-collab.md). This recipe shows
the opt-in path: layer `y-indexeddb@^9` under the Y.Doc + `y-websocket`
pair documented in [collab.md](collab.md) so local edits survive reloads,
tab crashes, and (bounded) offline sessions.

Use this when any of:

- The doc must remain editable while the user is on a flaky / no
  connection.
- Page reloads must preserve unsynced local writes.
- Users expect in-session state to persist across tab kills.

Skip if the doc is short-lived, ephemeral, or fully server-authoritative
between sessions (e.g. chat threads with a durable server log).

## Install

```bash
pnpm add y-indexeddb
```

Peer: `y-indexeddb@^9` pairs with `yjs@^13.6`. No separate SSR guard —
the module no-ops outside the browser, but you still want `browser`
gating so it doesn't try to allocate an IDB handle server-side.

## Lifecycle

```ts
// src/lib/collab/flow.ts
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { browser } from '$app/environment';

export type CollabHandle = {
  doc: Y.Doc;
  ws: WebsocketProvider;
  idb: IndexeddbPersistence;
  ready: Promise<void>;
  destroy(): void;
};

export function connectFlow(flowId: string): CollabHandle {
  if (!browser) throw new Error('collab client-only');

  const doc = new Y.Doc();
  const idb = new IndexeddbPersistence(`flow:${flowId}`, doc);
  const ws = new WebsocketProvider(
    '/collab',
    flowId,
    doc,
    { connect: true },
  );

  const ready = new Promise<void>((resolve) => {
    idb.once('synced', resolve);
  });

  return {
    doc,
    ws,
    idb,
    ready,
    destroy() {
      ws.destroy();
      idb.destroy();
      doc.destroy();
    },
  };
}
```

Order matters: construct `IndexeddbPersistence` **before** the WS
provider so local state loads first, then server diffs reconcile on top.

## Route wiring

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { connectFlow, type CollabHandle } from '$lib/collab/flow';

  let { data } = $props();
  let handle = $state<CollabHandle | null>(null);
  let restored = $state(false);

  onMount(async () => {
    handle = connectFlow(data.flowId);
    await handle.ready;
    restored = true;
  });

  onDestroy(() => handle?.destroy());
</script>

{#if !restored}
  <p role="status" aria-live="polite">Restoring local changes…</p>
{:else}
  <!-- render flow -->
{/if}
```

Announce restore via `role="status"` — some local syncs take 100–500 ms
on slow devices, and a silent wait looks like a hang.

## Connectivity indicator

Surface offline state so writes don't feel lost:

```svelte
<script lang="ts">
  let synced = $state(false);
  let online = $state(navigator.onLine);

  $effect(() => {
    if (!handle) return;
    const onStatus = ({ status }: { status: string }) => {
      synced = status === 'connected';
    };
    handle.ws.on('status', onStatus);
    const onOnline = () => (online = true);
    const onOffline = () => (online = false);
    addEventListener('online', onOnline);
    addEventListener('offline', onOffline);
    return () => {
      handle!.ws.off('status', onStatus);
      removeEventListener('online', onOnline);
      removeEventListener('offline', onOffline);
    };
  });
</script>

{#if !online}
  <div role="status" class="bg-warn text-warn-fg">
    Offline — changes saved locally, will sync on reconnect.
  </div>
{:else if !synced}
  <div role="status" class="text-muted-fg">Reconnecting…</div>
{/if}
```

`role="status"` (not `"alert"`) — connectivity transitions are
informational, not emergency. See [toast.md](toast.md) for role choice.

## Storage contract

| Key | Database | Notes |
|---|---|---|
| IDB database | `y-indexeddb` (default) | One DB per browser origin |
| Object store | one per doc ID | `flow:${flowId}` above |
| Payload | Yjs binary update blobs | Not human-inspectable |
| Eviction | browser-managed (LRU) | Storage Access API for persistent grants |

To survive eviction pressure, request persistent storage on sensitive
docs:

```ts
if (navigator.storage?.persist) {
  await navigator.storage.persist();
}
```

Chrome + Firefox grant based on engagement signals; Safari requires a
user gesture. Don't block UI on the grant — it's advisory.

## Clearing / switching users

IndexedDB persists across sessions and, crucially, across users on
shared devices. On logout, **purge** docs for the prior user:

```ts
export async function clearFlow(flowId: string) {
  await IndexeddbPersistence.clearData(`flow:${flowId}`);
}

// in auth logout handler:
for (const id of await listCachedFlows()) {
  await clearFlow(id);
}
```

`listCachedFlows()` is app-specific — track the IDs you opened in
`localStorage` or derive from server-side user-doc mapping.

Anti-pattern: leaving another user's unsynced edits in IDB after
logout. Security-sensitive for shared workstations.

## Conflict resolution across sessions

Yjs CRDT semantics apply — local offline edits merge with server state
on reconnect. No manual resolution needed for most ops. Edge cases:

- **Deleted-on-server, edited-offline.** Yjs keeps the edit; server
  must decide policy (resurrect vs. reject via server-side diff
  handler).
- **Awareness.** Offline awareness (`{ name, color, cursor }`) is
  ephemeral — not persisted. On reconnect, peers see a stale cursor
  momentarily. Acceptable.
- **Provider-level snapshot.** If Golusoris's
  `GET /collab/:id/snapshot` returns a newer baseline than IDB has,
  Yjs re-applies the diff — state converges.

## Capacity planning

IndexedDB gives ~10% of disk or 1 GB per origin (Chrome), 1 GB per
origin (Firefox), 1 GB per origin (Safari). The Y.Doc grows unbounded
without periodic compaction:

```ts
export async function compact(doc: Y.Doc, flowId: string) {
  const snapshot = Y.encodeStateAsUpdate(doc);
  await IndexeddbPersistence.clearData(`flow:${flowId}`);
  const fresh = new IndexeddbPersistence(`flow:${flowId}`, doc);
  await new Promise((r) => fresh.once('synced', r));
  Y.applyUpdate(doc, snapshot);
}
```

Run on idle (`requestIdleCallback`) after the user finishes an edit
session. Don't compact mid-edit — breaks the subscription cycle.

Alternative: compact server-side during the periodic snapshot and
re-ship on reconnect.

## Testing

```ts
// collab-persistence.test.ts
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import 'fake-indexeddb/auto';

test('local edits restore after reload', async () => {
  const docA = new Y.Doc();
  const idbA = new IndexeddbPersistence('flow:test', docA);
  await new Promise((r) => idbA.once('synced', r));

  docA.getArray('nodes').push([{ id: 'n-1' }]);
  await idbA.whenSynced;
  idbA.destroy();
  docA.destroy();

  const docB = new Y.Doc();
  const idbB = new IndexeddbPersistence('flow:test', docB);
  await new Promise((r) => idbB.once('synced', r));

  expect(docB.getArray('nodes').toArray()).toHaveLength(1);
  idbB.destroy();
});
```

`fake-indexeddb` ships from `@sveltesentio/testing/collab` pre-wired.
Playwright integration uses real IndexedDB — assert restore with
`context.newPage()` after `page.close()`.

## Combining with `Y.UndoManager`

IDB persists the full update log — including server deltas. If you
pair this with `Y.UndoManager` (see [collab.md](collab.md)), be sure
`trackedOrigins` is restrictive, otherwise undo traverses server
history after a reload. Typical fix:

```ts
const undoManager = new Y.UndoManager(doc.getArray('nodes'), {
  trackedOrigins: new Set(['local']),
  captureTimeout: 500,
});
```

## Anti-patterns

- **Persisting without server reconciliation.** IDB-only = fork risk.
  Always pair with a provider (`y-websocket` per ADR-0009 or
  [collab-p2p.md](collab-p2p.md)).
- **Bundling `y-indexeddb` by default.** Violates ADR-0009 — opt-in per
  app. Don't re-export from `@sveltesentio/collab` entry.
- **Running IDB on the server.** Yjs + IDB are client-only. Always
  `browser`-gate.
- **Not clearing on logout.** Leaks prior user state on shared devices.
  Security issue on kiosks / family devices.
- **Compacting mid-edit.** `clearData` interrupts the subscription.
  Schedule compaction on idle or after explicit "save" gestures.
- **Storing secrets in Y.Doc.** IDB is readable by any JS on the
  origin. Secrets belong in HttpOnly cookies (see
  [auth-oidc.md](auth-oidc.md)).

## References

- ADR-0009 — Yjs + y-websocket lock; `y-indexeddb` as opt-in extension.
- [collab.md](collab.md) — default WS path + `createYjsStore`.
- [collab-p2p.md](collab-p2p.md) — opt-in P2P transport.
- `y-indexeddb`: <https://github.com/yjs/y-indexeddb>.
- Storage Access API: <https://developer.mozilla.org/en-US/docs/Web/API/Storage_API>.
