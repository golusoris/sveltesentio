# ADR-0037: Native `EventSource` + `useSSE()` rune; reject `sveltekit-sse` framework

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D70 + D73 in `.workingdir/research/decisions-needed.md`

## Context

Server-Sent Events is a browser-native transport (`EventSource`). The `sveltekit-sse` package proposes a framework layer around it; zero adopter apps use it, and it's absent from authoritative awesome-Svelte lists. Going native keeps the transport surface at the browser baseline.

Three streaming transports operate side by side in sveltesentio: SSE (read-only server → client), ConnectRPC server-streams (bi-di typed RPC, ADR-0038), Yjs over WebSocket (CRDT, ADR-0039). A unified "streaming" abstraction would leak the differing semantics. Separate hooks per transport.

## Decision

`@sveltesentio/realtime/sse` ships:

- `useSSE(url, { onMessage, onOpen, onError, auto = true })` — thin runes-native wrapper over `EventSource`.
- Lifecycle tied to `$effect` (opens on mount, closes on destroy).
- Reconnection with exponential backoff (native `EventSource` retries anyway; wrapper adds jitter + cap).
- `onMessage(event)` receives the raw `MessageEvent`; type-narrowing is consumer-side (e.g. via Zod).

No `useRealtime()` abstraction over SSE + ConnectRPC + Yjs. Each transport has its own hook.

## Alternatives considered

- **`sveltekit-sse`** — 0/4 adoption, not in awesome-lists; framework layer over a 15-line wrapper.
- **Unified `useRealtime` abstraction** — three different semantics (one-way, bidi-typed, CRDT); leaks.
- **Hand-roll per consumer** — sveltesentio apps would all re-implement the same backoff + lifecycle.

## Consequences

**Positive**:
- Browser-native transport; no polyfill, no framework layer to maintain.
- Runes lifecycle is correct by construction (auto-close on component destroy).
- Three transport hooks each stay honest about their semantics.

**Negative / trade-offs**:
- Safari's `EventSource` connection limit (6 per origin) applies; documented escape hatches (HTTP/2, or swap to WebSocket) live in `docs/compose/realtime-limits.md`.
- No automatic reconnection-with-sequence-resume; consumers can layer on `Last-Event-ID`.

**Documentation obligations**:
- `docs/compose/sse.md` — `useSSE` recipes, backoff config, `Last-Event-ID` pattern.
- `@sveltesentio/realtime` AGENTS.md — three-transport split with rationale.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:81,84` — D70 + D73 picks.
- `.workingdir/research/ecosystem-batch-c.md` — `sveltekit-sse` adoption survey + awesome-list check.
