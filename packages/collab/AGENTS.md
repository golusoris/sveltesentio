# @sveltesentio/collab — AGENTS.md

> Yjs CRDT collaboration. Locked through [ADR-0009](../../docs/adr/0009-yjs-ywebsocket-framework-lock.md) + [ADR-0039](../../docs/adr/0039-y-websocket-createYjsStore.md).

## Landed (v0.2.0)

| Sub-export | Contents |
|---|---|
| `.` | Barrel re-export of everything below |
| `./array` | `snapshotYjsArray` / `observeYjsArray` / `appendToYjsArray` / `insertIntoYjsArray` / `deleteFromYjsArray` / `transactYjs` — pure helpers over `Y.Array<T>` |
| `./map` | `snapshotYjsMap` / `snapshotYjsMapEntries` / `observeYjsMap` / `setYjsMap` / `deleteYjsMap` / `clearYjsMap` — pure helpers over `Y.Map<V>` |
| `./text` | `snapshotYjsText` / `observeYjsText` / `insertYjsText` / `deleteYjsText` / `appendYjsText` — pure helpers over `Y.Text` |
| `./provider` | `connectProvider({url, room, doc, ...})` — `y-websocket@^3` factory with status normalisation + `onStatusChange` / `onSync` callbacks; returns `{provider, disconnect}` |
| `./store` | `createYjsStore<T>(yArray)` — `$state`-backed rune wrapper for `Y.Array<T>` |
| `./map-store` | `createYjsMap<V>(yMap)` — `$state`-backed rune wrapper for `Y.Map<V>` |
| `./text-store` | `createYjsText(yText)` — `$state`-backed rune wrapper for `Y.Text` |
| `./awareness` | `setLocalPresence` / `patchLocalPresence` / `snapshotPresence` / `snapshotOthers` / `observePresence` / `diffPresence` — pure helpers over a structural `AwarenessLike` (no hard `y-protocols` import) |
| `./presence-store` | `createPresenceStore<S>(awareness, opts?)` — `$state`-backed rune wrapper exposing reactive `others` / `count` / `local` + `setLocal` / `patchLocal` |

Ships with ambient rune declarations (`src/runes-ambient.d.ts`) so plain `tsc --noEmit` can typecheck `.svelte.ts` files inside the package until the monorepo adopts `svelte-check` globally.

`y-protocols` is an **optional** peer (`peerDependenciesMeta.y-protocols.optional`). The awareness helpers type against a structural `AwarenessLike` (`clientID` / `getStates` / `getLocalState` / `setLocalState` / `on` / `off`), so they need no hard import and unit-test against a fake awareness.

## Follow-through

| Task | Why deferred |
|---|---|
| `y-indexeddb` compose recipe (`docs/compose/collab-persistence.md`) | Opt-in per ADR-0009; not shipped as hard dep |
| `y-webrtc` compose recipe (`docs/compose/collab-p2p.md`) | Opt-in per ADR-0009; not shipped as hard dep |
| Convergence tests (two `Y.Doc` + fake WebSocket pair) | Needs a shared test harness; tracked with the broader integration-test phase |
| Auth-header binding on provider construction | Needs the session-cookie handoff pattern from `@sveltesentio/auth` — revisit when a downstream app wires it |

## Scope

This package:

- Wraps `y-websocket@^3` provider construction with status normalisation.
- Exposes runes helpers that mirror Yjs collection semantics as `$state`-backed proxies.
- Stays small — does not re-export Yjs types. Consumers import `yjs` directly for `Y.Doc` / `Y.Array` / `Y.Map`.

This package does **not**:

- Depend on `y-svelte` — pre-runes, stale.
- Route through TanStack Query — wrong tool for CRDT merge.
- Ship `y-indexeddb` or `y-webrtc` as hard deps — opt-in recipes live under `docs/compose/`.
- Own the server — golusoris operates the `y-websocket` upstream.

## Invariants

- **Lifecycle is rune-scoped.** `createYjsStore` / `createYjsMap` / `createYjsText` subscribe via `observe()` inside `$effect` and unsubscribe via the returned cleanup. Leaking a subscription past component teardown is a bug.
- **Mutations route through the Y type, never the proxy.** `store.push(x)` calls `yArray.push([x])`; the exposed `items` array is `readonly`.
- **Snapshots are shallow.** Nested Y types are exposed as-is; deep mutation still requires the caller to invoke Y operations on the inner type. Deep proxy semantics are out of scope.
- **Transactions are explicit.** Batched edits go through `transactYjs(doc, () => …)`; the helper does not invent an implicit transaction wrapper.
- **Presence reads via `'change'`, not `'update'`.** `observePresence` / `createPresenceStore` default to the awareness `'change'` event so listeners fire on real transitions, not every heartbeat. `'update'` is opt-in via `{ event: 'update' }`.
- **`diffPresence` keys updates on reference identity.** Yjs replaces a client's state object on every change, so `prev.get(id) !== next.get(id)` is a correct, allocation-free staleness check — no deep compare.
- **Presence mutations route through the awareness.** `store.setLocal(x)` calls `awareness.setLocalState(x)`; `others` is `readonly`.

## Test policy

- Unit: pure helpers against an in-memory `Y.Doc`. No network; no real provider. Awareness helpers (`./awareness`) test against an in-memory `FakeAwareness` implementing `AwarenessLike` — no `y-protocols` dependency at test time. Rune helpers (`*.svelte.ts`) are exercised indirectly via the pure helpers they compose; direct rune runtime tests land once the monorepo wires up the `vitest` + Svelte plugin harness.
- Provider tests use the `WebSocketPolyfill` option with a no-op socket to avoid real sockets.
- Coverage ≥ 85% on pure helpers.

## Common tasks

| Task | Command |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/collab typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/collab test` |

## Related

- [ADR-0009](../../docs/adr/0009-yjs-ywebsocket-framework-lock.md) — Yjs + `y-websocket` lock.
- [ADR-0039](../../docs/adr/0039-y-websocket-createYjsStore.md) — `createYjsStore` rune helper.
- [docs/compose/collab.md](../../docs/compose/collab.md) — full recipes (pending).
- [docs/compose/collab-persistence.md](../../docs/compose/collab-persistence.md) — `y-indexeddb` opt-in (pending).
- [docs/compose/collab-p2p.md](../../docs/compose/collab-p2p.md) — `y-webrtc` opt-in (pending).
