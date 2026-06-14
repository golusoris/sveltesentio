# Offline-first — conflict resolution, queue replay, IndexedDB layer

> Client-first write semantics with durable local storage, optimistic
> UI, and convergent reconciliation against the server per
> [ADR-0028](../adr/0028-pwa-vite-sveltekit.md) (PWA shell) and
> [ADR-0009](../adr/0009-collab-yjs-ywebsocket.md) (CRDT delegate for
> concurrent-edit domains).

Offline-first is **not** "works without network" — it is **"writes are
accepted locally, queued, and reconciled"**. The queue half (HTTP
offline POSTs) lives in [background-sync.md](background-sync.md). The
state-sync half — IndexedDB store, optimistic mutations,
conflict-resolution UX — lives here. For multi-user concurrent edits,
delegate to [collab-persistence.md](collab-persistence.md) (Yjs +
`y-indexeddb`); CRDT is the right tool when concurrency is the norm,
not the exception.

## Related

- [background-sync.md](background-sync.md) — HTTP queue layer
  (Idempotency-Key + Workbox)
- [pwa.md](pwa.md) — Service Worker install + manifest
- [collab-persistence.md](collab-persistence.md) — CRDT-backed offline
  escape for multi-user concurrent edits
- [http-client.md](http-client.md) — Idempotency-Key contract
- [server-state.md](server-state.md) — TanStack Query cache as
  optimistic source of truth
- [ADR-0028](../adr/0028-pwa-vite-sveltekit.md) — `@vite-pwa/sveltekit`
- [ADR-0009](../adr/0009-collab-yjs-ywebsocket.md) — Yjs governance

## When to use what — decision tree

```text
Read-only content that must survive offline     → pwa.md (precache)
Offline form submissions, fire-and-forget       → background-sync.md
Offline form submissions with local query/view  → THIS recipe
Multi-user concurrent edits                     → collab-persistence.md
Large blob/media offline                        → file-system-access.md
```

## Install

```bash
pnpm add idb
# or, if you need observable queries + schema migrations at scale:
pnpm add dexie
```

We default to `idb` (3 kB, minimal promise wrapper over IndexedDB).
`dexie` (~25 kB) is the ESCAPE when the app has ≥8 object stores, live
queries, or schema migrations across many versions.

## Three build rules

1. **Single source of truth is IndexedDB in offline mode.** Never
   mirror state into a Svelte store and trust the store — the store is
   derived view, IDB is authoritative.
2. **Every mutation is idempotent.** Queue replays after reconnect MUST
   be safe to run twice (via `Idempotency-Key`).
3. **Conflict resolution is domain-specific.** There is no generic
   "merge" — pick LWW, server-wins, manual-merge, or CRDT per table.

## Shape

### Bounded sync state

```ts
// src/lib/sync/types.ts
import { z } from 'zod';

export const SyncStatus = z.enum([
  'pending',   // local only, not yet sent
  'syncing',   // in flight
  'synced',    // server ack'd
  'conflict',  // server rejected or returned divergence
  'failed',    // permanent failure after retries
]);
export type SyncStatus = z.infer<typeof SyncStatus>;

export const ConflictStrategy = z.enum([
  'last_write_wins',
  'server_wins',
  'client_wins',
  'manual_merge',
  'crdt',
]);
export type ConflictStrategy = z.infer<typeof ConflictStrategy>;

export const PendingMutation = z.object({
  id: z.string().uuid(),            // UUIDv7 — order-preserving
  resource: z.string(),             // bounded enum in real code
  op: z.enum(['create', 'update', 'delete']),
  payload: z.unknown(),
  baseVersion: z.string().nullable(),
  createdAt: z.string().datetime(),
  attemptCount: z.number().int().min(0),
  lastError: z.string().nullable(),
});
export type PendingMutation = z.infer<typeof PendingMutation>;
```

### IndexedDB layer

