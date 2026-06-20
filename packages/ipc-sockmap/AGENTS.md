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
- **`src/sockmap.ts`** — Tier-3 (eBPF SK_MSG sockhash) observe/handoff client. Pure + injectable; never writes the BPF map (golusoris owns it).
  - `probeSockmap({ pinPath?, platform?, kernelRelease?, exists? })` — capability probe (Linux, kernel ≥5.10, cgroup v2 marker, pin present). Never throws; returns `{ available, pinPath, kernel }` or `{ available: false, degradeTo: 'af_unix', reason }`.
  - `activationListeners(env?, selfPid?)` — Node-side mirror of golusoris `sockmap.ActivationListeners`: parses `LISTEN_FDS`/`LISTEN_PID`/`LISTEN_FDNAMES`, returns inherited listener FDs (from `SD_LISTEN_FDS_START = 3`) for `server.listen({ fd })`. PID-guarded; throws `ProblemError` on a malformed `LISTEN_FDS`.
  - `readSockmapStats({ pinPath?, countKeys, readMetrics? })` — `{ activeSockets, redirectedBytes?, redirectErrors? }`. `activeSockets` = sockhash key count (values are kernel-only → iterate keys); byte/error totals come from golusoris's Prometheus counters. Pure helpers `bpftoolKeyCount` + `parsePrometheusMetrics` feed the injected readers.

## Status

- **LANDED (v0.1.0):** Tier 1 client + framing codec + ladder detection.
- **LANDED (Tier 3 observe client):** golusoris [#27](https://github.com/golusoris/golusoris/issues/27) shipped `pkg/sockmap` (golusoris PR #268). This package now provides the Node-side capability probe + systemd socket-activation handoff + key-count/Prometheus observability, all degrading to Tier 1 when the pin is absent. The redirect itself remains kernel-side + transparent — `detectTransport` still selects the tier for the request client with **no per-request code change**.

## Why an observe/handoff client (not a writer)

Kernel bypass requires CAP_BPF and a kernel-side SK_MSG program attached to the cgroup v2 hierarchy; userspace Node has no `bpf()` syscall, and the sockhash's `struct sock *` values can't be copied to userspace (ENOSPC — iterate keys, not values). golusoris's `pkg/sockmap` owns the pinned map + all writes (the `SOCK_OPS` program populates it from kernel context; `RegisterConn` is a secondary Go-side path) and its FD lifecycle (pre-shutdown cleanup). This package is strictly a **map client**: it probes capability, performs the unprivileged systemd FD handoff, and reads observability — then lets the kernel redirect transparently over the socket buffers the Tier-1 client already uses.

## Seams (injectables — keep these for testability)

| Seam                            | Default                             | Why                                                                          |
| ------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| `connect` (`ConnectFn`)         | `node:net.createConnection`         | Fake socket in tests; no real network.                                       |
| `access` (`AccessFn`)           | `node:fs/promises` `access`         | Probe all three tiers without touching the filesystem.                       |
| `exists` (`ExistsFn`)           | `node:fs/promises` `access` wrap    | `probeSockmap` checks cgroup/pin presence without a real bpffs.              |
| `platform` / `kernelRelease`    | `process.platform` / `os.release()` | Drive the probe's host gate from tests.                                      |
| `countKeys` (`KeyCountReader`)  | — (caller supplies)                 | `readSockmapStats` reads the sockhash key count via e.g. `bpftool map dump`. |
| `readMetrics` (`MetricsReader`) | — (optional)                        | Pull golusoris's Prometheus `golusoris_sockmap_*` counters.                  |

`node:net` / `node:fs/promises` are loaded via dynamic `import()` only when the corresponding default is needed, so the pure modules stay importable in any environment.

## Golusoris contract (Tier 3, shipped — #27 / golusoris PR #268 `pkg/sockmap`)

golusoris's opt-in `sockmap.Module` (config prefix `sockmap`, `enabled = false` by default) provides:

1. The pinned `BPF_MAP_TYPE_SOCKHASH` at `/sys/fs/bpf/golusoris/sockhash` (config `pin_path`), keyed by the connection 4-tuple (`struct sock_key`, 16 bytes). The `SOCK_OPS` program populates it from kernel context; `RegisterConn(conn)` inserts an _established_ socket (listen sockets return EOPNOTSUPP).
2. Systemd socket activation (`sockmap.ActivationListeners` — `LISTEN_PID`/`LISTEN_FDS`/`LISTEN_FDNAMES`); this package's `activationListeners` is the Node-side mirror.
3. The `SOCK_OPS` / `SK_MSG` program attached to the cgroup v2 hierarchy (`/sys/fs/cgroup`, marker `cgroup.controllers`; auto-detected from `/proc/self/cgroup`).
4. A pre-shutdown cleanup hook removing entries before sockets close, so the map never redirects to a destroyed socket.
5. Prometheus counters `golusoris_sockmap_{redirected_bytes_total,active_sockets,redirect_errors_total}` — this package _reads_ them (`METRIC_NAMES`), never emits them.

When the pin is absent (non-Linux, cgroup v1, kernel <5.10, or `enabled = false`), `probeSockmap` degrades to `af_unix` and the client runs Tier 1 — safe, no crash. The map layout + pin path are part of the contract; track golusoris's BPF object version.

## Tests

`test/` (vitest, node env). Run from the package dir.

- `framing.test.ts` — encode/decode round-trips, multi-frame chunks, partial reads (payload split, header split), empty payloads, over-max length rejection, `reset()`.
- `detect-transport.test.ts` — all three tiers via injected `access`; Tier-3-over-Tier-1 precedence; map not probed when `bpfMapPath` omitted.
- `client.test.ts` — fake socket: connect, tier resolution (`af_unix` / `sockmap`), framed request/response, FIFO ordering, split-response reassembly, error/close/timeout/malformed-frame → `ProblemError`, post-close rejection.
- `sockmap.test.ts` — injected host signals: `probeSockmap` all degrade paths + available; `activationListeners` PID guard / name fallback / malformed `LISTEN_FDS` → `ProblemError`; `parseKernelVersion` / `kernelAtLeast`; `bpftoolKeyCount` + `parsePrometheusMetrics` parsing; `readSockmapStats` with/without metrics.

Privileged integration tests (Docker `--privileged` + `bpffs` + a loaded golusoris `pkg/sockmap`) for the live kernel redirect run out-of-tree; the in-tree suite drives every pure/injectable seam.

## Common tasks

| Task       | Command (from package dir)                          |
| ---------- | --------------------------------------------------- |
| Typecheck  | `pnpm --filter @sveltesentio/ipc-sockmap typecheck` |
| Lint       | `pnpm --filter @sveltesentio/ipc-sockmap lint`      |
| Unit tests | `pnpm --filter @sveltesentio/ipc-sockmap test`      |

## Related

- [ADR-0051](../../docs/adr/0051-colocated-ipc-ladder-ebpf-sockmap.md) — the three-tier ladder.
- [docs/compose/colocated-ipc.md](../../docs/compose/colocated-ipc.md) — Tier 1 + 2 recipes.
- [golusoris/golusoris#27](https://github.com/golusoris/golusoris/issues/27) — golusoris-side Tier-3 work.
