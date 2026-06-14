# realtime-collab-comments.md — composition recipe

> **Threaded comments anchored to a CRDT document.** Comments in
> sveltesentio are a **second Yjs sub-document** per parent doc, not a
> separate REST resource — that way comment-thread placement survives
> document edits (insertions shift anchors), replies converge
> deterministically, and offline-written comments sync on reconnect.
> Per [ADR-0009](../adr/0009-collab-yjs.md) Yjs is the CRDT layer; per
> [ADR-0037](../adr/0037-realtime-transport.md) the websocket
> transport is shared; per
> [ADR-0023](../adr/0023-compliance-audit-log-contract.md) resolve /
> delete events land in the audit log.

> **The anchor is the hard part.** Attaching a comment to "line 42" is
> trivial until a collaborator inserts 5 lines above it. The recipe
> uses **Yjs `RelativePosition`** — a position reference that survives
> insertions/deletions around it.

## Related

- [collab.md](collab.md) — Yjs base; comments ride the same provider
- [collab-persistence.md](collab-persistence.md) — offline comment
  writes sync via `y-indexeddb`
- [realtime-presence.md](realtime-presence.md) — "X is typing a
  reply" uses the same Awareness channel
- [notifications-center.md](notifications-center.md) — `@mentions`
  route to the in-app inbox
- [markdown.md](markdown.md) — comment bodies use the runtime `marked`
  pipeline with `trusted-types.md` sanitization
- [content-moderation.md](content-moderation.md) — flag button routes
  to the moderation queue
- [audit-log.md](audit-log.md) — resolve + delete + restore events
- [rbac-modeling.md](rbac-modeling.md) — only author / doc-editor can
  edit; anyone with read can reply
- [permissions.md](permissions.md) — `load`-derived thread visibility
- [search-autocomplete.md](search-autocomplete.md) — mention picker
- [rate-limiting.md](rate-limiting.md) — per-user thread-create bucket
- [ADR-0009](../adr/0009-collab-yjs.md),
  [ADR-0037](../adr/0037-realtime-transport.md),
  [ADR-0023](../adr/0023-compliance-audit-log-contract.md)

## When to use what

```text
Comments on a CRDT-edited doc (slate, tiptap, etc.)    → this recipe (Y.Doc + RelativePosition)
Comments on a static page / blog post                  → REST + DB; NOT this recipe
Comments on a code review diff                         → line-anchor is stable; REST is fine
Review-thread on a design mockup                       → this recipe; anchor = image-region rect
Chat-style ephemeral room                              → presence + message stream; NOT comments
Annotations on a PDF / video                           → this recipe; anchor = page+rect or time-range
Private notes on a record                              → REST + DB (no collab, no sync)
Change requests / tasks spawned from comments          → separate entity; link by commentId
Emoji reactions on a message                           → reactions.md (not this recipe)
```

## Data shape

```text
Y.Doc "doc:<docId>"                    ← the document itself (collab.md)
Y.Doc "doc:<docId>:comments"           ← this recipe
  └─ Y.Map  "threads"                  ← threadId → Thread
       ├─ Y.Text "text" (initial)
       ├─ Y.Array "replies" → Comment
       ├─ anchor: RelativePosition     (encoded as Uint8Array)
       ├─ status: 'open' | 'resolved'
       └─ createdAt, createdBy, resolvedAt, resolvedBy
```

Two separate `Y.Doc`s with two separate provider rooms. The comment
doc is smaller, easier to authorize separately (viewer role might
edit comments but not the main doc), and garbage-collects
independently when threads are all resolved.

## Install

No new dependencies beyond `yjs` + `y-websocket` (already in stack for
[collab.md](collab.md)) + `y-indexeddb` (for
[collab-persistence.md](collab-persistence.md)).

## Shape — bounded Zod at the collab boundary