```ts
// src/lib/sync/db.ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PendingMutation, SyncStatus } from './types';

interface AppDB extends DBSchema {
  documents: {
    key: string;
    value: {
      id: string;
      version: string;           // server-assigned ETag/version
      data: unknown;
      status: SyncStatus;
      updatedAt: string;
    };
    indexes: { 'by-status': SyncStatus };
  };
  mutations: {
    key: string;
    value: PendingMutation;
    indexes: { 'by-created': string };
  };
  meta: {
    key: string;
    value: { key: string; value: unknown };
  };
}

let dbPromise: Promise<IDBPDatabase<AppDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<AppDB>> {
  if (dbPromise) return dbPromise;
  dbPromise = openDB<AppDB>('sveltesentio', 1, {
    upgrade(db) {
      const docs = db.createObjectStore('documents', { keyPath: 'id' });
      docs.createIndex('by-status', 'status');

      const muts = db.createObjectStore('mutations', { keyPath: 'id' });
      muts.createIndex('by-created', 'createdAt');

      db.createObjectStore('meta', { keyPath: 'key' });
    },
  });
  return dbPromise;
}
```

Five IDB rules:

1. **Version your schema from day 1** — even v1 declares an `upgrade`.
2. **Index what you query**, not what you display. `by-status` is
   needed for the sync worker; `by-title` for display is premature.
3. **Never open the DB inside a loop** — cache the promise.
4. **Transactions are per-tick** — do not `await` between
   `transaction()` and the stores it uses (IDB spec auto-commits).
5. **Close the DB on logout** if PII leaves with the user — call
   `db.close()` and delete via `indexedDB.deleteDatabase()`.

### Optimistic mutation flow

```ts
// src/lib/sync/mutate.ts
import { uuidv7 } from 'uuidv7';
import { getDB } from './db';
import type { PendingMutation } from './types';

export async function mutateLocal(
  input: Omit<PendingMutation, 'id' | 'createdAt' | 'attemptCount' | 'lastError'>,
): Promise<string> {
  const db = await getDB();
  const tx = db.transaction(['documents', 'mutations'], 'readwrite');
  const mutId = uuidv7();

  const docId = resolveDocId(input);
  const existing = await tx.objectStore('documents').get(docId);

  const nextVersion = `local:${mutId}`;
  await tx.objectStore('documents').put({
    id: docId,
    version: nextVersion,
    data: applyOp(existing?.data, input),
    status: 'pending',
    updatedAt: new Date().toISOString(),
  });

  await tx.objectStore('mutations').put({
    id: mutId,
    resource: input.resource,
    op: input.op,
    payload: input.payload,
    baseVersion: existing?.version ?? null,
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    lastError: null,
  });

  await tx.done;
  queueMicrotask(() => kickSyncWorker());
  return mutId;
}
```

Six optimistic-flow rules:

1. **Local write and mutation log in one transaction** — partial state
   is the most common offline-first bug.
2. **`baseVersion` is captured at mutation time**, not at sync time —
   it is what the server uses for conflict detection.
3. **Version-tag local state with `local:<mutId>`** so UI can
   distinguish "saved" vs "saving" without a parallel flag.
4. **`kickSyncWorker()` is a nudge, not a wait** — the caller returns
   immediately so UI stays responsive.
5. **Do not show "Saved ✓" until server-ack** — show "Saved locally" +
   queue indicator; promote to "Synced" when status=`synced`.
6. **On delete, keep a tombstone row** (`status: 'pending'` with
   `op: 'delete'`) so the sync worker can replay — never hard-delete
   until server ack.

### Sync worker

```ts
// src/lib/sync/worker.ts
import { getDB } from './db';
import { apiFetch } from '$lib/api/client'; // openapi-fetch — see http-client.md

let running = false;

export async function runSyncWorker(): Promise<void> {
  if (running || !navigator.onLine) return;
  running = true;
  try {
    const db = await getDB();
    const pending = await db.getAllFromIndex('mutations', 'by-created');
    for (const mut of pending) {
      await replayOne(mut);
    }
  } finally {
    running = false;
  }
}

async function replayOne(mut: PendingMutation): Promise<void> {
  const db = await getDB();
  try {
    const res = await apiFetch(mut.resource, {
      method: methodFor(mut.op),
      body: JSON.stringify(mut.payload),
      headers: {
        'Idempotency-Key': mut.id,
        'If-Match': mut.baseVersion ?? '*',
      },
    });
    if (res.status === 409) {
      await recordConflict(mut, await res.json());
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    await applyServerAck(mut, body);
  } catch (err) {
    await recordAttempt(mut, err);
  }
}
```

