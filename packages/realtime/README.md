# @sveltesentio/realtime

> SSE + WebSocket + ConnectRPC transport adapters for SvelteKit

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

✅ v0.2.0 — `SseClient`, `computeBackoff`, `createBufferedEmitter`, the
`useSSE()` rune, and the ConnectRPC server-streaming half
(`createConnectStream` + `useConnectStream()`) have shipped. Yjs WebSocket
lives in [`@sveltesentio/collab`](../collab).

## Sub-exports

| Import                                      | What                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `@sveltesentio/realtime/sse`                | `SseClient` — native `EventSource` wrapper + auto-reconnect                  |
| `@sveltesentio/realtime/backoff`            | `computeBackoff` — jittered exponential backoff                              |
| `@sveltesentio/realtime/buffered-emitter`   | `createBufferedEmitter` — throttled batch emitter                            |
| `@sveltesentio/realtime/use-sse`            | `useSSE()` — Svelte 5 runes wrapper over `SseClient`                         |
| `@sveltesentio/realtime/connect-stream`     | `createConnectStream` — transport-agnostic server-streaming state machine    |
| `@sveltesentio/realtime/use-connect-stream` | `useConnectStream()` — Svelte 5 runes wrapper over `createConnectStream`     |
| `@sveltesentio/realtime/rpc`                | `createClient` + `connectErrorToProblem` — curated ConnectRPC client surface |

## Installation

```bash
pnpm add @sveltesentio/realtime
```

See the [monorepo README](../../README.md) and [`docs/`](../../docs/) for design principles and usage.

## License

MIT © lusoris
