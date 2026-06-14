# @sveltesentio/ipc-sockmap

> Tier 3 client for kernel-bypass colocated IPC between SvelteKit (Node) and Golusoris (Go) via the golusoris-owned eBPF SK_MSG sockhash.

Part of the [sveltesentio](https://github.com/lusoris/sveltesentio) composable SvelteKit framework.

## Status

🚧 Phase 1 skeleton — implementation blocked on [golusoris/golusoris#27](https://github.com/golusoris/golusoris/issues/27).

The package exists to reserve the public surface and document the ladder. See [ADR-0051](../../docs/adr/0051-colocated-ipc-ladder-ebpf-sockmap.md) and [docs/compose/colocated-ipc.md](../../docs/compose/colocated-ipc.md).

## When to use this package

You should **not** import this package until you've tried Tier 1 (AF_UNIX) and measured that loopback TCP stack traversal is your actual bottleneck. See the ladder:

| Tier | Mechanism | Cost | Import |
|---|---|---|---|
| 1 | AF_UNIX socket | Trivial | None — `undici` `Agent({ socketPath })` |
| 2 | Cilium `socketLB` | Cluster config | None — transparent |
| 3 | Custom eBPF sockmap | CAP_BPF + kernel ≥5.10 | `@sveltesentio/ipc-sockmap` |

Tier 3 requires:

- Linux host with cgroup v2 unified hierarchy
- Kernel ≥ 5.10 (BTF / CO-RE baseline)
- Golusoris deployed with `fx.Module("ipc.sockmap")` enabled (pins the sockhash at `/sys/fs/bpf/golusoris/sockhash`)
- CAP_BPF on the SvelteKit Node process (or a loader sidecar)

If any of those preconditions fail, the client **degrades gracefully to Tier 1** — no crash, just no kernel bypass.

## Installation

```bash
pnpm add @sveltesentio/ipc-sockmap
```

## License

MIT © lusoris
