# ADR-0039: `y-websocket` default + custom `createYjsStore<T>` rune helper; no `y-svelte`

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D81 + D82 in `.workingdir/research/decisions-needed.md`

## Context

Yjs + `y-websocket` are already locked (ADR-0009). Open question: how do components consume Yjs types (`Y.Array`, `Y.Map`, `Y.Text`) idiomatically under Svelte 5 runes? subdo implements the pattern hand-rolled: `observe()` + `toArray()` + manual `$state` sync. The `y-svelte` binding package exists but is pre-runes (Svelte 4 stores) and stale. y-indexeddb and y-webrtc cover different lanes (offline persistence, p2p) — useful but orthogonal.

## Decision

- **Provider default**: `y-websocket@^3` inside `@sveltesentio/collab`. `y-indexeddb` and `y-webrtc` ship as `docs/compose/collab-persistence.md` + `docs/compose/collab-p2p.md` opt-ins, not framework locks.
- **Runes helper (shipped by `@sveltesentio/collab`)**: `createYjsStore<T>(yArray: Y.Array<T>)` and `createYjsMap<K,V>(yMap: Y.Map<V>)` — returns a `$state`-backed proxy that:
  - Subscribes via `observe()` on mount, unsubscribes on destroy (via `$effect`).
  - Exposes mutation methods (`push`, `set`, `delete`) that route through the Y type (not the proxy).
  - Snapshots the initial value via `.toArray()` / `.toJSON()`.
- Codifies subdo's pattern as framework infrastructure. Apps stop hand-rolling the subscribe/sync cycle.

No import of `y-svelte`.

## Alternatives considered

- **`y-svelte`** — pre-runes, stale; worse DX than writing the helper ourselves.
- **Leave hand-rolled per app (subdo pattern)** — every app re-implements the same observe + sync, bug by bug.
- **Route through TanStack Query** — wrong tool; Yjs is CRDT merge, not server-state fetch.

## Consequences

**Positive**:

- Idiomatic Svelte 5 consumption: `<ul>{#each list as item}</ul>` against a runes proxy.
- Single place to enforce correct subscribe/unsubscribe lifecycle.
- subdo's pattern becomes a one-liner.

**Negative / trade-offs**:

- Helper maintains a proxy surface around Yjs types; edge cases (deep mutation, transaction scope) need explicit API.
- Future Yjs majors may require proxy updates; pinned via ADR amendment.

**Documentation obligations**:

- `docs/compose/collab.md` — `createYjsStore` recipes + pitfalls (deep mutation, transactions).
- `docs/compose/collab-persistence.md` — `y-indexeddb` opt-in.
- `docs/compose/collab-p2p.md` — `y-webrtc` opt-in.
- `@sveltesentio/collab` AGENTS.md — helper contract + lifecycle semantics.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:85-86` — D81 + D82 picks.
- `.workingdir/research/deepread-subdo.md` — hand-rolled `observe()` + `toArray()` pattern location.
- ADR-0009 — Yjs + `y-websocket` framework lock.
