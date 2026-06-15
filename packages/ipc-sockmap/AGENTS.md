# @sveltesentio/ipc-sockmap — AGENTS.md

> Colocated-IPC ladder for SvelteKit ↔ Golusoris. See [ADR-0051](../../docs/adr/0051-colocated-ipc-ladder-ebpf-sockmap.md).

## Scope

Node-side, server-only (`node:net` / `node:fs`), Linux-focused. Implements the **unblocked** rungs of the ADR-0051 ladder so the package is useful today and degrades cleanly:

- **`src/transport.ts`** — pure, seam-based, dependency-free.
  - Length-prefixed framing codec: 4-byte big-endian u32 header + payload. `encodeFrame`, `decodeFrame` (whole buffer), and a streaming `FrameDecoder` that handles partial reads and multiple frames per chunk. Guards against lengths over `MAX_FRAME_BYTES` (64 MiB).
  - `detectTransport({ socketPath, bpfMapPath?, access? })` — probes (via an **injected** `fs.access`-like fn) which tier is available: `'sockmap'` if the pinned BPF sockhash exists (Tier 3), else `'af_unix'` if the socket exists (Tier 1), else `'none'`. Never throws.
- **`src/client.ts`** — `createIpcClient({ socketPath, bpfMapPath?, connect?, access?, requestTimeoutMs? })`.
  - Tier-1 AF_UNIX client over `node:net`, with an **injected** connect factory (default `node:net.createConnection`) so it unit-tests against a fake socket.
  - Typed `request(payload) -> Promise<payload>` using the framing; FIFO request/response matching; optional per-request timeout.
  - Exposes the resolved `tier`. Throws RFC 9457 `ProblemError` (`@sveltesentio/core`) on no-transport, connect, transport, framing, timeout, and post-close failures.

## Status

- **LANDED (v0.1.0):** Tier 1 client + framing codec + ladder detection.
- **PENDING:** Tier 3 (eBPF SK_MSG sockhash) kernel-bypass registration is golusoris-side, blocked on [golusoris/golusoris#27](https://github.com/golusoris/golusoris/issues/27). `detectTransport` already reports `'sockmap'` when the map is pinned; acceleration is transparent (kernel-side) — **no client code change**. Tier-3 selection here is detection-only.

## Why detection-only for Tier 3

Kernel bypass requires CAP_BPF and a kernel-side SK_MSG program attached to the cgroup v2 hierarchy. That is impossible from userspace Node and belongs to golusoris's `pkg/sockmap` (golusoris#27). This package therefore *detects* the pinned map and lets the kernel do the redirect transparently over the AF_UNIX socket buffers the client already uses.

## Seams (injectables — keep these for testability)

| Seam | Default | Why |
|---|---|---|
| `connect` (`ConnectFn`) | `node:net.createConnection` | Fake socket in tests; no real network. |
| `access` (`AccessFn`) | `node:fs/promises` `access` | Probe all three tiers without touching the filesystem. |

`node:net` / `node:fs/promises` are loaded via dynamic `import()` only when the corresponding default is needed, so the pure modules stay importable in any environment.

## Golusoris contract (Tier 3, pending #27)

Golusoris's opt-in `fx.Module("ipc.sockmap")` must:

1. Pin the sockhash at `/sys/fs/bpf/golusoris/sockhash` (cgroup-scoped, mode 0660, group `sockmap`).
2. Support systemd socket activation so a supervisor can pre-create listen FDs.
3. Attach the `SOCK_OPS` / `SK_MSG` program to the process's cgroup v2 path.
4. Honour a pre-shutdown hook that invalidates its FD in the sockhash before closing.

Until then the client runs Tier 1 — safe, no crash.

## Tests

`test/` (vitest, node env). Run from the package dir.

- `framing.test.ts` — encode/decode round-trips, multi-frame chunks, partial reads (payload split, header split), empty payloads, over-max length rejection, `reset()`.
- `detect-transport.test.ts` — all three tiers via injected `access`; Tier-3-over-Tier-1 precedence; map not probed when `bpfMapPath` omitted.
- `client.test.ts` — fake socket: connect, tier resolution (`af_unix` / `sockmap`), framed request/response, FIFO ordering, split-response reassembly, error/close/timeout/malformed-frame → `ProblemError`, post-close rejection.

Privileged integration tests (Docker `--privileged` + `bpffs`) for the Tier-3 kernel path land alongside golusoris#27.

## Common tasks

| Task | Command (from package dir) |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/ipc-sockmap typecheck` |
| Lint | `pnpm --filter @sveltesentio/ipc-sockmap lint` |
| Unit tests | `pnpm --filter @sveltesentio/ipc-sockmap test` |

## Related

- [ADR-0051](../../docs/adr/0051-colocated-ipc-ladder-ebpf-sockmap.md) — the three-tier ladder.
- [docs/compose/colocated-ipc.md](../../docs/compose/colocated-ipc.md) — Tier 1 + 2 recipes.
- [golusoris/golusoris#27](https://github.com/golusoris/golusoris/issues/27) — golusoris-side Tier-3 work.