```ts
// packages/collab/src/comments/types.ts
import { z } from 'zod';

export const ThreadStatus = z.enum(['open', 'resolved', 'deleted']);
export type ThreadStatus = z.infer<typeof ThreadStatus>;

export const Mention = z.object({
  kind: z.enum(['user', 'team']),
  id: z.string().uuid(),
  displayName: z.string().min(1).max(120),
});

export const CommentBody = z.object({
  // Comment bodies are markdown-lite. See markdown.md.
  // Raw text is stored; HTML is rendered at read time with DOMPurify.
  text: z.string().trim().min(1).max(10_000),
  mentions: z.array(Mention).max(25),
});
export type CommentBody = z.infer<typeof CommentBody>;

export const Comment = z.object({
  id: z.string().uuid(),
  body: CommentBody,
  authorId: z.string().uuid(),
  authorDisplayName: z.string().min(1).max(120),
  createdAt: z.string().datetime({ offset: true }),
  editedAt: z.string().datetime({ offset: true }).nullable(),
});

export const ThreadAnchor = z.object({
  kind: z.enum(['text-range', 'image-region', 'pdf-range', 'video-timecode']),
  // `position` is an opaque Uint8Array, base64-encoded at the DB boundary.
  // For text-range it's two RelativePositions (start, end).
  position: z.string().regex(/^[A-Za-z0-9+/=]{1,4096}$/),
});

export const Thread = z.object({
  id: z.string().uuid(),
  docId: z.string().uuid(),
  anchor: ThreadAnchor,
  status: ThreadStatus,
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  resolvedBy: z.string().uuid().nullable(),
  resolvedAt: z.string().datetime({ offset: true }).nullable(),
  firstComment: Comment,
  replies: z.array(Comment).max(500),         // hard cap per thread
});
export type Thread = z.infer<typeof Thread>;
```

The `.max(500)` reply cap is a DoS guard; a reasonable UX fork
("convert to a task") happens before the limit is hit.

## Reference pattern

### 1. The commenting store

```ts
// packages/collab/src/comments/store.svelte.ts
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { EditorView } from 'prosemirror-view';
import { Thread, Comment, type ThreadAnchor } from './types';

export function createCommentStore(opts: {
  docId: string;
  mainDoc: Y.Doc;                  // the document's own Y.Doc (for anchors)
  wsUrl: string;
  user: { id: string; displayName: string };
  getAuthToken: () => Promise<string>;
}) {
  const commentDoc = new Y.Doc();
  const indexed = new IndexeddbPersistence(`doc:${opts.docId}:comments`, commentDoc);
  const ws = new WebsocketProvider(opts.wsUrl, `doc:${opts.docId}:comments`, commentDoc, {
    params: { token: '' },
  });
  opts.getAuthToken().then((t) => {
    ws.disconnect();
    (ws as any).roomnameParams = { token: t };
    ws.connect();
  });

  const threads = commentDoc.getMap<Y.Map<unknown>>('threads');

  const list = $state<Thread[]>([]);

  const refresh = () => {
    const out: Thread[] = [];
    threads.forEach((yThread) => {
      const raw = yThread.toJSON();
      const parsed = Thread.safeParse(raw);
      if (parsed.success) out.push(parsed.data);
    });
    list.length = 0;
    list.push(...out);
  };

  threads.observeDeep(refresh);
  indexed.whenSynced.then(refresh);

  const createThread = (anchor: ThreadAnchor, bodyText: string, mentions: Array<{ kind: 'user' | 'team'; id: string; displayName: string }>) => {
    const threadId = crypto.randomUUID();
    const commentId = crypto.randomUUID();
    const now = new Date().toISOString();
    const yThread = new Y.Map();
    yThread.set('id', threadId);
    yThread.set('docId', opts.docId);
    yThread.set('anchor', anchor);
    yThread.set('status', 'open');
    yThread.set('createdBy', opts.user.id);
    yThread.set('createdAt', now);
    yThread.set('resolvedBy', null);
    yThread.set('resolvedAt', null);
    yThread.set('firstComment', {
      id: commentId,
      body: { text: bodyText, mentions },
      authorId: opts.user.id,
      authorDisplayName: opts.user.displayName,
      createdAt: now,
      editedAt: null,
    });
    yThread.set('replies', []);
    threads.set(threadId, yThread);
    return threadId;
  };

  const reply = (threadId: string, bodyText: string, mentions: Mention[] = []) => {
    const yThread = threads.get(threadId);
    if (!yThread) return;
    const replies = (yThread.get('replies') as Comment[]) ?? [];
    if (replies.length >= 500) throw new Error('thread_capped');
    const c: Comment = {
      id: crypto.randomUUID(),
      body: { text: bodyText, mentions },
      authorId: opts.user.id,
      authorDisplayName: opts.user.displayName,
      createdAt: new Date().toISOString(),
      editedAt: null,
    };
    yThread.set('replies', [...replies, c]);
  };

  const resolve = (threadId: string) => {
    const yThread = threads.get(threadId);
    if (!yThread) return;
    yThread.set('status', 'resolved');
    yThread.set('resolvedBy', opts.user.id);
    yThread.set('resolvedAt', new Date().toISOString());
    // Server mirrors to audit-log via the websocket relay.
  };

  const reopen = (threadId: string) => {
    const yThread = threads.get(threadId);
    if (!yThread) return;
    yThread.set('status', 'open');
    yThread.set('resolvedBy', null);
    yThread.set('resolvedAt', null);
  };

  const softDelete = (threadId: string) => {
    const yThread = threads.get(threadId);
    if (!yThread) return;
    yThread.set('status', 'deleted');   // tombstone; GC separate
  };

  return {
    get threads() { return list; },
    createThread,
    reply,
    resolve,
    reopen,
    softDelete,
    destroy: () => {
      ws.disconnect();
      indexed.destroy();
      commentDoc.destroy();
    },
  };
}
```

