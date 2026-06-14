# @sveltesentio/ipc-sockmap — AGENTS.md

> Tier 3 of the colocated-IPC ladder. See [ADR-0051](../../docs/adr/0051-colocated-ipc-ladder-ebpf-sockmap.md).

## Scope

Node-side client for the eBPF sockhash owned by Golusoris's `pkg/sockmap`. This package:

- Opens the pinned map at `/sys/fs/bpf/golusoris/sockhash` (path configurable via `SVELTESENTIO_IPC_SOCKMAP_PATH`).
- Registers the SvelteKit server's listen FD (prefers systemd socket activation, falls back to passing FDs explicitly).
- Exposes observability: `redirected_bytes_total`, `active_sockets`, `redirect_errors_total` read from BPF map stats.
- **Degrades to no-op on non-Linux, kernel < 5.10, missing CAP_BPF, or absent map.** Consumer always falls back to whatever transport it was using (Tier 1 AF_UNIX or TCP loopback).

This package does **not**:

- Ship the BPF program itself — that belongs in golusoris's `pkg/sockmap/`.
- Load or attach any BPF program — same reason.
- Manage CAP_BPF — operators grant capability; package reads runtime environment.

## Preconditions (checked at init)

1. `process.platform === 'linux'`.
2. `/sys/fs/cgroup` is cgroup v2 (single hierarchy; no `cgroup.controllers` in the v1 sense).
3. Kernel version `>= 5.10` (BTF / CO-RE baseline).
4. The pinned map exists at the configured path (golusoris running with sockmap module).
5. Read/write access on the pinned map FD (CAP_BPF or `sudo` setup).

Any failed precondition logs once (warn) and sets `status: 'degraded'`. No throw.

## Golusoris contract

This package assumes golusoris ships an opt-in `fx.Module("ipc.sockmap")` (tracked in [golusoris/golusoris#27](https://github.com/golusoris/golusoris/issues/27)) that:

1. Pins the sockhash at `/sys/fs/bpf/golusoris/sockhash` (cgroup-scoped, mode 0660, group `sockmap`).
2. Supports systemd socket activation so a supervisor can pre-create listen FDs.
3. Attaches `SOCK_OPS` program to the process's cgroup v2 path.
4. Emits `sockmap_redirected_bytes_total` / `sockmap_active_sockets` counters readable via the same map stats.
5. Honours a pre-shutdown hook that invalidates its FD in the sockhash before closing.

If golusoris is not running the module, this package stays in `degraded` state — safe no-op.

## Map layout contract

Version via a `meta` entry at key 0 in a companion `BPF_MAP_TYPE_HASH` pinned next to the sockhash:

```
/sys/fs/bpf/golusoris/sockhash     # BPF_MAP_TYPE_SOCKHASH, key=sockid, value=sockFd
/sys/fs/bpf/golusoris/meta         # BPF_MAP_TYPE_HASH, key="version", value=u32
```

Sveltesentio refuses to register if the version isn't in the compatible set (pinned in this package via a constant, bumped through ADR amendment).

## Tests

Integration tests require a privileged environment (Docker `--privileged` with `bpffs` mounted at `/sys/fs/bpf`, or KVM). Harness lives under `packages/ipc-sockmap/test/integration/` once implementation lands.

Unit tests cover: precondition detection, degrade-to-no-op paths, version mismatch handling.

## Common tasks

| Task | Command |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/ipc-sockmap typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/ipc-sockmap test` |
| Integration (privileged) | `pnpm --filter @sveltesentio/ipc-sockmap test:integration` (requires root / CAP_BPF) |

## Related

- [ADR-0051](../../docs/adr/0051-colocated-ipc-ladder-ebpf-sockmap.md) — the three-tier ladder.
- [docs/compose/colocated-ipc.md](../../docs/compose/colocated-ipc.md) — Tier 1 + 2 recipes.
- [golusoris/golusoris#27](https://github.com/golusoris/golusoris/issues/27) — Golusoris-side acceptance criteria.
