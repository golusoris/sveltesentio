# @sveltesentio/collab — AGENTS.md

> Yjs CRDT collaboration. Locked through [ADR-0009](../../docs/adr/0009-yjs-ywebsocket-framework-lock.md) + [ADR-0039](../../docs/adr/0039-y-websocket-createYjsStore.md).

## Landed (v0.2.0)

| Sub-export         | Contents                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`                | Barrel re-export of everything below                                                                                                                                                                 |
| `./array`          | `snapshotYjsArray` / `observeYjsArray` / `appendToYjsArray` / `insertIntoYjsArray` / `deleteFromYjsArray` / `transactYjs` — pure helpers over `Y.Array<T>`                                           |
| `./map`            | `snapshotYjsMap` / `snapshotYjsMapEntries` / `observeYjsMap` / `setYjsMap` / `deleteYjsMap` / `clearYjsMap` — pure helpers over `Y.Map<V>`                                                           |
| `./text`           | `snapshotYjsText` / `observeYjsText` / `insertYjsText` / `deleteYjsText` / `appendYjsText` — pure helpers over `Y.Text`                                                                              |
| `./provider`       | `connectProvider({url, room, doc, ...})` — `y-websocket@^3` factory with status normalisation + `onStatusChange` / `onSync` callbacks; returns `{provider, disconnect}`                              |
| `./store`          | `createYjsStore<T>(yArray)` — `$state`-backed rune wrapper for `Y.Array<T>`                                                                                                                          |
| `./map-store`      | `createYjsMap<V>(yMap)` — `$state`-backed rune wrapper for `Y.Map<V>`                                                                                                                                |
| `./text-store`     | `createYjsText(yText)` — `$state`-backed rune wrapper for `Y.Text`                                                                                                                                   |
| `./awareness`      | `setLocalPresence` / `patchLocalPresence` / `snapshotPresence` / `snapshotOthers` / `observePresence` / `diffPresence` — pure helpers over structural `AwarenessLike` (no hard `y-protocols` import) |
| `./presence-store` | `createPresenceStore<S>(awareness, opts?)` — `$state`-backed rune wrapper exposing reactive `others` / `count` / `local` + `setLocal` / `patchLocal`                                                 |

Ships with ambient rune declarations (`src/runes-ambient.d.ts`).
Plain `tsc --noEmit` typechecks `.svelte.ts` files inside package; keep file while package `typecheck` script = plain tsc (`pnpm check:svelte` covers `.svelte` files only).

`y-protocols` = **optional** peer (`peerDependenciesMeta.y-protocols.optional`).
Awareness helpers type against structural `AwarenessLike` (`clientID` / `getStates` / `getLocalState` / `setLocalState` / `on` / `off`).
Need no hard import; unit-test against fake awareness.

## Follow-through

| Task                                                                | Why deferred                                                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `y-indexeddb` compose recipe (`docs/compose/collab-persistence.md`) | Opt-in per ADR-0009; not shipped as hard dep                                                          |
| `y-webrtc` compose recipe (`docs/compose/collab-p2p.md`)            | Opt-in per ADR-0009; not shipped as hard dep                                                          |
| Convergence tests (two `Y.Doc` + fake WebSocket pair)               | Needs shared test harness; tracked with broader integration-test phase                                |
| Auth-header binding on provider construction                        | Needs session-cookie handoff pattern from `@sveltesentio/auth` — revisit when downstream app wires it |

## Scope

This package:

- Wraps `y-websocket@^3` provider construction with status normalisation.
- Exposes runes helpers mirroring Yjs collection semantics as `$state`-backed proxies.
- Stays small — does not re-export Yjs types. Consumers import `yjs` directly for `Y.Doc` / `Y.Array` / `Y.Map`.

This package does **not**:

- Depend on `y-svelte` — pre-runes, stale.
- Route through TanStack Query — wrong tool for CRDT merge.
- Ship `y-indexeddb` or `y-webrtc` as hard deps — opt-in recipes live under `docs/compose/`.
- Own server — golusoris operates `y-websocket` upstream.

## Invariants

- **Lifecycle rune-scoped.** `createYjsStore` / `createYjsMap` / `createYjsText` subscribe via `observe()` inside `$effect`; unsubscribe via returned cleanup. Leaking subscription past component teardown = bug.
- **Mutations route through Y type, never proxy.** `store.push(x)` calls `yArray.push([x])`; exposed `items` array `readonly`.
- **Snapshots shallow.** Nested Y types exposed as-is; deep mutation still requires caller to invoke Y operations on inner type. Deep proxy semantics out of scope.
- **Transactions explicit.** Batched edits go through `transactYjs(doc, () => …)`; helper does not invent implicit transaction wrapper.
- **Presence reads via `'change'`, not `'update'`.** `observePresence` / `createPresenceStore` default to awareness `'change'` event -> listeners fire on real transitions, not every heartbeat. `'update'` opt-in via `{ event: 'update' }`.
- **`diffPresence` keys updates on reference identity.** Yjs replaces client state object on every change -> `prev.get(id) !== next.get(id)` = correct, allocation-free staleness check; no deep compare.
- **Presence mutations route through awareness.** `store.setLocal(x)` calls `awareness.setLocalState(x)`; `others` `readonly`.

## Test policy

- Unit: pure helpers against in-memory `Y.Doc`. No network; no real provider.
- Awareness helpers (`./awareness`) test against in-memory `FakeAwareness` implementing `AwarenessLike` — no `y-protocols` dependency at test time.
- Rune helpers (`*.svelte.ts`) exercised indirectly via pure helpers they compose.
- Direct rune runtime tests land once monorepo wires `vitest` + Svelte plugin harness.
- Provider tests use `WebSocketPolyfill` option with no-op socket to avoid real sockets.
- Coverage ≥ 85% on pure helpers.

## Common tasks

| Task       | Command                                        |
| ---------- | ---------------------------------------------- |
| Typecheck  | `pnpm --filter @sveltesentio/collab typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/collab test`      |

## Related

- [ADR-0009](../../docs/adr/0009-yjs-ywebsocket-framework-lock.md) — Yjs + `y-websocket` lock.
- [ADR-0039](../../docs/adr/0039-y-websocket-createYjsStore.md) — `createYjsStore` rune helper.
- [docs/compose/collab.md](../../docs/compose/collab.md) — full recipes (pending).
- [docs/compose/collab-persistence.md](../../docs/compose/collab-persistence.md) — `y-indexeddb` opt-in (pending).
- [docs/compose/collab-p2p.md](../../docs/compose/collab-p2p.md) — `y-webrtc` opt-in (pending).