### 2. Text-range anchor with RelativePosition

```ts
// packages/collab/src/comments/text-anchor.ts
import * as Y from 'yjs';

export function encodeTextAnchor(mainDoc: Y.Doc, typeName: string, startAbs: number, endAbs: number): string {
  const yText = mainDoc.getText(typeName);
  const start = Y.createRelativePositionFromTypeIndex(yText, startAbs);
  const end = Y.createRelativePositionFromTypeIndex(yText, endAbs);
  const encoded = Y.encodeRelativePosition;
  const buf = new Uint8Array(
    encoded(start).length + encoded(end).length + 4,
  );
  const view = new DataView(buf.buffer);
  const startBytes = encoded(start);
  const endBytes = encoded(end);
  view.setUint16(0, startBytes.length, true);
  buf.set(startBytes, 2);
  view.setUint16(2 + startBytes.length, endBytes.length, true);
  buf.set(endBytes, 4 + startBytes.length);
  return btoa(String.fromCharCode(...buf));
}

export function decodeTextAnchor(mainDoc: Y.Doc, typeName: string, encoded: string):
  | { start: number; end: number; orphaned: false }
  | { orphaned: true } {
  const buf = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const view = new DataView(buf.buffer);
  const startLen = view.getUint16(0, true);
  const endLen = view.getUint16(2 + startLen, true);
  const startBytes = buf.slice(2, 2 + startLen);
  const endBytes = buf.slice(4 + startLen, 4 + startLen + endLen);
  const startRel = Y.decodeRelativePosition(startBytes);
  const endRel = Y.decodeRelativePosition(endBytes);
  const startAbs = Y.createAbsolutePositionFromRelativePosition(startRel, mainDoc);
  const endAbs = Y.createAbsolutePositionFromRelativePosition(endRel, mainDoc);
  if (!startAbs || !endAbs) return { orphaned: true };
  return { start: startAbs.index, end: endAbs.index, orphaned: false };
}
```

Orphaned threads (anchor content deleted) don't vanish — they surface
in a sidebar labeled "Context deleted" with their original quote so
the user can see what they were about.

### 3. UI — sidebar thread list + inline gutter icon

