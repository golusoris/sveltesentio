# @sveltesentio/collab

> Yjs CRDT collaboration — `y-websocket` provider + `createYjsStore` / `createYjsMap` Svelte 5 rune helpers.

## Status

**Scaffold.** Public API unimplemented. Locked through [ADR-0039](../../docs/adr/0039-y-websocket-createYjsStore.md).

## Planned surface

```ts
import * as Y from 'yjs';
import { createYjsStore, createYjsMap, connectProvider } from '@sveltesentio/collab';

const doc = new Y.Doc();
const provider = connectProvider(doc, {
  url: 'wss://collab.example.com',
  room: 'doc-42',
});

const items = createYjsStore(doc.getArray<Item>('items'));
const meta  = createYjsMap(doc.getMap<string>('meta'));
```

- `createYjsStore<T>(yArray)` → `$state`-backed proxy with `push`, `delete`, `update` routing through the Y.Array.
- `createYjsMap<K, V>(yMap)` → `$state`-backed proxy with `set`, `delete`, iteration routing through the Y.Map.
- Lifecycle: subscribes on `$effect` mount, unsubscribes on destroy. No leaks.

## Opt-in extensions (recipes, not framework locks)

- Offline persistence: [`docs/compose/collab-persistence.md`](../../docs/compose/collab-persistence.md) — `y-indexeddb` wiring.
- Peer-to-peer: [`docs/compose/collab-p2p.md`](../../docs/compose/collab-p2p.md) — `y-webrtc` wiring.

## Design notes

- No `y-svelte` dependency — pre-runes, stale. We ship the runes helper ourselves.
- TanStack Query is the wrong tool for CRDT merge — it solves server-state fetch, not last-writer-wins conflict resolution.

## Related ADRs

- [ADR-0009](../../docs/adr/0009-yjs-ywebsocket-framework-lock.md) — Yjs + `y-websocket` framework lock.
- [ADR-0039](../../docs/adr/0039-y-websocket-createYjsStore.md) — `createYjsStore` rune helper.
