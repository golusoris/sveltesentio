# @sveltesentio/realtime — AGENTS.md

> SSE + ConnectRPC streaming + WebSocket (Yjs) transports, each as a separate hook. No unified "realtime" abstraction. Phase 8 per [.workingdir/PLAN.md](../../.workingdir/PLAN.md).

## Scope

Three transports, three hooks — the unifying abstraction was rejected as leaky (D73 locked, [ADR-0037](../../docs/adr/0037-sse-native-useSSE.md) / [ADR-0038](../../docs/adr/0038-connectrpc-connect-web-connect-query.md)).

### Landed (v0.0.1)

| Export | Purpose | ADR |
|---|---|---|
| `SseClient` class | Native `EventSource` wrapper + auto-reconnect; accepts an injected `eventSourceFactory` (for tests / non-browser runtimes) + `setTimeoutImpl` hooks; tracks `attempt` + emits `onStateChange` for `idle \| connecting \| open \| closed` | [ADR-0037](../../docs/adr/0037-sse-native-useSSE.md) |
| `computeBackoff(attempt, options?)` | Exponential backoff with symmetric jitter, capped at `maxMs`; rejects invalid jitter bounds; accepts injectable `random()` for deterministic tests | ADR-0037 |
| `createBufferedEmitter<T>({ bufferMs, onFlush })` | Throttles `$state` updates so 10k-msg/s feeds don't thrash the render loop (per AGENTS.md invariant); `flush()` drains synchronously; `stop()` drops pending | ADR-0037 |
| `useSSE()` rune (`./use-sse`) | Runes wrapper over `SseClient`; reactive `state` / `lastMessage` / `messages` / `error` / `attempt` / `connected`; optional `bufferMs` backpressure via `createBufferedEmitter`; ties connect/close to the caller's `$effect` lifecycle (SSR-safe) | [ADR-0037](../../docs/adr/0037-sse-native-useSSE.md) |

### Follow-through (not in v0.0.1)

| Hook | Transport | ADR |
|---|---|---|
| `useConnectStream()` | ConnectRPC server-streaming via `@connectrpc/connect-web@2.1.1` + `@bufbuild/protobuf@2.11.0` | [ADR-0038](../../docs/adr/0038-connectrpc-connect-web-connect-query.md) |
| (Yjs WS) | `y-websocket` — lives in `@sveltesentio/collab`, not here | [ADR-0039](../../docs/adr/0039-y-websocket-createYjsStore.md) |

### Rejected

- **`sveltekit-sse`** — 0/4 downstream adoption, absent from awesome-lists, adds a dependency for what `EventSource` does natively (D70 locked).
- **Unified `useRealtime()`** — every abstraction we sketched leaked the underlying transport's error / reconnect / backpressure semantics. Keep them separate.

## Invariants

- **SSE reconnect is exponential with jitter** — fixed delay causes thundering-herd on backend restart. Default: `min=1s, max=30s, jitter=0.3`.
- **ConnectRPC errors surface as `ConnectError`** — do **not** try to map them onto RFC 9457 `ProblemError`. Different error model; different code paths.
- **No wrapping `fetch` to emulate streaming.** Use `EventSource` (SSE) or ConnectRPC's streaming client. Hand-rolled SSE parsing is an antipattern.
- **Backpressure is explicit.** Every `useSSE` / `useConnectStream` has a `bufferMs` prop that throttles `$state` updates so 10k-msg/s feeds don't thrash the render loop.

## Sub-exports

| Path | Purpose |
|---|---|
| `@sveltesentio/realtime` | Everything above |
| `@sveltesentio/realtime/sse` | `SseClient` + types |
| `@sveltesentio/realtime/backoff` | `computeBackoff` + `BackoffOptions` (zero-dep pull) |
| `@sveltesentio/realtime/buffered-emitter` | `createBufferedEmitter` alone |

## Test policy

- `SseClient` unit tests inject a `FakeEventSource` via `eventSourceFactory` — no mocking of the native browser impl. 16 tests landed covering: connect/open transition, message normalisation, exponential reconnect, attempt-counter reset on successful open, `close()` stops reconnects, missing-global-EventSource error path.
- ConnectRPC tests hit a Buf fixture server (follow-through).
- Reconnect + backoff timing verified with fake timers (Vitest `vi.useFakeTimers()`).

## Common tasks

| Task | Command |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/realtime typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/realtime test` |

## Related ADRs

- [ADR-0037](../../docs/adr/0037-sse-native-useSSE.md) — native EventSource + `useSSE`; reject `sveltekit-sse`.
- [ADR-0038](../../docs/adr/0038-connectrpc-connect-web-connect-query.md) — ConnectRPC transport + `@connectrpc/connect-query`.
- [ADR-0039](../../docs/adr/0039-y-websocket-createYjsStore.md) — Yjs WS stays in `@sveltesentio/collab`.
