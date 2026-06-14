# Collab — opt-in P2P transport (`y-webrtc`)

`@sveltesentio/collab` defaults to server-mediated `y-websocket`
([collab.md](collab.md)) per [ADR-0009](../adr/0009-yjs-y-websocket-collab.md).
This recipe documents the **escape hatch**: `y-webrtc@^10` for peer-to-peer
sync, used alongside or instead of the WS provider.

P2P is a minority path. Use it only when:

- Latency between two peers on the same LAN matters more than
  server-authoritative history (pair-programming, co-editing over
  low-latency links).
- A short-lived room has no durability requirement (design-review
  ceremony, single-session whiteboard).
- You're building a trust-minimized demo with no backend.

Prefer `y-websocket` (with optional [collab-persistence.md](collab-persistence.md))
when **any** of:

- Server-side snapshots, audit log, or moderation must be
  authoritative.
- Users need to reconnect hours later without another peer online.
- The doc must survive all peers leaving.
- Compliance (EU CRA / audit) requires centralized retention.

## Install

```bash
pnpm add y-webrtc
```

Peer: `y-webrtc@^10`, `yjs@^13.6`. Also pulls `simple-peer` +
`lib0` (transitively — already on the tree via yjs).

## Signaling

`y-webrtc` needs a signaling server to introduce peers. Public
defaults (`wss://y-webrtc-eu.fly.dev` etc.) are **not** production —
they're best-effort and externally observable. Run your own:

```ts
// Node signaling server (tiny; often on a Golusoris sidecar)
// pnpm add y-webrtc
// node node_modules/y-webrtc/bin/server.js
```

For sveltesentio, the recommended deployment pairs the Go signaling
endpoint on Golusoris's `/collab/signal` with per-room ACLs — see
`golusoris/collab/signal/` (Phase 2b). Until that lands, run the Node
bin behind your own TLS.

## Wiring

```ts
// src/lib/collab/flow-p2p.ts
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { browser } from '$app/environment';

export function connectFlowP2P(flowId: string, token: string) {
  if (!browser) throw new Error('collab client-only');

  const doc = new Y.Doc();
  const provider = new WebrtcProvider(`flow:${flowId}`, doc, {
    signaling: ['wss://signal.example.com/collab/signal'],
    password: token,           // PBKDF2-derived key; see "Room auth"
    maxConns: 20,
    filterBcConns: true,
    peerOpts: {
      config: {
        iceServers: [
          { urls: ['stun:stun.example.com:3478'] },
          {
            urls: ['turn:turn.example.com:3478'],
            username: token,
            credential: token,
          },
        ],
      },
    },
  });

  return {
    doc,
    provider,
    destroy() {
      provider.destroy();
      doc.destroy();
    },
  };
}
```

Key flags:

- `password` — encrypts Yjs updates symmetrically. **Not** authn; it's
  a pre-shared secret. Derive per-room from a server-minted token
  (short TTL). See "Room auth" below.
- `maxConns: 20` — cap peer count. Mesh topology means N×(N−1)/2
  connections; scaling past ~20 peers degrades quickly.
- `filterBcConns: true` — dedupe peers reachable via BroadcastChannel
  (same-origin tabs).
- TURN is mandatory for production — symmetric-NAT peers can't
  connect without a relay. STUN alone fails on ~20% of real networks.

## Room auth

The `password` field encrypts payload but does **not** gate entry.
Anyone with the signaling URL + room name joins the mesh. Gate via
server-minted tokens:

```ts
// +layout.server.ts
export const load = async ({ locals, params }) => {
  const token = await locals.golusoris.mintCollabToken({
    roomId: `flow:${params.flowId}`,
    ttl: 60 * 60,                 // 1 h
    permissions: ['read', 'write'],
  });
  return { flowId: params.flowId, token };
};
```

The token doubles as the `password` (y-webrtc) and the TURN
credential. Rotate on every room join. Revoke server-side on user
removal from the room — existing peers stay connected until the mesh
heartbeat times out (~30 s).

Authoritative gate: the signaling server enforces the token on
`connect`. Without that, P2P is open-mesh.

## Awareness

Same API as [collab.md](collab.md):

```ts
const { awareness } = provider;
awareness.setLocalStateField('user', { name, color });

awareness.on('change', () => {
  peers = Array.from(awareness.getStates().values());
});
```

P2P awareness is lower-latency (no server hop) but has no
server-side moderation — any peer can set any state. Don't trust
peer-reported identity for security decisions.

## Hybrid: WS-primary + WebRTC-assist

The common production pattern. WS is authoritative; WebRTC provides
sub-100 ms co-editing updates for peers behind the same NAT:

```ts
import { WebsocketProvider } from 'y-websocket';
import { WebrtcProvider } from 'y-webrtc';

const doc = new Y.Doc();
const ws = new WebsocketProvider('/collab', flowId, doc);
const p2p = new WebrtcProvider(`flow:${flowId}`, doc, {
  signaling: ['wss://signal.example.com/collab/signal'],
  password: token,
});
```

Yjs CRDT semantics converge across both providers — updates sent
via one are merged when received via the other. Bandwidth cost: each
update is emitted twice.

