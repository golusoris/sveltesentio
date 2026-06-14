# @sveltesentio/realtime

> SSE + WebSocket + ConnectRPC transport adapters for SvelteKit

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

✅ v0.0.1 — `SseClient`, `computeBackoff`, `createBufferedEmitter`, and the
`useSSE()` rune have shipped. ConnectRPC (`useConnectStream`) is follow-through.

## Sub-exports

| Import | What |
|---|---|
| `@sveltesentio/realtime/sse` | `SseClient` — native `EventSource` wrapper + auto-reconnect |
| `@sveltesentio/realtime/backoff` | `computeBackoff` — jittered exponential backoff |
| `@sveltesentio/realtime/buffered-emitter` | `createBufferedEmitter` — throttled batch emitter |
| `@sveltesentio/realtime/use-sse` | `useSSE()` — Svelte 5 runes wrapper over `SseClient` |

## Installation

```bash
pnpm add @sveltesentio/realtime
```

See the [monorepo README](../../README.md) and [`docs/`](../../docs/) for design principles and usage.

## License

MIT © lusoris
