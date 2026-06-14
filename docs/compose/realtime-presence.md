# `realtime-presence.md` — multi-user presence recipe for sveltesentio

Presence — "who else is looking at this right now, and where is
their cursor / what are they typing / when did they last act" — is
the live-collaboration sibling to [collab.md](collab.md) (Yjs
document state). Where collab tracks **content**, presence tracks
**ephemeral session state** that should never persist beyond a
disconnect: cursor positions, selection ranges, typing indicators,
"X is viewing this page" badges, last-seen heartbeats.

Per [ADR-0009](../adr/0009-collab-yjs.md) +
[ADR-0037](../adr/0037-sse-vs-websocket.md), the default mechanism
is **Yjs Awareness API** (rides on the same y-websocket transport,
ephemeral by definition, CRDT-aware) for collaborative-document
contexts; **SSE-based heartbeats** (per
[sse.md](sse.md)) for view-only "who's watching" badges; never
**raw WebSocket presence channels** unless you genuinely need
bidi state outside a Yjs document.

## Related

- [collab.md](collab.md) — Yjs document base; awareness rides on
  the same provider
- [sse.md](sse.md) — heartbeat / one-way "who is here" badges
- [websocket.md](websocket.md) — escape hatch for non-Yjs bidi
  presence (avoid)