Disable P2P gracefully on mobile / battery-sensitive sessions:

```ts
const prefersReduced = matchMedia('(prefers-reduced-data: reduce)').matches;
const p2p = prefersReduced ? null : new WebrtcProvider(...);
```

## Security considerations

Peer identity is not cryptographically verified beyond the shared
`password`. Risks:

| Risk | Mitigation |
|---|---|
| Anyone with room name + signaling URL joins mesh | Server-minted tokens (above) |
| Payload eavesdropping in signaling | TLS on signaling endpoint |
| Payload eavesdropping peer-to-peer | `password` → symmetric crypto on Yjs updates |
| Malicious peer ships corrupt CRDT | Yjs is merge-robust; corruption rewrites tombstones |
| Malicious peer floods awareness | Rate-limit server-side per token; revoke |
| TURN credential reuse | Ephemeral credentials (per-room, short TTL) |

The model suits trusted-mesh scenarios (internal team docs); **not**
suitable for open-room publishing. For public docs, WS + server-side
moderation is non-optional.

## SSR / CSP

WebRTC requires permissive CSP. Add to `hooks.server.ts`:

```ts
const cspDirectives = {
  'connect-src': [
    "'self'",
    'wss://signal.example.com',
    'wss:',                     // WebRTC SDP over signaling
    'stun:stun.example.com:*',
    'turn:turn.example.com:*',
  ],
};
```

The `wss:` blanket is narrower than it looks — RTC uses SDP-negotiated
ports, not arbitrary WS. Pin the exact signaling host.

## Connectivity UX

P2P connect latency is 1–3 s on first peer. Show state:

```svelte
<script lang="ts">
  let status = $state<'connecting' | 'connected' | 'isolated'>('connecting');

  $effect(() => {
    const onPeers = ({ webrtcPeers }: { webrtcPeers: string[] }) => {
      status = webrtcPeers.length > 0 ? 'connected' : 'isolated';
    };
    provider.on('peers', onPeers);
    return () => provider.off('peers', onPeers);
  });
</script>

<span role="status" aria-live="polite" class="text-muted-fg text-xs">
  {#if status === 'connecting'}Finding peers…
  {:else if status === 'isolated'}Working alone (no peers)
  {:else}Connected to {peerCount} peer{peerCount === 1 ? '' : 's'}
  {/if}
</span>
```

`isolated` is normal — there may be no other peer online. Don't
present it as an error.

## Testing

`y-webrtc` is hard to unit-test (needs actual peer connections).
Strategies:

- **Unit.** Use `mockProvider` from [collab.md](collab.md). Swap
  transport for an in-memory pair. P2P-specific logic is thin; mock
  at the Y.Doc level.
- **Integration.** `wrtc` package in Node for headless WebRTC peers.
  Spin two Node processes + signaling server; assert convergence.
- **Playwright.** Fake media + RTC via
  `context.grantPermissions(['camera', 'microphone'])` + two browser
  contexts hitting the same room URL. Slow — keep to a handful of
  smoke tests.

Example integration skeleton:

```ts
import { spawn } from 'node:child_process';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import wrtc from 'wrtc';

const signaling = spawn('node', ['node_modules/y-webrtc/bin/server.js']);

test('two peers converge', async () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const pa = new WebrtcProvider('t', a, {
    signaling: ['ws://localhost:4444'],
    peerOpts: { wrtc },
  });
  const pb = new WebrtcProvider('t', b, {
    signaling: ['ws://localhost:4444'],
    peerOpts: { wrtc },
  });

  await new Promise((r) => pa.once('peers', r));
  a.getArray('nodes').push([{ id: 'n-1' }]);
  await new Promise((r) => setTimeout(r, 200));
  expect(b.getArray('nodes').toArray()).toHaveLength(1);

  pa.destroy();
  pb.destroy();
  signaling.kill();
});
```

## Anti-patterns

- **Using public signaling servers in production.** Unauthenticated,
  rate-limited, externally observable. Run your own with per-room
  ACLs.
- **Omitting TURN.** ~20% of real networks can't traverse NAT with
  STUN alone. Users behind symmetric NAT (carrier-grade / corporate)
  silently fail.
- **Treating `password` as authn.** It's transport encryption. Gate
  entry server-side via signed tokens.
- **Trusting peer-reported identity.** Awareness is best-effort;
  anyone on the mesh can claim any name. Server-mediated identity
  (WS sidecar or Golusoris token claim) is authoritative.
- **Unbounded `maxConns`.** Mesh topology is O(N²). Cap at 20 unless
  you've measured the link.
- **P2P-only for durable docs.** Room disappears when all peers
  leave. Use WS + [collab-persistence.md](collab-persistence.md) for
  durable scenarios.
- **Ignoring `prefers-reduced-data`.** Mesh bandwidth is non-trivial
  on mobile. Respect the user's signal.

## References

- ADR-0009 — Yjs + y-websocket lock; `y-webrtc` as opt-in extension.
- [collab.md](collab.md) — default WS path.
- [collab-persistence.md](collab-persistence.md) — opt-in offline
  cache.
- `y-webrtc`: <https://github.com/yjs/y-webrtc>.
- WebRTC NAT traversal overview:
  <https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity>.