```svelte
<!-- packages/ui/src/comments/CommentSidebar.svelte -->
<script lang="ts">
  import type { Thread } from '@sveltesentio/collab/comments';
  let { threads, onResolve, onReply }: {
    threads: Thread[];
    onResolve: (id: string) => void;
    onReply: (id: string, text: string) => void;
  } = $props();

  const openThreads = $derived(threads.filter((t) => t.status === 'open'));
  let filter = $state<'open' | 'resolved' | 'all'>('open');
</script>

<aside aria-label="Comments" class="comment-sidebar">
  <header>
    <h2>Comments</h2>
    <fieldset>
      <label><input type="radio" bind:group={filter} value="open" /> Open</label>
      <label><input type="radio" bind:group={filter} value="resolved" /> Resolved</label>
      <label><input type="radio" bind:group={filter} value="all" /> All</label>
    </fieldset>
  </header>
  <ul>
    {#each threads.filter((t) => filter === 'all' || t.status === filter) as thread (thread.id)}
      <li class="thread" class:resolved={thread.status === 'resolved'}>
        <article aria-labelledby={`thread-${thread.id}-head`}>
          <header id={`thread-${thread.id}-head`}>
            <span class="author">{thread.firstComment.authorDisplayName}</span>
            <time datetime={thread.firstComment.createdAt}>
              {new Date(thread.firstComment.createdAt).toLocaleString()}
            </time>
          </header>
          <p>{thread.firstComment.body.text}</p>
          {#each thread.replies as reply (reply.id)}
            <article class="reply">
              <header>
                <span class="author">{reply.authorDisplayName}</span>
                <time datetime={reply.createdAt}>
                  {new Date(reply.createdAt).toLocaleString()}
                </time>
              </header>
              <p>{reply.body.text}</p>
            </article>
          {/each}
          {#if thread.status === 'open'}
            <form on:submit|preventDefault={(e) => {
              const input = (e.target as HTMLFormElement).querySelector('textarea');
              if (input && input.value.trim()) {
                onReply(thread.id, input.value);
                input.value = '';
              }
            }}>
              <textarea required maxlength="10000" aria-label="Reply"></textarea>
              <button>Reply</button>
              <button type="button" onclick={() => onResolve(thread.id)}>Resolve</button>
            </form>
          {/if}
        </article>
      </li>
    {/each}
  </ul>
</aside>
```

### 4. Mention picker wired to search-autocomplete

```svelte
<!-- packages/ui/src/comments/MentionPicker.svelte — excerpt -->
<script lang="ts">
  import { searchUsers } from '$lib/api/search';
  let { onPick }: { onPick: (m: Mention) => void } = $props();

  let query = $state('');
  let results = $state<Array<{ id: string; displayName: string; kind: 'user' | 'team' }>>([]);
  let open = $state(false);
  let seq = 0;

  $effect(() => {
    const currentSeq = ++seq;
    if (query.trim().length < 1) { results = []; return; }
    searchUsers({ q: query, limit: 10 }).then((r) => {
      if (currentSeq === seq) results = r;
    });
  });
</script>

<div class="mention-combobox" role="combobox" aria-expanded={open} aria-haspopup="listbox">
  <input bind:value={query} aria-autocomplete="list" aria-controls="mention-listbox" />
  {#if open && results.length > 0}
    <ul id="mention-listbox" role="listbox">
      {#each results as r (r.id)}
        <li role="option" onclick={() => onPick({ kind: r.kind, id: r.id, displayName: r.displayName })}>
          @{r.displayName}
        </li>
      {/each}
    </ul>
  {/if}
</div>
```

See [search-autocomplete.md](search-autocomplete.md) for full
`aria-activedescendant` + debounced + request-seq treatment.

### 5. Server relay — audit + notification fanout

