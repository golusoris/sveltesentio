# Colocated IPC — SvelteKit ↔ Golusoris

> How to eliminate loopback TCP stack traversal when SvelteKit and Golusoris run on the same host, VM, or pod.
>
> See [ADR-0051](../adr/0051-colocated-ipc-ladder-ebpf-sockmap.md) for the decision record.

## The ladder

| Tier | Mechanism                  | Setup                  | Speedup vs. loopback TCP                 | Package                                                             |
| ---- | -------------------------- | ---------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| 1    | AF_UNIX socket             | Trivial (config-only)  | ~2-3× throughput, ~40% latency reduction | None — stdlib                                                       |
| 2    | Cilium `socketLB`          | Cluster-level          | Additional ~10-30% on top of Tier 1      | None — transparent                                                  |
| 3    | Custom eBPF SK_MSG sockmap | CAP_BPF + kernel ≥5.10 | ~2× further on high-concurrency          | [`@sveltesentio/ipc-sockmap`](../../packages/ipc-sockmap/README.md) |

**Start at Tier 1.** Most deployments stop here. Only climb when measurement proves you need to.

---

## Tier 1 — AF_UNIX sockets

Golusoris listens on a Unix domain socket; SvelteKit's HTTP client uses a Unix-socket dispatcher. Zero kernel networking stack for the payload — the socket buffers are the fast path.

### Golusoris side

```go
// cmd/api/main.go (or equivalent entrypoint)
l, err := net.Listen("unix", "/tmp/golusoris-api.sock")
if err != nil {
    return err
}
// permissions: 0660, owner = your runtime user, group = sveltesentio-runtime
if err := os.Chmod("/tmp/golusoris-api.sock", 0o660); err != nil {
    return err
}

srv := &http.Server{Handler: router}
return srv.Serve(l)
```

### SvelteKit side (via `undici` — the dispatcher Node's native `fetch` uses)

```ts
// src/lib/server/golusoris-client.ts
import { Agent, fetch } from 'undici';
import createClient from 'openapi-fetch';
import type { paths } from './golusoris-openapi'; // generated via openapi-typescript

const agent = new Agent({
  connect: {
    socketPath: '/tmp/golusoris-api.sock',
  },
});

// openapi-fetch accepts a custom fetch; wire the Unix-socket agent in
export const golusoris = createClient<paths>({
  baseUrl: 'http://unix', // arbitrary; undici routes via the agent
  fetch: (url, init) => fetch(url, { ...init, dispatcher: agent }),
});
```

### systemd unit wiring (recommended)

