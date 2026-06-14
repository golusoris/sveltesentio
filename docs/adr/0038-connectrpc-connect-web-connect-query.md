# ADR-0038: ConnectRPC — `@connectrpc/connect-web` + `@bufbuild/protobuf` + `@connectrpc/connect-query`

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D71 + D72 in `.workingdir/research/decisions-needed.md`

## Context

Golusoris exposes typed RPC via ConnectRPC (Buf ecosystem). subdo already hits these APIs with raw `fetch` + manual JSON decode — loses type safety and error shape. The canonical client stack is `@connectrpc/connect-web` (transport) + `@bufbuild/protobuf` (wire format) + `@connectrpc/connect-query` (TanStack Query adapter). All three are Apache-2.0, actively maintained.

Related: D72 asks whether to adopt `partysocket` as a generic WebSocket wrapper. Zero adopter apps use it today, and Yjs already owns the WebSocket lane via `y-websocket`. Hold `partysocket` as a `docs/compose/websocket.md` opt-in only.

## Decision

- Pin `@connectrpc/connect-web@^2.1.1` + `@bufbuild/protobuf@^2.11.0` + `@connectrpc/connect-query@^2.2.0` inside `@sveltesentio/realtime/rpc`.
- Ship `createClient(service, { transport })` helper using `createPromiseClient` (not subdo's raw-fetch pattern).
- Server-stream helper: `useConnectStream(method, input)` — runes-native wrapper that iterates the async iterable + exposes `$state` updates.
- `docs/compose/websocket.md` covers `partysocket` as an opt-in pattern; no framework lock.

## Alternatives considered

- **gRPC-Web** — older transport; ConnectRPC is the Buf-canonical path with better DX.
- **Raw `fetch` + hand-maintained types (subdo's pattern)** — loses typed streaming semantics.
- **tRPC** — Node-only server; Golusoris is Go, not a fit.
- **`partysocket` as framework default** — zero adoption today; no cross-cutting value over Yjs's WS + SSE.

## Consequences

**Positive**:
- 1:1 typed RPC against Golusoris via Buf codegen.
- TanStack Query integration via `connect-query` — no parallel query layer.
- Server streams + bidi wrapped runes-natively in the same package as SSE + Yjs.

**Negative / trade-offs**:
- Buf ecosystem pin — majors require ADR amendment.
- subdo migrates from raw-fetch to `createPromiseClient` (mechanical change, types drive it).
- ConnectRPC on browsers requires HTTP/2 or dedicated transport config for bidi streams.

**Documentation obligations**:
- `docs/compose/connectrpc.md` — Buf codegen pipeline, transport configuration, streaming patterns.
- `@sveltesentio/realtime/rpc` AGENTS.md — pinned matrix + subdo migration.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:82-84` — D71 + D72 + D73 picks.
- `.workingdir/research/deepread-subdo.md` — raw-fetch pattern location.
- Registry pins verified 2026-04-17.
