# @sveltesentio/collab

> Yjs CRDT collaboration — `y-websocket` provider + `createYjsStore` / `createYjsMap` Svelte 5 rune helpers + awareness/presence helpers.

## Status

**Shipped (v0.2.0).** Locked through [ADR-0039](../../docs/adr/0039-y-websocket-createYjsStore.md).

## Surface

```ts
import * as Y from 'yjs';
import { createYjsStore, createYjsMap, connectProvider } from '@sveltesentio/collab';

const doc = new Y.Doc();
const { provider } = connectProvider({
	url: 'wss://collab.example.com',
	room: 'doc-42',
	doc,
});

const items = createYjsStore(doc.getArray<Item>('items'));
const meta = createYjsMap(doc.getMap<string>('meta'));
```

- `createYjsStore<T>(yArray)` → `$state`-backed proxy with `push`, `insert`, `delete` routing through the Y.Array.
- `createYjsMap<V>(yMap)` → `$state`-backed proxy with `set`, `delete`, `clear`, iteration routing through the Y.Map.
- `createYjsText(yText)` → `$state`-backed proxy with `insert`, `delete`, `append` routing through the Y.Text.
- Lifecycle: subscribes on `$effect` mount, unsubscribes on destroy. No leaks.

## Sub-exports

Two layers. The `yjs-*` helpers are plain functions over a Y type — no Svelte, no
DOM, unit-testable in Node. The `*-store` entry points wrap the same types in a
`$state`-backed proxy that subscribes on mount and unsubscribes on destroy. Reach
for a store in a component and the raw helper everywhere else.

| Import                                | What                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `@sveltesentio/collab`                | The re-export surface for everything below                                                                           |
| `@sveltesentio/collab/array`          | `snapshotYjsArray`, `observeYjsArray`, `appendToYjsArray`, `insertIntoYjsArray`, `deleteFromYjsArray`, `transactYjs` |
| `@sveltesentio/collab/map`            | `snapshotYjsMap`, `snapshotYjsMapEntries`, `observeYjsMap`, `setYjsMap`, `deleteYjsMap`, `clearYjsMap`               |
| `@sveltesentio/collab/text`           | `snapshotYjsText`, `observeYjsText`, `insertYjsText`, `deleteYjsText`, `appendYjsText`                               |
| `@sveltesentio/collab/store`          | `createYjsStore` — `$state` proxy over a `Y.Array`                                                                   |
| `@sveltesentio/collab/map-store`      | `createYjsMap` — `$state` proxy over a `Y.Map`                                                                       |
| `@sveltesentio/collab/text-store`     | `createYjsText` — `$state` proxy over a `Y.Text`                                                                     |
| `@sveltesentio/collab/awareness`      | `PresenceEntry`, `PresenceDiff`, presence observation over an awareness provider                                     |
| `@sveltesentio/collab/presence-store` | `createPresenceStore` — the rune-backed counterpart to `./awareness`                                                 |
| `@sveltesentio/collab/provider`       | `connectProvider`, `resolveAuthParams` — provider connection and auth binding                                        |

## Awareness / presence (v0.2.0)

Typed helpers over a `y-protocols/awareness` Awareness instance. `y-protocols`
is an **optional** peer — the helpers are written against a structural
`AwarenessLike` interface, so they work with any awareness implementation.

```ts
import { connectProvider } from '@sveltesentio/collab/provider';
import { createPresenceStore } from '@sveltesentio/collab/presence-store';

const { provider } = connectProvider({ url, room, doc });
// y-websocket exposes provider.awareness (a y-protocols Awareness)
const presence = createPresenceStore<{ name: string; color: string }>(provider.awareness);

presence.setLocal({ name: 'Ada', color: '#f43f5e' });

// reactive in a .svelte component:
// {#each presence.others as { clientId, state }} … {/each}
```

Pure helpers (no runes, unit-tested) live under `./awareness`:

- `setLocalPresence(awareness, state)` / `patchLocalPresence(awareness, patch)` — write local state.
- `snapshotPresence(awareness)` → `Map<clientId, state>` (fresh copy).
- `snapshotOthers(awareness, excludeLocal?)` → `{clientId, state}[]`.
- `observePresence(awareness, cb, { event? })` → unsubscribe (`'change'` by default).
- `diffPresence(prev, next)` → `{ added, updated, removed }` for presence-change UX.

## Opt-in extensions (recipes, not framework locks)

- Offline persistence: [`docs/compose/collab-persistence.md`](../../docs/compose/collab-persistence.md) — `y-indexeddb` wiring.
- Peer-to-peer: [`docs/compose/collab-p2p.md`](../../docs/compose/collab-p2p.md) — `y-webrtc` wiring.

## Design notes

- No `y-svelte` dependency — pre-runes, stale. We ship the runes helper ourselves.
- TanStack Query is the wrong tool for CRDT merge — it solves server-state fetch, not last-writer-wins conflict resolution.

## Related ADRs

- [ADR-0009](../../docs/adr/0009-yjs-ywebsocket-framework-lock.md) — Yjs + `y-websocket` framework lock.
- [ADR-0039](../../docs/adr/0039-y-websocket-createYjsStore.md) — `createYjsStore` rune helper.
