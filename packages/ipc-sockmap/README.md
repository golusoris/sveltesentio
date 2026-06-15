# @sveltesentio/ipc-sockmap

> Colocated-IPC client for SvelteKit (Node) ↔ Golusoris (Go): AF_UNIX Tier 1, length-prefixed message framing, and the transport-ladder detection model from [ADR-0051](../../docs/adr/0051-colocated-ipc-ladder-ebpf-sockmap.md).

Part of the [sveltesentio](https://github.com/lusoris/sveltesentio) composable SvelteKit framework. Node + Linux, server-only.

## Status

**LANDED (v0.1.0):**

- Tier 1 — AF_UNIX client (`createIpcClient`) over `node:net`, with an injectable connect factory.
- Length-prefixed framing codec (`encodeFrame` / `decodeFrame` / `FrameDecoder`) — handles partial reads and multiple frames per chunk.
- Transport-ladder detection (`detectTransport`) — probes the pinned BPF map first (Tier 3), then the socket (Tier 1), else `none`.

**PENDING (Tier 3 — eBPF SK_MSG kernel-bypass):** blocked on [golusoris/golusoris#27](https://github.com/golusoris/golusoris/issues/27), which must pin the `BPF_MAP_TYPE_SOCKHASH` at `/sys/fs/bpf/golusoris/sockhash`. Acceleration is **transparent and kernel-side**: once golusoris pins the map, the SK_MSG hook redirects the same socket buffers without TCP-stack traversal — **no client code change**. `detectTransport` already reports `'sockmap'` when the map is present, so the client surfaces the resolved tier today.

See also [docs/compose/colocated-ipc.md](../../docs/compose/colocated-ipc.md).

## The ladder

| Tier | Mechanism | Cost | This package |
|---|---|---|---|
| 1 | AF_UNIX socket | Trivial | `createIpcClient` (LANDED) |
| 2 | Cilium `socketLB` | Cluster config | None — transparent |
| 3 | Custom eBPF SK_MSG sockhash | CAP_BPF + kernel ≥5.10 | Detection LANDED; kernel-bypass pending golusoris#27 |

**Start at Tier 1.** Climb only when measurement proves loopback TCP traversal is your bottleneck.

## Usage

```ts
// src/lib/server/golusoris-ipc.ts
import { createIpcClient } from '@sveltesentio/ipc-sockmap';

const client = await createIpcClient({
	socketPath: '/run/golusoris/api.sock',
	bpfMapPath: '/sys/fs/bpf/golusoris/sockhash', // Tier-3 detection (optional)
	requestTimeoutMs: 5_000,
});

console.warn('[ipc] resolved tier:', client.tier); // 'af_unix' | 'sockmap'

const response = await client.request(new TextEncoder().encode('ping'));
// ... close when the server shuts down
client.close();
```

The connect factory and the `fs.access`-like probe are both injectable, so the client and detection unit-test without touching the network or filesystem.

### Just the framing codec

```ts
import { encodeFrame, FrameDecoder } from '@sveltesentio/ipc-sockmap/transport';

const decoder = new FrameDecoder();
for (const chunk of stream) {
	const { frames } = decoder.push(chunk); // drains every complete frame
	for (const payload of frames) handle(payload);
}
```

## Exports

| Subpath | Surface |
|---|---|
| `.` | Everything below, re-exported. |
| `./transport` | `encodeFrame`, `decodeFrame`, `FrameDecoder`, `detectTransport`, framing constants, `IpcTier`. |
| `./client` | `createIpcClient`, `IpcClient`, `IpcClientOptions`, `SocketLike`, `ConnectFn`. |

## Errors

Transport, connect, framing, and timeout failures throw RFC 9457 [`ProblemError`](../core/src/problem.ts) from `@sveltesentio/core`.

## Installation

```bash
pnpm add @sveltesentio/ipc-sockmap
```

## License

MIT © lusoris