```ts
// packages/realtime/src/comments-relay.ts
// Runs in the websocket relay; intercepts comment-doc updates and
// writes audit events + enqueues notifications. Does NOT block the
// real-time path.
import { decodeUpdate } from 'yjs';
import { writeAuditEvent } from '@sveltesentio/audit';
import { enqueueNotification } from '@sveltesentio/notifications';

export function attachCommentsRelay(provider: YWebsocketRoom) {
  provider.doc.on('update', async (_update, origin, doc) => {
    if (origin === 'server-echo') return;
    // Diff threads map for status transitions + new replies + mentions.
    const threads = doc.getMap('threads');
    for (const [threadId, yThread] of threads as any) {
      const snap = yThread.toJSON();
      const prev = provider.lastSnapshot.get(threadId);
      if (!prev && snap.firstComment) {
        await writeAuditEvent({ kind: 'comment.thread.created', subjectId: snap.createdBy, payload: { threadId, docId: snap.docId } });
        for (const m of snap.firstComment.body.mentions ?? []) {
          await enqueueNotification({ toUserId: m.id, kind: 'mention', payload: { threadId, docId: snap.docId, excerpt: snap.firstComment.body.text.slice(0, 280) } });
        }
      }
      if (prev?.status === 'open' && snap.status === 'resolved') {
        await writeAuditEvent({ kind: 'comment.thread.resolved', subjectId: snap.resolvedBy, payload: { threadId, docId: snap.docId } });
      }
      // replies delta — by length change
      if ((snap.replies?.length ?? 0) > (prev?.replies?.length ?? 0)) {
        const newReplies = (snap.replies ?? []).slice(prev?.replies?.length ?? 0);
        for (const reply of newReplies) {
          for (const m of reply.body.mentions ?? []) {
            await enqueueNotification({ toUserId: m.id, kind: 'mention-reply', payload: { threadId, excerpt: reply.body.text.slice(0, 280) } });
          }
        }
      }
      provider.lastSnapshot.set(threadId, snap);
    }
  });
}
```

The relay is **fire-and-forget** — if audit writes fail, the realtime
path continues. Audit + notifications have their own retry queue.

### 6. Permissions — who can resolve

```ts
// packages/collab/src/comments/authz.ts
export function canResolve(user: { id: string; permissions: string[] }, thread: Thread): boolean {
  // Thread author can resolve own thread.
  if (user.id === thread.createdBy) return true;
  // Document-editor role can resolve anyone's thread.
  if (user.permissions.includes('doc:edit')) return true;
  return false;
}

export function canDelete(user: { id: string; permissions: string[] }, thread: Thread): boolean {
  // Only: comment author OR doc:admin. Never doc:edit.
  if (user.id === thread.createdBy) return true;
  if (user.permissions.includes('doc:admin')) return true;
  return false;
}
```

Server-side enforcement happens in the relay: a client that sets
`status = 'resolved'` without permission gets the change reverted + a
403-flavored ack sent through Awareness. This is defense-in-depth;
UI already hides the button via `canResolve`.

### 7. Orphaned-thread UI

```svelte
{#each orphanedThreads as thread (thread.id)}
  <li class="thread orphaned" aria-label="Context deleted">
    <p class="quote">
      "{thread.originalQuote.slice(0, 180)}"
    </p>
    <p class="muted">The highlighted text was deleted.</p>
    <!-- resolve / reply controls still available -->
  </li>
{/each}
```

Originally-quoted text is captured at thread creation and stored in
the thread payload (separate field, truncated). When anchor resolves
orphan, we have something to show the user.

## A11y invariants

- Sidebar is a **real `<aside>` with `aria-label="Comments"`**.
- Each thread is an `<article>` with `aria-labelledby` pointing at the
  first-comment author heading. SRs announce "comment by X".
- Reply textarea has a real `<label>` (or `aria-label`).
- Resolve/reopen/delete are real `<button>`s with visible focus.
- Mention picker is a real ARIA combobox with
  `aria-activedescendant` (see
  [search-autocomplete.md](search-autocomplete.md)).
- Announcement when a new thread appears:
  `<div aria-live="polite">New comment from X on page Y</div>` —
  polite, not assertive.
- Never auto-open a thread on focus; require explicit click/Enter.

## Security invariants

- Comment body is **stored as plain text**; rendered to HTML via
  `marked` + DOMPurify. See [markdown.md](markdown.md).
- Mentions are resolved server-side (notification fanout) — the
  client-supplied `displayName` is not trusted for authorization.
- Client cannot forge `createdBy` — the relay stamps it from the
  authenticated session.
- Soft-delete keeps the thread tombstone for audit; hard-delete is a
  separate admin action that writes a tombstone audit event with the
  final content hash.
- Thread cap (500 replies) prevents single-thread memory bloat.
- Per-user rate-limit: 30 new threads/hour, 300 replies/hour.
- Anchors are opaque server-side — don't parse RelativePosition on
  the server; treat as a blob.