Seven sync-worker rules:

1. **Process sequentially by `createdAt`** — parallel replay can
   violate causal order (edit → delete race).
2. **`Idempotency-Key` is the mutation `id`** (UUIDv7) — the server's
   `idempotency_keys` table dedupes retries.
3. **`If-Match` enforces optimistic concurrency** — the server returns
   409 if the resource moved past `baseVersion`.
4. **Treat 409 as conflict-not-retry** — it goes to conflict queue,
   not back into the replay loop.
5. **Exponential backoff with jitter** on network errors — do not
   retry 4xx (client bug), do retry 5xx and network errors.
6. **Cap attempts at 10 then mark `failed`** — failed mutations surface
   in UI with "Discard" and "Retry" actions.
7. **Online/offline transitions wake the worker** via
   `addEventListener('online', runSyncWorker)` + periodic
   `setInterval` fallback (30 s) for detection-misses.

### Conflict resolution strategies

```ts
// src/lib/sync/conflicts.ts
import type { ConflictStrategy } from './types';

export interface ConflictInput {
  local: unknown;
  server: unknown;
  ancestor: unknown | null;
  mutation: PendingMutation;
}

export type ConflictResult =
  | { action: 'apply_server' }
  | { action: 'apply_local' }
  | { action: 'merged'; value: unknown }
  | { action: 'needs_user' };

export function resolve(
  strategy: ConflictStrategy,
  input: ConflictInput,
): ConflictResult {
  switch (strategy) {
    case 'last_write_wins':
      return { action: 'apply_server' };
    case 'server_wins':
      return { action: 'apply_server' };
    case 'client_wins':
      return { action: 'apply_local' };
    case 'manual_merge':
      return { action: 'needs_user' };
    case 'crdt':
      throw new Error('CRDT conflicts are resolved by Yjs — see collab-persistence.md');
  }
}
```

Five conflict-strategy rules:

1. **Pick per-resource, not globally** — `users` = server-wins,
   `notes` = manual-merge, `cursors` = CRDT.
2. **Last-write-wins is dangerous without vector clocks** — prefer
   server-wins unless you truly want latest-timestamp-wins.
3. **Manual-merge requires the three-way-merge UI** — show local,
   server, and ancestor side-by-side with per-field selection.
4. **Never auto-merge free-text without CRDT** — truncation races
   destroy user data silently.
5. **Delete-vs-update conflicts resolve as "server-delete wins"** by
   default — local update on a server-deleted row is dropped with a
   user toast explaining the outcome.

### Manual-merge UI

```svelte
<!-- src/lib/sync/ConflictDialog.svelte -->
<script lang="ts">
  import { Dialog, DialogContent } from '$lib/ui/dialog';
  import * as m from '$lib/paraglide/messages';

  type Props = {
    open: boolean;
    local: Record<string, unknown>;
    server: Record<string, unknown>;
    ancestor: Record<string, unknown> | null;
    onResolve: (merged: Record<string, unknown>) => void;
    onCancel: () => void;
  };
  const { open, local, server, ancestor, onResolve, onCancel }: Props = $props();

  const fieldKeys = $derived(
    Array.from(new Set([...Object.keys(local), ...Object.keys(server)])),
  );
  const selections = $state<Record<string, 'local' | 'server'>>({});

  function applyMerge() {
    const merged: Record<string, unknown> = {};
    for (const k of fieldKeys) {
      merged[k] = selections[k] === 'server' ? server[k] : local[k];
    }
    onResolve(merged);
  }
</script>

<Dialog {open} onClose={onCancel}>
  <DialogContent aria-label={m.conflict_dialog_title()}>
    <h2>{m.conflict_dialog_title()}</h2>
    <table>
      <thead>
        <tr>
          <th scope="col">{m.field()}</th>
          <th scope="col">{m.local_version()}</th>
          <th scope="col">{m.server_version()}</th>
        </tr>
      </thead>
      <tbody>
        {#each fieldKeys as key (key)}
          <tr>
            <th scope="row">{key}</th>
            <td>
              <label>
                <input
                  type="radio"
                  name={`field-${key}`}
                  checked={selections[key] === 'local'}
                  onchange={() => (selections[key] = 'local')}
                />
                {String(local[key])}
              </label>
            </td>
            <td>
              <label>
                <input
                  type="radio"
                  name={`field-${key}`}
                  checked={selections[key] === 'server'}
                  onchange={() => (selections[key] = 'server')}
                />
                {String(server[key])}
              </label>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <button onclick={applyMerge}>{m.conflict_dialog_apply()}</button>
    <button onclick={onCancel}>{m.cancel()}</button>
  </DialogContent>
</Dialog>
```

