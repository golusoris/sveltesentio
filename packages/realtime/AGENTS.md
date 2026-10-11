# @sveltesentio/realtime — AGENTS.md

> SSE + ConnectRPC streaming + WebSocket (Yjs) transports, each separate hook. No unified "realtime" abstraction. Phase 8 per `.workingdir/PLAN.md`.

## Scope

Three transports, three hooks — unifying abstraction rejected as leaky (D73 locked, [ADR-0037](../../docs/adr/0037-sse-native-useSSE.md) / [ADR-0038](../../docs/adr/0038-connectrpc-connect-web-connect-query.md)).

### Landed (v0.0.1)

| Export                                            | Purpose                                                                                                                                                                                                                                      | ADR                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `SseClient` class                                 | Native `EventSource` wrapper + auto-reconnect; accepts injected `eventSourceFactory` (for tests / non-browser runtimes) + `setTimeoutImpl` hooks; tracks `attempt` + emits `onStateChange` for `idle \| connecting \| open \| closed`        | [ADR-0037](../../docs/adr/0037-sse-native-useSSE.md) |
| `computeBackoff(attempt, options?)`               | Exponential backoff with symmetric jitter, capped at `maxMs`; rejects invalid jitter bounds; accepts injectable `random()` for deterministic tests                                                                                           | ADR-0037                                             |
| `createBufferedEmitter<T>({ bufferMs, onFlush })` | Throttles `$state` updates so 10k-msg/s feeds do not thrash render loop (per AGENTS.md invariant); `flush()` drains synchronously; `stop()` drops pending                                                                                    | ADR-0037                                             |
| `useSSE()` rune (`./use-sse`)                     | Runes wrapper over `SseClient`; reactive `state` / `lastMessage` / `messages` / `error` / `attempt` / `connected`; optional `bufferMs` backpressure via `createBufferedEmitter`; ties connect/close to caller `$effect` lifecycle (SSR-safe) | [ADR-0037](../../docs/adr/0037-sse-native-useSSE.md) |

### Landed (v0.2.0)

| Export                                                                | Purpose                                                                                                                                                                                                                                                                                                                                                          | ADR                                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `createConnectStream({ call, onMessage, backoff?, setTimeoutImpl? })` | Transport-agnostic server-streaming state machine; consumes **injected** async-iterable `call(signal)`, exposes `idle \| streaming \| closed` + `attempt`, reconnects with shared `computeBackoff`; natural iterator completion is terminal `closed`, only thrown errors trigger backoff; holds no ConnectRPC / Svelte imports -> unit-tests against fake stream | [ADR-0038](../../docs/adr/0038-connectrpc-connect-web-connect-query.md) |
| `useConnectStream()` rune (`./use-connect-stream`)                    | Runes wrapper over `createConnectStream`; reactive `state` / `lastMessage` / `messages` / `error` / `attempt` / `streaming`; optional `bufferMs` backpressure; ties start/stop to caller `$effect` (SSR-safe); transport injected via `call`, wrapper imports neither `@connectrpc/connect` nor `@connectrpc/connect-web` at module-eval                         | [ADR-0038](../../docs/adr/0038-connectrpc-connect-web-connect-query.md) |

### Follow-through (not yet shipped)

| Hook     | Transport                                                 | ADR                                                           |
| -------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| (Yjs WS) | `y-websocket` — lives in `@sveltesentio/collab`, not here | [ADR-0039](../../docs/adr/0039-y-websocket-createYjsStore.md) |

### Rejected

- **`sveltekit-sse`** — 0/4 downstream adoption, absent from awesome-lists, adds dependency for native `EventSource` capability (D70 locked).
- **Unified `useRealtime()`** — every abstraction sketched leaked underlying transport error / reconnect / backpressure semantics. Keep separate.

## Invariants

- **SSE reconnect exponential with jitter** — fixed delay causes thundering-herd on backend restart. Default: `min=1s, max=30s, jitter=0.3`.
- **ConnectRPC errors surface as `ConnectError`** — do **not** map onto RFC 9457 `ProblemError`. Different error model; different code paths.
- **No wrapping `fetch` to emulate streaming.** Use `EventSource` (SSE) or ConnectRPC streaming client. Hand-rolled SSE parsing antipattern.
- **Backpressure explicit.** Every `useSSE` / `useConnectStream` has `bufferMs` prop throttling `$state` updates -> 10k-msg/s feeds do not thrash render loop.

## Sub-exports

| Path                                        | Purpose                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@sveltesentio/realtime`                    | Everything above (non-`.svelte`)                                                                                                                             |
| `@sveltesentio/realtime/sse`                | `SseClient` + types                                                                                                                                          |
| `@sveltesentio/realtime/backoff`            | `computeBackoff` + `BackoffOptions` (zero-dep pull)                                                                                                          |
| `@sveltesentio/realtime/buffered-emitter`   | `createBufferedEmitter` alone                                                                                                                                |
| `@sveltesentio/realtime/use-sse`            | `useSSE()` rune                                                                                                                                              |
| `@sveltesentio/realtime/connect-stream`     | `createConnectStream` + types (zero optional-peer pull)                                                                                                      |
| `@sveltesentio/realtime/use-connect-stream` | `useConnectStream()` rune                                                                                                                                    |
| `@sveltesentio/realtime/rpc`                | `createClient` + `connectErrorToProblem` — ConnectRPC client surface (typed client factory + `ConnectError`→`ProblemError` mapping) composed by query bridge |

## Test policy

- `SseClient` unit tests inject `FakeEventSource` via `eventSourceFactory` — no mocking native browser impl. 16 tests cover: connect/open transition, message normalisation, exponential reconnect, attempt-counter reset on successful open, `close()` stops reconnects, missing-global-EventSource error path.
- `createConnectStream` unit tests inject manually-driven fake async iterable via `call` seam — no network / grpc. 6 tests cover: open -> message -> close (natural completion), error -> backoff -> reconnect, attempt reset after message, `stop()` cancels active stream + pending reconnect, messages after `stop()` ignored, aborted-stream throw does not reconnect.
- `.svelte.ts` wrapper (`useConnectStream`) untested at unit layer (runes need Svelte plugin); logic delegated to tested `createConnectStream`. Wrapper must `tsc`/`lint` clean.
- Reconnect + backoff timing verified with fake timers (Vitest `vi.useFakeTimers()` + `advanceTimersByTimeAsync`).

## Common tasks

| Task       | Command                                          |
| ---------- | ------------------------------------------------ |
| Typecheck  | `pnpm --filter @sveltesentio/realtime typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/realtime test`      |

## Related ADRs

- [ADR-0037](../../docs/adr/0037-sse-native-useSSE.md) — native EventSource + `useSSE`; reject `sveltekit-sse`.
- [ADR-0038](../../docs/adr/0038-connectrpc-connect-web-connect-query.md) — ConnectRPC transport + `@connectrpc/connect-query`.
- [ADR-0039](../../docs/adr/0039-y-websocket-createYjsStore.md) — Yjs WS stays in `@sveltesentio/collab`.