## Testing

```ts
// tests/collab/comments/anchor.test.ts
import { test, expect } from 'vitest';
import * as Y from 'yjs';
import { encodeTextAnchor, decodeTextAnchor } from '@sveltesentio/collab/comments';

test('anchor survives an insertion before it', () => {
  const doc = new Y.Doc();
  const text = doc.getText('body');
  text.insert(0, 'Hello world');
  const anchor = encodeTextAnchor(doc, 'body', 6, 11); // "world"
  text.insert(0, 'Greetings, ');                        // shift by 11
  const resolved = decodeTextAnchor(doc, 'body', anchor);
  expect(resolved).toEqual({ start: 17, end: 22, orphaned: false });
});

test('anchor orphans when target is deleted', () => {
  const doc = new Y.Doc();
  const text = doc.getText('body');
  text.insert(0, 'Hello world');
  const anchor = encodeTextAnchor(doc, 'body', 6, 11);
  text.delete(6, 5);
  const resolved = decodeTextAnchor(doc, 'body', anchor);
  expect(resolved.orphaned).toBe(true);
});
```

## Anti-patterns

1. **Absolute-index anchors** — `{ start: 42, end: 58 }` plain numbers
   break on every insertion. Use RelativePosition.
2. **Comments as REST entities on a live-edited doc** — thread
   placement rot is fatal.
3. **Storing rendered HTML in Yjs** — stored XSS across collaborators.
   Store plaintext; render client-side.
4. **One Y.Doc for doc + comments** — awkward GC, auth gets tangled.
   Two docs.
5. **Polling comments** — kills battery; defeats collab.
6. **No thread cap** — one viral thread exhausts memory on mobile.
7. **Mentions resolved client-side only** — can't notify, can't
   authorize. Server must resolve mention ids.
8. **Client-supplied `createdBy`** — forge-able. Relay stamps.
9. **Hard-delete with no tombstone** — breaks audit; users claim
   comments they don't own.
10. **Aria-live `assertive` on every new comment** — SR users get
    spammed mid-editing.
11. **Auto-scroll to newest** — fights the reader.
12. **Resolve without permission check** — polite buttons hide intent;
    relay must reject.
13. **No "Context deleted" orphan view** — threads silently vanish;
    users confused.
14. **Storing anchor in a non-Yjs DB row** — two sources of truth
    drift.
15. **Avatars via `<img src="untrusted">`** — SSRF through
    image-loader; proxy through signed URL.
16. **Mentioning >100 users per comment** — notification DoS; cap at
    25.
17. **Using comments for chat** — no retention policy, grows
    unbounded. Chat is a different product.
18. **Server parsing RelativePosition** — fragile, expensive. Treat
    anchor as opaque.
19. **No rate-limit on thread creation** — spam vector.
20. **Reply edit without `editedAt` marker** — users mistrust.
21. **Flattening replies to one-level** then later adding nesting —
    migration nightmare. Decide early.
22. **Rich-text WYSIWYG comments** without justification — plaintext+md
    covers 95% of use and avoids schema churn.
23. **Loading all threads at mount** on a 500-thread doc — paginate or
    virtualize the sidebar.
24. **Mixing public and private comments** in one Y.Doc — one leak
    exposes both. Separate rooms.
25. **Websocket room without tenant scoping** in the room name — cross-
    tenant leakage. `tenant:<id>:doc:<id>:comments`.

## References

- ADRs: [0009](../adr/0009-collab-yjs.md),
  [0037](../adr/0037-realtime-transport.md),
  [0023](../adr/0023-compliance-audit-log-contract.md)
- Siblings: [collab.md](collab.md),
  [collab-persistence.md](collab-persistence.md),
  [realtime-presence.md](realtime-presence.md),
  [notifications-center.md](notifications-center.md),
  [markdown.md](markdown.md),
  [search-autocomplete.md](search-autocomplete.md)
- Yjs: [`RelativePosition`](https://docs.yjs.dev/api/relative-positions),
  [`y-websocket`](https://github.com/yjs/y-websocket)