Using systemd socket activation keeps the listen FD owned by the supervisor, which matters if you ever climb to Tier 3 (it's the same FD handoff mechanism).

```ini
# /etc/systemd/system/golusoris-api.socket
[Unit]
Description=Golusoris API socket

[Socket]
ListenStream=/run/golusoris/api.sock
SocketMode=0660
SocketUser=golusoris
SocketGroup=sveltesentio

[Install]
WantedBy=sockets.target
```

```ini
# /etc/systemd/system/golusoris-api.service
[Unit]
Description=Golusoris API
Requires=golusoris-api.socket

[Service]
ExecStart=/usr/local/bin/golusoris-api
# Go reads the FD from LISTEN_FDS via coreos/go-systemd/v22/activation
```

### When to stop at Tier 1

- Single-host deployments (dev, small VPS, Docker Compose).
- You haven't measured that syscall overhead is actually your bottleneck.
- You don't need CAP_BPF (shared hosting, restrictive environments).

Tier 1 covers the majority of colocated deployments.

---

## Tier 2 — Cilium `socketLB`

On Kubernetes clusters running Cilium as CNI, `socketLB` mode (also called "socket-level load balancing" or "kube-proxy replacement") attaches a BPF program to the cgroup hierarchy. Pod-to-pod traffic on the same node is redirected by the kernel before it hits the loopback / virtual-ethernet path.

**Transparent to app code.** You configure Cilium, not SvelteKit or Golusoris.

### Enable socketLB

```yaml
# cilium values.yaml
socketLB:
  enabled: true
  hostNamespaceOnly: false # also applies to pod sockets

kubeProxyReplacement: true
```

Verify with:

```bash
cilium config view | grep -E 'socketLB|kubeProxy'
```

### When to climb to Tier 2

- Kubernetes + Cilium already in your stack.
- Same-node pod-to-pod traffic is a measurable share of your load.
- You're OK with Cilium as the ownership boundary (updates, CVEs, config).

### When to skip

- Not on Cilium. Don't adopt it for this alone — it's a CNI commitment.
- Deployment is simpler than k8s. Tier 1 is cheaper.

---

## Tier 3 — Custom eBPF SK_MSG sockmap

BPF program attaches to the cgroup v2 hierarchy containing both processes. Listen FDs from both sides are registered in a `BPF_MAP_TYPE_SOCKHASH`. Payloads between registered sockets bypass the full TCP stack — the BPF `SK_MSG` hook redirects buffers directly.

**This tier requires coordinated changes in both sveltesentio and golusoris** — both shipped: golusoris's `pkg/sockmap` ([#27](https://github.com/golusoris/golusoris/issues/27)) owns the BPF program + pinned sockhash, and `@sveltesentio/ipc-sockmap/sockmap` is the Node-side capability-probe + socket-activation + observability client.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│ cgroup v2: /sys/fs/cgroup/.../sveltesentio-deployment/ │
│                                                         │
│  ┌───────────────┐      ┌───────────────────────────┐  │
│  │ SvelteKit     │      │ Golusoris                 │  │
│  │ Node process  │      │ Go process                │  │
│  │               │      │                           │  │
│  │  listen FD ───┼──┐ ┌─┼── listen FD              │  │
│  └───────────────┘  │ │ └───────────────────────────┘  │
│                     ▼ ▼                                 │
│     ┌──────────────────────────────────┐                │
│     │ BPF_MAP_TYPE_SOCKHASH            │                │
│     │ (pinned at /sys/fs/bpf/golusoris/│                │
│     │  sockhash)                       │                │
│     └──────────────────────────────────┘                │
│                     ▲                                   │
│                     │ SK_MSG redirect                   │
│   ┌─────────────────┴──────────────────┐                │
│   │ BPF program (owned by golusoris/   │                │
│   │ pkg/sockmap, attached to this      │                │
│   │ cgroup)                            │                │
│   └────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────┘
```

### Preconditions

- **Linux host** — no kernel on macOS/Windows.
- **cgroup v2 unified hierarchy** — check `mount | grep cgroup2` returns exactly one mount.
- **Kernel ≥ 5.10** — BTF / CO-RE baseline (`uname -r`).
- **CAP_BPF** on the process that attaches the BPF program (usually golusoris itself, via the opt-in module).
- **Golusoris running with `fx.Module("ipc.sockmap")` enabled** — the module that pins the sockhash at `/sys/fs/bpf/golusoris/sockhash`.

### Sveltesentio side

The Node side is a kernel-bypass _client_: golusoris owns the sockhash and all writes (Node has no `bpf()` syscall). It probes capability, performs the systemd FD handoff, and reads observability — degrading to Tier 1 when the pin is absent.

```ts
// src/lib/server/ipc-sockmap.ts
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  probeSockmap,
  activationListeners,
  readSockmapStats,
  parsePrometheusMetrics,
  bpftoolKeyCount,
} from '@sveltesentio/ipc-sockmap/sockmap';

const exec = promisify(execFile);

// 1. Capability probe — never throws; degrades to Tier 1 when unavailable
//    (non-Linux, cgroup v1, kernel <5.10, or the pin is absent).
const probe = await probeSockmap(); // defaults: process.platform, os.release(), DEFAULT_PIN_PATH
if (!probe.available) {
  console.warn('[ipc-sockmap] Tier 3 off:', probe.reason); // use the AF_UNIX dispatcher above
}

// 2. Adopt systemd socket-activation FDs. golusoris's SOCK_OPS program registers
//    established sockets in the sockhash from kernel context; we just listen on
//    the handed-off FDs (numbered from 3). PID-guarded; throws on a bad LISTEN_FDS.
const server = createServer(/* … your framed request handler … */);
for (const { fd, name } of activationListeners()) {
  console.warn(`[ipc-sockmap] adopting activated listener ${name} (fd ${fd})`);
  server.listen({ fd });
}

