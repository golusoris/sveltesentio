# @sveltesentio/ipc-sockmap — AGENTS.md

> Colocated-IPC ladder for SvelteKit ↔ Golusoris. See [ADR-0051](../../docs/adr/0051-colocated-ipc-ladder-ebpf-sockmap.md).

## Scope

Node-side, server-only (`node:net` / `node:fs`), Linux-focused. Implements **unblocked** rungs of ADR-0051 ladder. Package useful today, degrades cleanly:

- **`src/transport.ts`** — pure, seam-based, dependency-free.
  - Length-prefixed framing codec: 4-byte big-endian u32 header + payload. `encodeFrame`, `decodeFrame` (whole buffer), streaming `FrameDecoder` handling partial reads + multiple frames per chunk. Guards against lengths over `MAX_FRAME_BYTES` (64 MiB).
  - `detectTransport({ socketPath, bpfMapPath?, access? })` — probes (via **injected** `fs.access`-like fn) available tier: `'sockmap'` if pinned BPF sockhash exists (Tier 3), else `'af_unix'` if socket exists (Tier 1), else `'none'`. Never throws.
- **`src/client.ts`** — `createIpcClient({ socketPath, bpfMapPath?, connect?, access?, requestTimeoutMs? })`.
  - Tier-1 AF_UNIX client over `node:net`, with **injected** connect factory (default `node:net.createConnection`) -> unit-tests against fake socket.
  - Typed `request(payload) -> Promise<payload>` via framing; FIFO request/response matching; optional per-request timeout.
  - Exposes resolved `tier`. Throws RFC 9457 `ProblemError` (`@sveltesentio/core`) on no-transport, connect, transport, framing, timeout, post-close failures.
- **`src/sockmap.ts`** — Tier-3 (eBPF SK_MSG sockhash) observe/handoff client. Pure + injectable; never writes BPF map (golusoris owns map).
  - `probeSockmap({ pinPath?, platform?, kernelRelease?, exists? })` — capability probe (Linux, kernel ≥5.10, cgroup v2 marker, pin present). Never throws; returns `{ available, pinPath, kernel }` or `{ available: false, degradeTo: 'af_unix', reason }`.
  - `activationListeners(env?, selfPid?)` — Node-side mirror of golusoris `sockmap.ActivationListeners`: parses `LISTEN_FDS`/`LISTEN_PID`/`LISTEN_FDNAMES`, returns inherited listener FDs (from `SD_LISTEN_FDS_START = 3`) for `server.listen({ fd })`. PID-guarded; throws `ProblemError` on malformed `LISTEN_FDS`.
  - `readSockmapStats({ pinPath?, countKeys, readMetrics? })` — `{ activeSockets, redirectedBytes?, redirectErrors? }`. `activeSockets` = sockhash key count (values kernel-only → iterate keys); byte/error totals come from golusoris Prometheus counters. Pure helpers `bpftoolKeyCount` + `parsePrometheusMetrics` feed injected readers.

## Status