Five manual-merge UI rules:

1. **Three-column table** (field / local / server) with radio per row
   — scrollable but never paginated.
2. **`<th scope="row">` on the field column** for screen readers.
3. **Require explicit choice for every changed field** — disable
   "Apply" until all differences have a selection.
4. **Show ancestor on hover only** — the baseline is reference
   information, not the primary decision axis.
5. **Autosave merge-in-progress** to IDB so closing the tab does not
   lose the partially-chosen merge.

## Offline indicators

```svelte
<!-- src/lib/sync/SyncBadge.svelte -->
<script lang="ts">
  import { syncSummary } from '$lib/sync/store.svelte';
  import * as m from '$lib/paraglide/messages';

  const summary = $derived(syncSummary.value);
</script>

{#if !summary.online}
  <div role="status" aria-live="polite" class="badge-offline">
    {m.offline()} — {summary.pending} {m.pending_mutations()}
  </div>
{:else if summary.pending > 0}
  <div role="status" aria-live="polite" class="badge-syncing">
    {m.syncing()} ({summary.pending})
  </div>
{:else if summary.conflicts > 0}
  <button class="badge-conflict" onclick={summary.openConflicts}>
    {m.conflicts_need_review(summary.conflicts)}
  </button>
{/if}
```

Six indicator rules:

1. **`role="status"` not `role="alert"`** — sync state is a progress
   update, not an emergency.
2. **`aria-live="polite"`** so screen readers announce without
   interrupting.
3. **Always visible when non-synced** — hiding offline state until
   "next save" surprises users.
4. **Conflict is a button, not a passive badge** — make the resolution
   action one click from discovery.
5. **Never use just color** to distinguish states — icon + text.
6. **Paraglide-every-string** per
   [i18n-runtime-strategy.md](i18n-runtime-strategy.md).

## Storage quotas

```ts
// src/lib/sync/quota.ts
export async function checkStorageQuota(): Promise<{
  used: number;
  quota: number;
  percent: number;
}> {
  const est = await navigator.storage.estimate();
  const used = est.usage ?? 0;
  const quota = est.quota ?? 0;
  return { used, quota, percent: quota > 0 ? (used / quota) * 100 : 0 };
}

export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
```

Five quota rules:

1. **Ask for persistence on first write**, not at page load — Chrome
   suppresses the prompt if no user-initiated data exists yet.
2. **Surface usage >80 % in UI** as "Offline storage almost full" with
   a "Free up" action that prunes old synced documents.
3. **Never auto-evict pending mutations** — they represent user intent
   not yet durably saved server-side.
4. **Compress payloads >1 kB** via `CompressionStream('gzip')` before
   storing in IDB when feasible.
5. **Prune synced documents older than 30 days** by default — user can
   opt-in to longer retention per folder.

## Reconnect reconciliation

On reconnect, six rules:

1. **Wake sync worker first**, then re-fetch server state for visible
   views.
2. **Use `If-None-Match` / `ETag`** to avoid re-downloading unchanged
   resources.
3. **Reconcile deletes via tombstone list** — server returns `deletedIds`
   since last sync cursor; client drops matching IDB rows unless they
   have pending local mutations.
4. **Update `lastSyncCursor` atomically** with the batch it covers — a
   partial cursor advance under failure causes data loss.
