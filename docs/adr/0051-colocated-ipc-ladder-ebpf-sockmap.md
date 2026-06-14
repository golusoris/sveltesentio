# ADR-0051: Colocated-IPC ladder for SvelteKit ↔ Golusoris; custom eBPF SK_MSG sockmap as top tier

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D200 in `.workingdir/research/decisions-needed.md`

## Context

When `@sveltesentio/*` (SvelteKit Node server) and `golusoris/*` (Go) run on the same host / VM / pod, loopback TCP traverses the full kernel stack per request. Latency + throughput are left on the table. User directive (2026-04-17): ship a kernel-bypass ladder with the heaviest tier backed by a custom eBPF SK_MSG program.

Three tiers deliver progressively more performance at progressively more ops cost:

1. **AF_UNIX sockets** — zero BPF, just Unix domain sockets. Trivial; ~2-3× local throughput vs TCP loopback.
2. **Cilium `socketLB`** — cluster-level; BPF-backed but owned by Cilium; transparent to app.
3. **Custom SK_MSG sockmap** — BPF program attached to cgroup v2 redirects packets between local socket buffers without stack traversal. Owned by sveltesentio + golusoris jointly.

## Decision

Ship all three tiers as documented deployment options. Tier 3 requires changes on both sides — tracked in [golusoris/golusoris#27](https://github.com/golusoris/golusoris/issues/27).

- **`docs/compose/colocated-ipc.md`** covers Tiers 1 + 2 with ready-to-paste snippets (undici `Agent({ socketPath })`, Go `net.Listen("unix", ...)`, Cilium `socketLB` flag).
- **`@sveltesentio/ipc-sockmap` package** (new): Tier 3 Node-side client.
  - Opens the pinned `BPF_MAP_TYPE_SOCKHASH` at `/sys/fs/bpf/golusoris/sockhash` (owned by golusoris's `pkg/sockmap`).
  - Registers its own listen FD (reads via systemd socket activation when possible).
  - Exposes health + observability (`redirected_bytes`, `active_sockets`).
  - Defaults to no-op when the map isn't present (graceful degrade to Tier 1).
- Golusoris provides: (1) systemd socket activation support, (2) stable cgroup v2 attach point, (3) pre-shutdown sockmap-cleanup hook, (4) first-class `pkg/sockmap/` fx module bundling `cilium/ebpf` + CO-RE BPF object + Prometheus counters + ≥5.10 kernel guard. See golusoris#27.

## Alternatives considered

- **Framework has no opinion** — every deployment re-invents AF_UNIX plumbing; no path to Tier 2/3.
- **Ship only Tier 1** — rejected by user; wanted the full ladder including custom SK_MSG.
- **Ship a wrapper library that does kernel bypass itself** — impossible from userspace Node; BPF requires CAP_BPF and kernel-side program.
- **Shared memory IPC (e.g. `mmap`)** — bigger API surface change; sockets preserve HTTP/gRPC semantics without app rewrite.

## Consequences

**Positive**:
- Tier 1 is one config change and wins ~2-3× throughput — most users stop here.
- Tier 2 wins additional ~10-30% on cluster-native deployments without code changes.
- Tier 3 provides measurable wins at high-throughput scale without changing the HTTP/RPC protocol surface.
- Ownership boundary is clean: golusoris owns the BPF program (closer to its own FD lifecycle), sveltesentio is a map client.

**Negative / trade-offs**:
- Tier 3 requires CAP_BPF + cgroup v2 + ≥5.10 kernel. Non-Linux hosts (macOS, Windows) fall back to Tier 1 by construction.
- Sveltesentio's `ipc-sockmap` loader must track golusoris's BPF object version; map layout is part of the contract.
- Integration test requires privileged Docker / KVM.

**Documentation obligations**:
- `docs/compose/colocated-ipc.md` — Tier 1 + 2 recipes.
- `@sveltesentio/ipc-sockmap` AGENTS.md — Tier 3 map contract + degradation semantics.
- Link to golusoris#27 tracking golusoris-side work.

## Evidence

- `.workingdir/research/decisions-needed.md` — D200 locked 2026-04-17.
- golusoris/golusoris#27 — filed 2026-04-17 with four acceptance criteria.
- Linux selftest: `tools/testing/selftests/bpf/progs/test_sockmap_kern.c`.
- Cilium `socketLB` documentation — reference implementation of Tier 2.