- **LANDED (v0.1.0):** Tier 1 client + framing codec + ladder detection.
- **LANDED (Tier 3 observe client):** golusoris [#27](https://github.com/golusoris/golusoris/issues/27) shipped `pkg/sockmap` (golusoris PR #268). Package provides Node-side capability probe + systemd socket-activation handoff + key-count/Prometheus observability. Degrades to Tier 1 when pin absent. Redirect remains kernel-side + transparent — `detectTransport` selects tier for request client with **no per-request code change**.

## Why an observe/handoff client (not a writer)

Kernel bypass requires CAP_BPF + kernel-side SK_MSG program attached to cgroup v2 hierarchy. Userspace Node lacks `bpf()` syscall; sockhash `struct sock *` values cannot be copied to userspace (ENOSPC — iterate keys, not values). golusoris `pkg/sockmap` owns pinned map + all writes (`SOCK_OPS` program populates from kernel context; `RegisterConn` secondary Go-side path) + FD lifecycle (pre-shutdown cleanup). Package strictly **map client**: probes capability, performs unprivileged systemd FD handoff, reads observability. Kernel redirects transparently over socket buffers Tier-1 client already uses.

## Seams (injectables — keep these for testability)

| Seam                            | Default                             | Why                                                                      |
| ------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `connect` (`ConnectFn`)         | `node:net.createConnection`         | Fake socket in tests; no real network.                                   |
| `access` (`AccessFn`)           | `node:fs/promises` `access`         | Probe all three tiers without touching filesystem.                       |
| `exists` (`ExistsFn`)           | `node:fs/promises` `access` wrap    | `probeSockmap` checks cgroup/pin presence without real bpffs.            |
| `platform` / `kernelRelease`    | `process.platform` / `os.release()` | Drive probe host gate from tests.                                        |
| `countKeys` (`KeyCountReader`)  | — (caller supplies)                 | `readSockmapStats` reads sockhash key count via e.g. `bpftool map dump`. |
| `readMetrics` (`MetricsReader`) | — (optional)                        | Pull golusoris Prometheus `golusoris_sockmap_*` counters.                |

`node:net` / `node:fs/promises` loaded via dynamic `import()` only when corresponding default needed -> pure modules stay importable in any environment.

## Golusoris contract (Tier 3, shipped — #27 / golusoris PR #268 `pkg/sockmap`)

golusoris opt-in `sockmap.Module` (config prefix `sockmap`, `enabled = false` by default) provides:

1. Pinned `BPF_MAP_TYPE_SOCKHASH` at `/sys/fs/bpf/golusoris/sockhash` (config `pin_path`), keyed by connection 4-tuple (`struct sock_key`, 16 bytes). `SOCK_OPS` program populates from kernel context; `RegisterConn(conn)` inserts _established_ socket (listen sockets return EOPNOTSUPP).
2. Systemd socket activation (`sockmap.ActivationListeners` — `LISTEN_PID`/`LISTEN_FDS`/`LISTEN_FDNAMES`); package `activationListeners` = Node-side mirror.
3. `SOCK_OPS` / `SK_MSG` program attached to cgroup v2 hierarchy (`/sys/fs/cgroup`, marker `cgroup.controllers`; auto-detected from `/proc/self/cgroup`).
4. Pre-shutdown cleanup hook removing entries before sockets close -> map never redirects to destroyed socket.
5. Prometheus counters `golusoris_sockmap_{redirected_bytes_total,active_sockets,redirect_errors_total}` — package _reads_ (`METRIC_NAMES`), never emits.

When pin absent (non-Linux, cgroup v1, kernel <5.10, or `enabled = false`), `probeSockmap` degrades to `af_unix`, client runs Tier 1 — safe, no crash. Map layout + pin path part of contract; track golusoris BPF object version.

## Tests

`test/` (vitest, node env). Run from package dir.

- `framing.test.ts` — encode/decode round-trips, multi-frame chunks, partial reads (payload split, header split), empty payloads, over-max length rejection, `reset()`.
- `detect-transport.test.ts` — all three tiers via injected `access`; Tier-3-over-Tier-1 precedence; map not probed when `bpfMapPath` omitted.
- `client.test.ts` — fake socket: connect, tier resolution (`af_unix` / `sockmap`), framed request/response, FIFO ordering, split-response reassembly, error/close/timeout/malformed-frame → `ProblemError`, post-close rejection.
- `sockmap.test.ts` — injected host signals: `probeSockmap` all degrade paths + available; `activationListeners` PID guard / name fallback / malformed `LISTEN_FDS` → `ProblemError`; `parseKernelVersion` / `kernelAtLeast`; `bpftoolKeyCount` + `parsePrometheusMetrics` parsing; `readSockmapStats` with/without metrics.

Privileged integration tests (Docker `--privileged` + `bpffs` + loaded golusoris `pkg/sockmap`) for live kernel redirect run out-of-tree; in-tree suite drives every pure/injectable seam.

## Common tasks

| Task       | Command (from package dir)                          |
| ---------- | --------------------------------------------------- |
| Typecheck  | `pnpm --filter @sveltesentio/ipc-sockmap typecheck` |
| Lint       | `pnpm --filter @sveltesentio/ipc-sockmap lint`      |
| Unit tests | `pnpm --filter @sveltesentio/ipc-sockmap test`      |

## Related

- [ADR-0051](../../docs/adr/0051-colocated-ipc-ladder-ebpf-sockmap.md) — three-tier ladder.
- [docs/compose/colocated-ipc.md](../../docs/compose/colocated-ipc.md) — Tier 1 + 2 recipes.
- [golusoris/golusoris#27](https://github.com/golusoris/golusoris/issues/27) — golusoris-side Tier-3 work.