// 3. Observe: active sockets = sockhash key count (values are kernel-only, so we
//    iterate keys); redirected-bytes / errors come from golusoris's Prometheus.
const stats = await readSockmapStats({
  pinPath: probe.available ? probe.pinPath : undefined,
  countKeys: async (pin) => {
    const { stdout } = await exec('bpftool', ['map', 'dump', 'pinned', pin, '--json']);
    return bpftoolKeyCount(stdout);
  },
  readMetrics: async () =>
    parsePrometheusMetrics(await fetch('http://localhost:9090/metrics').then((r) => r.text())),
});
console.warn('[ipc-sockmap] stats', stats);
```

### Golusoris side (shipped — golusoris PR #268, `pkg/sockmap`)

Enable the opt-in fx module (`enabled = false` by default — Tier 3 is strictly opt-in):

```go
// main.go
fx.New(
    golusoris.Core,
    sockmap.Module,                            // from golusoris/pkg/sockmap
    fx.Provide(sockmap.DefaultObjectProvider), // bundled CO-RE SOCK_OPS + SK_MSG object
    // ...
).Run()
```

The module handles BPF object loading, sockhash pinning at `/sys/fs/bpf/golusoris/sockhash`, cgroup v2 attachment, systemd socket activation, and pre-shutdown cleanup. See [golusoris/golusoris#27](https://github.com/golusoris/golusoris/issues/27) and `golusoris/pkg/sockmap/AGENTS.md` for the full map contract.

### Observability

The sockmap module exposes Prometheus counters:

- `golusoris_sockmap_redirected_bytes_total` — bytes bypassed via SK_MSG.
- `golusoris_sockmap_active_sockets` — sockets currently registered in the sockhash.
- `golusoris_sockmap_redirect_errors_total` — redirect-map misses, EAGAIN, etc.

Verify the bypass is working:

```bash
# All of these should show redirect hits incrementing:
watch -n1 'curl -s localhost:9090/metrics | grep sockmap_redirected'

# And lo traffic should stay close to zero for the redirected flows:
sudo tcpdump -i lo -nn port <api-port>  # should be quiet
```

### When to climb to Tier 3

- You've measured Tier 1 (and Tier 2 if applicable) and syscall / stack overhead still dominates.
- You control the deployment enough to grant CAP_BPF and mount `bpffs`.
- You're on Linux 5.10+ in every deployment environment.

### When to stay put

- Non-Linux targets (dev on macOS, Windows runtime). Keep Tier 1; the same code runs everywhere.
- Restricted container environments that can't grant CAP_BPF.
- Kernels older than 5.10.

Sveltesentio's `ipc-sockmap` client degrades to no-op in all of these cases — safe to leave the import in place.

---

## Benchmarking

Before climbing a tier, measure. A minimal benchmark harness:

```bash
# terminal 1: start golusoris with the tier under test
make run-golusoris TIER=tcp    # or: unix / cilium / sockmap

# terminal 2: run the load generator
bombardier -c 128 -d 30s http://unix/ --dispatcher=unix:/tmp/golusoris-api.sock
```

Record:

- p50, p95, p99 latency
- Requests per second
- `perf stat` syscall counts (`sudo perf stat -e 'syscalls:sys_enter_*'`)
- `sockmap_redirected_bytes_total` delta (Tier 3 only)

The deltas between tiers are workload-dependent. Don't assume; measure.

---

## Further reading

- Cilium sockmap documentation — [docs.cilium.io](https://docs.cilium.io/en/stable/network/concepts/ebpf/sockops/)
- Linux selftest — `tools/testing/selftests/bpf/progs/test_sockmap_kern.c`
- `github.com/cilium/ebpf` — Go userspace library
- `bpf2go` — Go codegen for BPF objects
- [ADR-0051](../adr/0051-colocated-ipc-ladder-ebpf-sockmap.md) — decision record
- [golusoris/golusoris#27](https://github.com/golusoris/golusoris/issues/27) — shipped Golusoris-side `pkg/sockmap` (golusoris PR #268)