- [collab-persistence.md](collab-persistence.md) — offline document
  sync (presence does NOT persist; it's ephemeral by design)
- [observability.md](observability.md) — presence-channel cardinality
  observability
- [rate-limiting.md](rate-limiting.md) — heartbeat endpoint
  protection
- [theming.md](theming.md) — per-user cursor color tokens
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — non-distracting
  cursor animation + reduced-motion respect
- [ADR-0009](../adr/0009-collab-yjs.md)
- [ADR-0037](../adr/0037-sse-vs-websocket.md)

## When to use what — decision tree

```text
Cursor + selection inside a Yjs document       → Yjs Awareness (this recipe)
"3 people viewing this page" badge              → SSE heartbeat (this recipe)
Typing-indicator inside a chat                  → Yjs Awareness or short-lived flag
Live cursor on a static (non-collab) page       → Awareness via standalone Yjs doc + provider
Online/offline status at app level              → SSE channel (this recipe) + activity heartbeats
Presence across regions                         → don't (eventual-consistency wrong tool); per-region presence + soft cross-region indicator
Persistent "last seen 3min ago" only            → polling REST endpoint; presence is overkill
```

## Architecture — two transports, one mental model

```text
A. CONTENT-LINKED PRESENCE (Yjs Awareness)

    user A typing →  awareness.setLocalState({...}) → y-websocket → broadcast to
                                                        ▲             │
                                                        │             ▼
    user B sees    ← awareness.on('change', cb)  ←─────┴── awareness state
                                                                of all users in this doc

B. VIEW-ONLY PRESENCE (SSE heartbeats)

    every user opens /api/presence/{room} (EventSource)
    server adds (userId, sessionId, lastSeen) to room
    every 15s: client posts heartbeat → server updates lastSeen
    server broadcasts SSE: "join", "leave", "snapshot" to all room subscribers
    inactive >60s → server removes + broadcasts "leave"
```

Pattern A is the right answer when presence and content move
together (cursor in a doc). Pattern B is the right answer when
presence is decoupled (page-level "who is viewing").

## Shape — bounded Zod contracts

```ts
// packages/realtime-presence/src/schema.ts
import { z } from 'zod';

// Yjs Awareness payload — the local state every user broadcasts.
// Bounded fields prevent payload bloat (each peer pays for every other peer's state).
export const PresenceState = z.object({
  user: z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(80),
    avatarUrl: z.string().url().nullable(),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
  }),
  cursor: z.object({
    anchor: z.number().int().nonnegative(),
    head: z.number().int().nonnegative(),
  }).nullable(),
  selection: z.object({
    rects: z.array(z.object({
      top: z.number(), left: z.number(), width: z.number(), height: z.number(),
    })).max(20),
  }).nullable(),
  typing: z.boolean().default(false),
  lastActiveAt: z.number().int().nonnegative(), // epoch ms
  // App-specific extension; cap to keep payload <2KB per peer
  app: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type PresenceState = z.infer<typeof PresenceState>;

// SSE-based view-only presence
export const PresenceEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'),
    room: z.string().min(1).max(200),
    members: z.array(z.object({
      userId: z.string().uuid(),
      name: z.string(),
      avatarUrl: z.string().url().nullable(),
      joinedAt: z.string().datetime(),
      lastSeenAt: z.string().datetime(),
    })).max(500),
    serverTime: z.string().datetime(),
  }),
  z.object({
    type: z.literal('join'),
    room: z.string(),
    userId: z.string().uuid(),
    name: z.string(),
    avatarUrl: z.string().url().nullable(),
    joinedAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal('leave'),
    room: z.string(),
    userId: z.string().uuid(),
    leftAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal('heartbeat'),
    serverTime: z.string().datetime(),
  }),
]);
export type PresenceEvent = z.infer<typeof PresenceEvent>;
```

`PresenceState` payload is bounded by Zod; for a 50-user doc that
means upper-bound ~100KB total awareness state, manageable across
peers.

## Reference — Yjs Awareness wiring

```ts
// $lib/realtime/awareness.ts
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Awareness } from 'y-protocols/awareness';
import { PresenceState } from '@sveltesentio/realtime-presence/schema';

export type PresenceProvider = {
  awareness: Awareness;
  setLocal: (s: PresenceState) => void;
  onChange: (cb: (states: Map<number, PresenceState>) => void) => () => void;
  destroy: () => void;
};

export function createPresence(doc: Y.Doc, room: string, user: PresenceState['user']): PresenceProvider {
  const provider = new WebsocketProvider(
    `${import.meta.env.VITE_WS_URL}/yjs`,
    room,
    doc,
    { connect: true, params: { token: getYjsToken() } },
  );
  const awareness = provider.awareness;

  // Initialize local state with user identity (always present).
  const initial: PresenceState = {
    user,
    cursor: null,
    selection: null,
    typing: false,
    lastActiveAt: Date.now(),
  };
  awareness.setLocalState(PresenceState.parse(initial));

  // Garbage-collect stale peers — y-websocket marks peers offline after 30s
  // by default. We re-emit on change.
  function onChange(cb: (states: Map<number, PresenceState>) => void) {
    const handler = () => {
      const states = new Map<number, PresenceState>();
      for (const [clientId, raw] of awareness.getStates()) {
        const parsed = PresenceState.safeParse(raw);
        if (parsed.success) states.set(clientId, parsed.data);
        // else: silently drop malformed state from another client
      }
      cb(states);
    };
    awareness.on('change', handler);
    handler(); // emit initial
    return () => awareness.off('change', handler);
  }

  function setLocal(s: PresenceState) {
    awareness.setLocalState(PresenceState.parse({ ...s, lastActiveAt: Date.now() }));
  }

  return {
    awareness,
    setLocal,
    onChange,
    destroy: () => provider.destroy(),
  };
}
```

`PresenceState.safeParse` on every received peer state — a malicious
or buggy client shouldn't crash the consumer. Drop-and-continue
posture preserves UX for the rest of the room.

## Reference — Svelte component using awareness

```svelte
<!-- $lib/components/CollaborativeEditor.svelte -->
<script lang="ts">
  import * as Y from 'yjs';
  import { onMount } from 'svelte';
  import { createPresence, type PresenceState } from '$lib/realtime/awareness';
  import RemoteCursor from './RemoteCursor.svelte';

  type Props = { docId: string; user: PresenceState['user'] };
  const { docId, user }: Props = $props();

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');

  let editorEl = $state<HTMLDivElement | null>(null);
  let peers = $state<Map<number, PresenceState>>(new Map());
  let presence = $state<ReturnType<typeof createPresence> | null>(null);

  onMount(() => {
    presence = createPresence(ydoc, `doc:${docId}`, user);
    const off = presence.onChange((s) => (peers = new Map(s)));

    // Update local cursor every selection change.
    const sel = () => {
      const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
      presence!.setLocal({
        user,
        cursor: range ? { anchor: range.startOffset, head: range.endOffset } : null,
        selection: range ? selectionRects(range) : null,
        typing: false,
        lastActiveAt: Date.now(),
      });
    };
    document.addEventListener('selectionchange', sel);
    return () => {
      document.removeEventListener('selectionchange', sel);
      off();
      presence!.destroy();
    };
  });

  // Filter our own clientId out of remote peers.
  const remote = $derived(
    Array.from(peers.entries()).filter(([cid]) => cid !== presence?.awareness.clientID),
  );
</script>

<div bind:this={editorEl} contenteditable class="relative">
  <!-- Yjs binding to editorEl elided; see collab.md -->
  {#each remote as [cid, p] (cid)}
    <RemoteCursor state={p} />
  {/each}
</div>
```

```svelte
<!-- RemoteCursor.svelte -->
<script lang="ts">
  import type { PresenceState } from '@sveltesentio/realtime-presence/schema';
  type Props = { state: PresenceState };
  const { state }: Props = $props();

  // Respect prefers-reduced-motion: animate position only when motion is OK.
  let prefersReducedMotion = $state(false);
  $effect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion = m.matches;
    const cb = () => (prefersReducedMotion = m.matches);
    m.addEventListener('change', cb);
    return () => m.removeEventListener('change', cb);
  });

  const transition = $derived(prefersReducedMotion ? 'none' : 'transform 80ms linear');
</script>

{#if state.cursor && state.selection?.rects.length}
  {#each state.selection.rects as r}
    <div
      class="pointer-events-none absolute"
      style:top="{r.top}px" style:left="{r.left}px"
      style:width="{r.width}px" style:height="{r.height}px"
      style:background-color={state.user.color}
      style:opacity="0.2"
      style:transition
    ></div>
  {/each}
  <div
    class="pointer-events-none absolute h-5 w-px"
    style:background-color={state.user.color}
    style:transition
    aria-hidden="true"
  ></div>
  <span
    class="pointer-events-none absolute -top-5 rounded px-1 text-xs text-white"
    style:background-color={state.user.color}
  >{state.user.name}</span>
{/if}
```

`pointer-events-none` on overlays prevents remote cursors from
intercepting clicks. `aria-hidden="true"` because the cursor visual
is decorative — name labels remain readable but not announced on
every move.

## Reference — SSE-based view-only presence

```ts
// src/routes/api/presence/[room]/+server.ts
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { presenceRegistry } from '$lib/server/presence';
import { PresenceEvent } from '@sveltesentio/realtime-presence/schema';

const Params = z.object({ room: z.string().min(1).max(200) });

export const GET = async ({ params, locals, request }) => {
  if (!locals.user) throw error(401);
  const { room } = Params.parse(params);

  const stream = new ReadableStream({
    async start(controller) {
      const member = {
        userId: locals.user.id,
        name: locals.user.name,
        avatarUrl: locals.user.avatarUrl,
        sessionId: crypto.randomUUID(),
      };

      const send = (e: PresenceEvent) =>
        controller.enqueue(`data: ${JSON.stringify(PresenceEvent.parse(e))}\n\n`);

      const subscriber = presenceRegistry.subscribe(room, member, send);

      // Send initial snapshot
      send({
        type: 'snapshot',
        room,
        members: presenceRegistry.list(room),
        serverTime: new Date().toISOString(),
      });

      // 15s heartbeat keeps proxies happy + tells client we're alive
      const heartbeat = setInterval(() => {
        send({ type: 'heartbeat', serverTime: new Date().toISOString() });
      }, 15_000);

      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        subscriber.unsubscribe();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no', // disable nginx buffering
    },
  });
};
```

```ts
// $lib/server/presence.ts
import type { PresenceEvent } from '@sveltesentio/realtime-presence/schema';

type Member = { userId: string; name: string; avatarUrl: string | null; sessionId: string };
type Subscriber = (event: PresenceEvent) => void;

class PresenceRegistry {
  private rooms = new Map<string, Map<string, { member: Member; lastSeen: number; send: Subscriber }>>();

  subscribe(room: string, member: Member, send: Subscriber) {
    if (!this.rooms.has(room)) this.rooms.set(room, new Map());
    const r = this.rooms.get(room)!;
    r.set(member.sessionId, { member, lastSeen: Date.now(), send });

    this.broadcast(room, {
      type: 'join',
      room,
      userId: member.userId,
      name: member.name,
      avatarUrl: member.avatarUrl,
      joinedAt: new Date().toISOString(),
    });

    return {
      unsubscribe: () => {
        r.delete(member.sessionId);
        if (r.size === 0) this.rooms.delete(room);
        this.broadcast(room, {
          type: 'leave',
          room,
          userId: member.userId,
          leftAt: new Date().toISOString(),
        });
      },
    };
  }

  list(room: string): { userId: string; name: string; avatarUrl: string | null; joinedAt: string; lastSeenAt: string }[] {
    const r = this.rooms.get(room);
    if (!r) return [];
    return Array.from(r.values()).map(({ member, lastSeen }) => ({
      ...member,
      joinedAt: new Date(lastSeen).toISOString(),
      lastSeenAt: new Date(lastSeen).toISOString(),
    }));
  }

  private broadcast(room: string, event: PresenceEvent) {
    const r = this.rooms.get(room);
    if (!r) return;
    for (const { send } of r.values()) send(event);
  }

  // Reaper: remove stale sessions (no heartbeat in 60s)
  startReaper() {
    setInterval(() => {
      const now = Date.now();
      for (const [room, members] of this.rooms) {
        for (const [sessionId, { member, lastSeen }] of members) {
          if (now - lastSeen > 60_000) {
            members.delete(sessionId);
            this.broadcast(room, {
              type: 'leave', room, userId: member.userId, leftAt: new Date().toISOString(),
            });
          }
        }
        if (members.size === 0) this.rooms.delete(room);
      }
    }, 10_000);
  }
}

export const presenceRegistry = new PresenceRegistry();
presenceRegistry.startReaper();
```

In-memory presence registry works for **single-instance** servers.
Multi-instance / multi-region deployments need Redis pub/sub fan-out
(Redis-streams or `PUBLISH`/`SUBSCRIBE`) — same pattern, registry
becomes a per-room subscription on a shared Redis channel.

## Multi-instance fan-out via Redis

```ts
// $lib/server/presence-redis.ts (sketch)
import { redis, redisSub } from './redis';

await redisSub.subscribe('presence:*');
redisSub.on('pmessage', (_pattern, channel, payload) => {
  const room = channel.split(':')[1];
  const event: PresenceEvent = JSON.parse(payload);
  // forward to local subscribers of this room
});

// On local broadcast:
await redis.publish(`presence:${room}`, JSON.stringify(event));
```

Cardinality matters: a popular room with 500 simultaneous viewers
generates 500 × 500 = 250K event sends per join. Cap room size +
collapse "X others" badges past ~20 visible avatars.

## Reduced-motion + a11y

- **`prefers-reduced-motion: reduce`** → drop cursor-position
  animation; jump-to-position only.
- **Cursor labels are decorative** (`aria-hidden`) but appear in
  reading order via the user list (`aria-live="polite"` snapshot of
  joins/leaves).
- **Color contrast**: cursor color must hit 3:1 against editor
  background; assign per-user from a vetted palette ([theming.md](theming.md)).
- **Focus is not stolen** by remote presence — remote cursor never
  triggers focus events on the local DOM.

## Anti-patterns (24)

1. **Persisting awareness state to DB** — defeats the point;
   awareness is ephemeral. Persist content (Yjs doc) only.
2. **Unbounded `app` extension on `PresenceState`** — peers send
   100KB cursor payloads; the room slows for everyone.
3. **Polling every 1s for "who's online"** — N clients × 1s = N
   req/s per server. Use SSE or awareness.
4. **Heartbeats every 1s** — wasted bandwidth + battery; 15s is
   plenty for in-app presence; 30s for dashboards.
5. **No reaper for stale sessions** — registry grows unbounded;
   "online" list shows ghosts forever.
6. **Cursor color picked from full random RGB** — fails 3:1 contrast
   half the time. Use a vetted accessible palette.
7. **Cursor labels stolen from `<title>`** — XSS via display name.
   Treat names as plain text; no HTML.
8. **Remote cursor intercepts clicks** — `pointer-events-none` is
   mandatory.
9. **Animating cursor without `prefers-reduced-motion` check** —
   accessibility regression; vestibular trigger.
10. **Presence rooms not authorized** — anyone can enumerate any
    room. Authorize subscription by user's permission to view the
    underlying resource.
11. **Echoing user's own state back to themselves** — UI flickers
    on every keystroke. Filter by clientId.
12. **No upper bound on room size** — 1000-user doc → awareness
    payload ~2MB per peer per change → all browsers freeze.
13. **Cross-region awareness sync** — high latency makes cursors
    feel laggy and unsynchronized. Per-region rooms with cross-
    region bridge for "X others elsewhere" badge.
14. **No SSE heartbeat** — proxies (nginx/CloudFront) close idle
    connections after 30-60s; clients see disconnects.
15. **`cache-control` missing on SSE** — intermediaries cache the
    initial snapshot; later clients see stale members.
16. **`x-accel-buffering: no` missing** — nginx buffers the SSE
    stream; events arrive in batches every few seconds.
17. **`subscribe` server endpoint not rate-limited** — connection
    flood DoS.
18. **Reconnection without backoff** — server restart → all clients
    reconnect simultaneously → thundering herd.
19. **Awareness state used for in-app messages** — wrong tool;
    awareness has no delivery guarantees. Use real messaging.
20. **Storing typing-indicator timeout state on the server** — race
    conditions, drift. Compute timeout client-side; broadcast
    `typing: false` after inactivity.
21. **Per-user cursor color chosen by client** — colorblind
    coincidences (red+green users overlap). Server-assigned from
    palette.
22. **No "you" indicator** — users see N cursors but can't tell
    which is theirs. Always render local cursor differently or omit.
23. **No collapse / overflow ("3 others") for crowded rooms** —
    50-avatar bar overflows the UI.
24. **Presence cardinality not observed** — silent capacity
    failure. Emit `presence_room_size` gauge per
    [observability.md](observability.md).

## References

- ADRs: [0009](../adr/0009-collab-yjs.md),
  [0037](../adr/0037-sse-vs-websocket.md),
  [0034](../adr/0034-cookies-auth-boundary.md)
- Sibling recipes:
  [collab.md](collab.md),
  [sse.md](sse.md),
  [websocket.md](websocket.md),
  [collab-persistence.md](collab-persistence.md),
  [observability.md](observability.md),
  [rate-limiting.md](rate-limiting.md),
  [theming.md](theming.md),
  [a11y-audit-runbook.md](a11y-audit-runbook.md)
- Upstream:
  Yjs Awareness `docs.yjs.dev/getting-started/adding-awareness`,
  y-protocols/awareness `github.com/yjs/y-protocols`,
  Server-Sent Events spec `html.spec.whatwg.org/multipage/server-sent-events.html`,
  WCAG 2.3.3 (Animation from Interactions)
  `www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html`,
  prefers-reduced-motion
  `developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion`.
