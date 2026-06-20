# ADR-0009: Yjs + `y-websocket` as `@sveltesentio/collab` core

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D80 in `.workingdir/research/decisions-needed.md`

## Context

Only subdo ships collaborative editing today and uses `yjs@13.6.30` + `y-websocket@3.0.0` to sync a flow-graph Y.Doc over `/collab/{flowId}`. No `y-indexeddb` (offline missing); no `Y.UndoManager` (full-snapshot undo in `flow/history.ts`). Loro is a rising-star Rust-native CRDT that may beat Yjs on bundle + ops/sec but has no downstream adopter.

## Decision

Adopt `yjs@^13.6` + `y-websocket@^3` as the CRDT + transport for `@sveltesentio/collab`. `y-indexeddb` and `Y.UndoManager` are **not** bundled by default; expose them as first-class extension points on the module so apps opt in when they need offline / undo. A Loro benchmark pass remains a future option before any swap.

## Alternatives considered

- **Loro** — no adopter, no benchmark evidence yet; holding as future re-audit.
- **Automerge** — different model (no Svelte binding momentum); no convergence case.
- **Liveblocks** — hosted-only; subdo self-hosts.
- **`y-webrtc`** — peer-to-peer only; subdo's deployment is server-mediated WS.
- **`y-svelte` binding** — subdo hand-rolls `observe` + transact; no binding picked up. Custom sync stays app-facing via examples.

## Consequences

**Positive**:

- Matches subdo's shipped stack bit-for-bit; zero migration.
- `y-indexeddb` + `Y.UndoManager` as extension points future-proofs offline + undo without forcing them on non-needing apps.
- Room for Loro re-audit without locking apps into today's choice.

**Negative / trade-offs**:

- Single-adopter evidence (subdo only).
- Yjs bundle is non-trivial (~80KB gzipped core + provider).
- No default `y-svelte` binding — consumers hand-roll `observe` (evidence: subdo already does).

**Documentation obligations**:

- `docs/compose/collab.md` — Y.Doc lifecycle, awareness, transact patterns, opt-in `y-indexeddb` + `UndoManager` recipes.
- Loro benchmark tracker in `.workingdir/` for future re-audit.

## Evidence

- `.workingdir/research/deepread-subdo.md:13-14,45-51,147-149` — Yjs + y-websocket wired at `src/lib/collab.ts:19-27`, `connect: false` dev stub, awareness `{ name, color }`, no y-indexeddb.
- `.workingdir/research/deepread-subdo.md:86-91` — full-snapshot undo (not `Y.UndoManager`) in `flow/history.ts:1-83`.
- `.workingdir/research/decisions-needed.md:223` — convergence row: "Yjs CRDT + y-websocket" (subdo 1/4 only).
- `.workingdir/research/decisions-needed.md:266-267` — "No y-indexeddb / no Yjs UndoManager" — framework should decide whether to ship both as first-class extensions.
- `.workingdir/research/decisions-needed.md:297` — user closure: "subdo-only adopter but evidence strong. Loro benchmark remains optional before ADR".