5. **Show "Syncing…" UX with determinate progress** when the reconnect
   queue >10 items — indeterminate spinners are hostile UX.
6. **Never block UI on reconcile** — views render stale data with a
   badge rather than a full-page spinner.

## Observability

Bounded attributes (never free-form IDs as labels):

- `sync.resource` — bounded enum matching server resources
- `sync.op` — `create|update|delete`
- `sync.outcome` — `synced|conflict|failed|discarded`
- `sync.retry_bucket` — `0|1|2-5|6-10` bucketed, never raw count
- `sync.queue_size` — gauge
- `sync.conflict.strategy` — bounded enum

Alert on: `sync.outcome == 'failed'` rate > 1 %/5min, conflict rate
>5 %/hour, queue_size > 100 per user.

## Testing

```ts
// src/lib/sync/mutate.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { mutateLocal, runSyncWorker } from './index';

beforeEach(() => {
  indexedDB.deleteDatabase('sveltesentio');
});

describe('mutateLocal', () => {
  it('stores doc and mutation atomically', async () => {
    const id = await mutateLocal({
      resource: 'notes',
      op: 'create',
      payload: { title: 'a' },
      baseVersion: null,
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('replays queued mutations in createdAt order', async () => { /* ... */ });
  it('marks 409 as conflict without retrying', async () => { /* ... */ });
  it('retries 5xx with backoff', async () => { /* ... */ });
  it('caps at 10 attempts then marks failed', async () => { /* ... */ });
});
```

Four test lanes:

1. **Unit** with `fake-indexeddb` — pure IDB logic, no network.
2. **Integration** with MSW mocking the HTTP layer and real IDB.
3. **E2E** with Playwright + `context.setOffline(true)` — actual
   offline/online transition behavior.
4. **Chaos** — kill the sync worker mid-replay and verify resumption.

## Anti-patterns

1. **localStorage as offline store** — 5 MB limit, sync API blocks the
   main thread, no transactions.
2. **No transaction around doc + mutation write** — partial-write
   corruption is the #1 offline-first bug.
3. **Retrying 409 forever** — conflict means reconcile, not resend.
4. **Silent last-write-wins** on free-text fields without showing the
   user what changed.
5. **Hard-deleting locally before server-ack** — the replay has no
   target if the user comes back online with a delete queued and an
   edit arriving from another device.
6. **One sync worker per tab** racing the same IDB queue — use the
   Service Worker or BroadcastChannel leader election.
7. **No backoff** on failing replays — hammers the server during
   outages and drains the user's battery.
8. **CRDT for every domain** — overkill for single-user data; adds
   bytes and complexity.
9. **Parallel replay by resource type** without causal ordering —
   edit-delete races cause resurrected ghost rows.
10. **Ignoring `navigator.storage.persist()`** — browser may evict
    queued mutations under pressure without warning.
11. **Merging objects with `{...server, ...local}`** — deep nested
    fields get half-and-half garbage.
12. **Optimistic UI with no rollback path** — if replay fails, the
    view shows "saved" state forever.
13. **Trust `navigator.onLine`** as the sole signal — it lies on
    captive portals; always fall back to fetch-failure detection.
14. **No conflict badge** — users discover divergence only when they
    notice missing data.
15. **Sync cursor advance before batch commit** — partial progress
    under crash corrupts the "what's new" query.

## References

- [ADR-0028 — `@vite-pwa/sveltekit`](../adr/0028-pwa-vite-sveltekit.md)
- [ADR-0009 — Yjs + y-websocket](../adr/0009-collab-yjs-ywebsocket.md)
- [background-sync.md](background-sync.md) — HTTP queue layer
- [collab-persistence.md](collab-persistence.md) — CRDT escape
- [pwa.md](pwa.md) — Service Worker base
- [http-client.md](http-client.md) — Idempotency-Key contract
- [idb on GitHub](https://github.com/jakearchibald/idb)
- [Dexie.js](https://dexie.org/)
- [StorageManager.persist() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)
- [Designing offline-first apps (Chrome Dev)](https://developer.chrome.com/docs/workbox/)
