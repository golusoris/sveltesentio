# Account deletion — GDPR self-serve + grace period + data export

> User-initiated account deletion and data export, compliant with
> GDPR Art. 17 (right to erasure) and Art. 20 (right to portability).
> Composes [consent-management.md](consent-management.md),
> [audit-log.md](audit-log.md),
> [backup-recovery.md](backup-recovery.md),
> [queue-workers.md](queue-workers.md), and
> [structured-emails.md](structured-emails.md). Deletion is
> **self-serve**, has a **30-day grace period**, leaves **minimal
> tombstones** for referential integrity + billing + audit, and emits
> a machine-readable export in **portable formats** (JSON + CSV).

Account deletion is a **regulated, irreversible, multi-system
operation**. A wrong click must not destroy the user's data; a
wrong script must not leak others'. The patterns below prioritize
**user confirmation, operator auditability, and cross-system
coordination** over speed. An instant-delete button is a footgun;
a 30-day grace period is a feature.

## Related

- [consent-management.md](consent-management.md) — GDPR banner + C4
  category (account-data processing)
- [audit-log.md](audit-log.md) — append-only erasure events
- [backup-recovery.md](backup-recovery.md) — backup retention vs.
  erasure (backups can outlive live data)
- [queue-workers.md](queue-workers.md) — async deletion job with
  retries + DLQ
- [structured-emails.md](structured-emails.md) — confirm + scheduled
  + completion notifications
- [admin-ui-patterns.md](admin-ui-patterns.md) — operator-initiated
  deletion (GDPR Art. 17 request received by support)
- [rbac-modeling.md](rbac-modeling.md) — `account:delete_self` vs.
  `admin:super` for operator-initiated erasure
- [secrets-management.md](secrets-management.md) — token signing +
  download URL integrity
- [sso-saml.md](sso-saml.md) — SCIM de-provisioning counterpart
- [ADR-0034](../adr/0034-cookie-contract.md) — cookie wipe on delete
- [ADR-0023](../adr/0023-uuidv7-default.md) — tombstone id = original
  user id (re-use preserves referential links)

## When to use what — decision tree

```text
User wants own account gone                  → self-serve flow (THIS)
User died, family requests erasure            → operator-initiated via admin-ui-patterns.md
Support received GDPR Art. 17 email          → manual ticket → admin flow (audited)
Child account discovered (COPPA)              → operator-initiated + forensic flag
Tenant-wide deletion (company leaves)         → tenant deletion flow (siblings doc)
Just pause the account (vacation)             → suspend, NOT delete — separate action
Export data without deletion                  → portability flow (export only)
```

## Three build rules

1. **Deletion is a request, not an act.** A click schedules a job
   that runs in 30 days; users can cancel during the grace period.
2. **Export is decoupled from deletion.** A user can always download
   their data without deleting; deletion triggers a final export as
   a side effect.
3. **Tombstones are intentional and minimal.** Every field that
   survives deletion must be justified: referential integrity, tax
   records, audit evidence. Everything else is erased.

## The flow (happy path)

```text
┌────────────────────────────────────────────────────────────────┐
│ Day 0   User clicks "Delete my account"                        │
│         → re-authenticate (password or passkey)                │
│         → typed match `DELETE <email>`                         │
│         → reason select (bounded enum + optional free text)    │
│         → confirm dialog: consequences + grace period          │
│         → email confirmation link (single-use, 1h TTL)         │
├────────────────────────────────────────────────────────────────┤
│ Day 0   User clicks email link                                 │
│         → account status → scheduled_deletion                  │
│         → session revoked, future logins refused with 410     │
│         → deletion job queued with `runAt = now + 30d`         │
│         → audit event `account.deletion_requested`             │
│         → email: "Your account is scheduled for deletion on X" │
├────────────────────────────────────────────────────────────────┤
│ Day 7   Reminder email (still cancellable)                     │
│ Day 23  Final reminder email (7 days left)                     │
├────────────────────────────────────────────────────────────────┤
│ Day 30  Deletion job runs                                      │
│         → final export bundled + emailed download link         │
│         → hard-delete user rows in transactional order         │
│         → tombstone row inserted (id + deleted_at + audit_ref) │
│         → auth provider sign-out (SSO/OIDC revoke)             │
│         → cookies wiped cross-domain                           │
│         → completion email                                     │
│         → audit event `account.deletion_completed`             │
├────────────────────────────────────────────────────────────────┤
│ Day 30+ Data in backups ages out per retention policy          │
│         (backup-recovery.md) — typically 30-90 days            │
└────────────────────────────────────────────────────────────────┘
```

## Install

No single dependency. The flow composes:

- [Superforms v2 + Formsnap](forms.md) — confirmation form
- [BullMQ](queue-workers.md) — scheduled deletion job
- [mjml-svelte + Postmark](structured-emails.md) — transactional
  emails (confirm, reminder, completion)
- [Zod v4](schemas.md) — every boundary
- [pg_partman or manual partitioning](backup-recovery.md) — backup
  scrubbing (advanced)

## Shape — bounded Zod

```ts
// packages/auth/src/deletion/types.ts
import { z } from 'zod';

export const DeletionReason = z.enum([
  'no_longer_needed',
  'too_expensive',
  'privacy_concern',
  'switching_service',
  'account_compromised',
  'duplicate_account',
  'other',
]);
export type DeletionReason = z.infer<typeof DeletionReason>;

export const AccountStatus = z.enum([
  'active',
  'suspended',
  'scheduled_deletion',
  'deleted',
]);
export type AccountStatus = z.infer<typeof AccountStatus>;

export const DeletionRequest = z.object({
  userId: z.string().uuid(),
  requestedAt: z.string().datetime(),
  runAt: z.string().datetime(),
  reason: DeletionReason,
  reasonNote: z.string().max(500).optional(),
  confirmTokenHash: z.string().length(64),
  tokenExpiresAt: z.string().datetime(),
  graceDays: z.literal(30),
  requestedBy: z.enum(['self', 'admin', 'automated_coppa']),
  cancelledAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});
export type DeletionRequest = z.infer<typeof DeletionRequest>;
```

Five shape rules:

1. **`graceDays: z.literal(30)`** — no per-tenant override without
   explicit regulatory exception. Shortening is a red flag.
2. **`requestedBy` bounded** — tells the audit trail at a glance
   whether the user did this themselves or support pressed the button.
3. **`confirmTokenHash: z.string().length(64)`** — SHA-256 of the
   raw token. Never store the raw token.
4. **`reasonNote.max(500)`** — free text for product learning, not
   an essay box that accumulates PII.
5. **Timestamps are ISO 8601 strings** not epoch ms — easier to
   audit, impossible to accidentally compare across timezones.

## Reference pattern — server action

```ts
// packages/auth/src/deletion/request.ts
import { db } from '$lib/server/db';
import { queue } from '$lib/server/queue';
import { sendEmail } from '$lib/server/email';
import { audit } from '$lib/server/audit';
import { hashToken, randomToken } from '$lib/server/crypto';
import { clock } from '@sveltesentio/core/clock';
import { DeletionReason } from './types';
import { z } from 'zod';

const RequestSchema = z.object({
  password: z.string().min(1),
  typedMatch: z.string(),
  reason: DeletionReason,
  reasonNote: z.string().max(500).optional(),
});

export async function requestDeletion(userId: string, input: unknown) {
  const parsed = RequestSchema.parse(input);
  const user = await db.users.findByIdOrThrow(userId);

  if (parsed.typedMatch !== `DELETE ${user.email}`) {
    throw new ProblemError({
      status: 422,
      title: 'Confirmation text mismatch',
      type: 'https://sveltesentio.dev/problems/deletion-confirmation',
    });
  }

  await verifyReauthentication(user, parsed.password);

  const raw = randomToken(32);
  const now = clock.now();
  const runAt = new Date(now.getTime() + 30 * 86_400_000).toISOString();
  const tokenExpiresAt = new Date(now.getTime() + 3_600_000).toISOString();

  await db.deletionRequests.insert({
    userId: user.id,
    requestedAt: now.toISOString(),
    runAt,
    reason: parsed.reason,
    reasonNote: parsed.reasonNote,
    confirmTokenHash: await hashToken(raw),
    tokenExpiresAt,
    graceDays: 30,
    requestedBy: 'self',
  });

  await sendEmail({
    template: 'account-deletion-confirm',
    to: user.email,
    data: { confirmUrl: `${PUBLIC_ORIGIN}/account/delete/confirm?t=${raw}` },
  });

  await audit.emit({
    type: 'account.deletion_requested',
    actorId: user.id,
    targetId: user.id,
    meta: { reason: parsed.reason, runAt },
  });
}
```

Seven invariants:

1. **Re-authenticate before scheduling** — password or passkey. A
   cached session is not enough; the deletion action has its own
   fresh-auth gate (five minutes).
2. **Typed match `DELETE <email>`** — stops muscle-memory click
   paths. Not translated, deliberately: the exact string is the
   contract.
3. **Email confirmation required** — scheduling without email-link
   click is useless; proves the user controls the inbox at the
   moment of request (not a hijacked session from three months ago).
4. **Token hashed at rest** — SHA-256 + single-use. Never log the
   raw token; never store it reversibly.
5. **Token TTL = 1 hour** — long enough for email delivery, short
   enough that a forwarded link doesn't survive.
6. **`clock.now()` via injectable clock** — per
   [clock-injection.md](clock-injection.md), deletion tests assert
   grace period arithmetic with `fake-timers`.
7. **Audit event atomic with insert** — same transaction. A
   deletion request without an audit row is an incident.

## The confirmation link endpoint

```ts
// src/routes/account/delete/confirm/+server.ts
import { db } from '$lib/server/db';
import { queue } from '$lib/server/queue';
import { hashToken } from '$lib/server/crypto';
import { clock } from '@sveltesentio/core/clock';
import { audit } from '$lib/server/audit';
import { error } from '@sveltejs/kit';

export async function GET({ url, cookies }) {
  const raw = url.searchParams.get('t');
  if (!raw) throw error(400, 'Missing token');
  const hash = await hashToken(raw);
  const req = await db.deletionRequests.findByTokenHash(hash);
  if (!req) throw error(404, 'Not found');
  if (req.cancelledAt) throw error(410, 'Request cancelled');
  if (req.completedAt) throw error(410, 'Already deleted');
  if (new Date(req.tokenExpiresAt) < clock.now()) {
    throw error(410, 'Token expired');
  }

  await db.users.setStatus(req.userId, 'scheduled_deletion');
  await db.sessions.revokeAll(req.userId);

  await queue.enqueue('account.delete', {
    userId: req.userId,
    runAt: req.runAt,
  }, {
    jobId: `deletion:${req.userId}`,
    delay: new Date(req.runAt).getTime() - clock.now().getTime(),
  });

  await audit.emit({
    type: 'account.deletion_scheduled',
    actorId: req.userId,
    targetId: req.userId,
    meta: { runAt: req.runAt },
  });

  cookies.delete('session', { path: '/' });
  throw redirect(303, '/goodbye');
}
```

Six endpoint rules:

1. **410 Gone** for cancelled/completed/expired — semantically
   closer than 400; gives a clean UX message.
2. **`jobId: deletion:${userId}`** — idempotent. Replaying the link
   does not stack duplicate jobs; BullMQ deduplicates by `jobId`.
3. **`queue.enqueue` with `delay`** — runs at `runAt` exactly.
   Calendar-time, not process-uptime.
4. **Sessions revoked immediately** — account status change must
   invalidate all refresh tokens; a scheduled deletion that leaves
   sessions open is a support incident waiting to happen.
5. **Cookie cleared client-side** — user lands on `/goodbye` with
   no stale session cookie for the next visitor on shared devices.
6. **Redirect 303** not 302 — POST-after-GET anti-pattern avoided;
   link is idempotent so 303 is also safe on repeat click.

## The deletion worker

```ts
// packages/auth/src/deletion/worker.ts
import { makeWorker } from '$lib/server/queue';
import { db } from '$lib/server/db';
import { audit } from '$lib/server/audit';
import { sendEmail } from '$lib/server/email';
import { buildExport } from './export';
import { revokeSSO } from './sso';
import { z } from 'zod';

const Payload = z.object({
  userId: z.string().uuid(),
  runAt: z.string().datetime(),
});

export const deletionWorker = makeWorker('account.delete', Payload, async (p) => {
  const req = await db.deletionRequests.findActive(p.userId);
  if (!req) return { skipped: 'cancelled_or_completed' };

  const user = await db.users.findById(p.userId);
  if (!user) return { skipped: 'already_deleted' };

  const exportBundle = await buildExport(user.id);
  const downloadUrl = await storeExport(user.id, exportBundle);

  await db.transaction(async (tx) => {
    await tx.orders.orphanize(user.id);          // foreign-key tombstones
    await tx.userPrefs.delete(user.id);
    await tx.uploads.markForDeletion(user.id);   // async S3 cleanup
    await tx.sessions.deleteByUser(user.id);
    await tx.notifications.deleteByUser(user.id);
    await tx.users.tombstone(user.id, {
      deletedAt: new Date().toISOString(),
      reasonCategory: req.reason,
    });
    await tx.deletionRequests.markCompleted(req.userId);
  });

  await revokeSSO(user.id);

  await sendEmail({
    template: 'account-deletion-completed',
    to: user.email,
    data: { downloadUrl, downloadExpiresInHours: 72 },
  });

  await audit.emit({
    type: 'account.deletion_completed',
    actorId: 'system',
    targetId: user.id,
    meta: { reason: req.reason },
  });

  return { completed: true };
});
```

Nine worker rules:

1. **Idempotent** — `if (!req) return { skipped: … }` at the top.
   Re-run after crash is safe; produces no extra audit rows.
2. **Check status before acting** — the user may have cancelled in
   the last second of the grace period; the worker must honour it.
3. **Bundle the final export first** — a deletion that fails after
   erasure but before email delivery leaves the user with nothing.
   Export → store → then erase.
4. **Hard delete inside one transaction** — foreign keys cascade
   correctly; partial failure rolls everything back and the job
   retries. No half-deleted users.
5. **Tombstone is intentional** — `users` row survives with `id`,
   `deletedAt`, `reasonCategory` only. Everything else (email, name,
   address) is null. The id preserves `orders.user_id` referential
   integrity.
6. **`orphanize` not `delete`** — financial records (orders,
   invoices) cannot be deleted per tax law. Orphanizing severs the
   personal link while preserving the record.
7. **Uploads marked for async deletion** — S3 cleanup is a separate
   job (latency + retries + error isolation).
8. **SSO/OIDC revocation after DB commit** — if the DB fails, we
   don't have a user-without-SSO-without-DB-row half-state.
9. **Completion email last** — the user should receive it after
   deletion is real, not before. Sending before erasure risks
   "deletion complete" email while the user row still exists.

## Cancellation

```ts
// packages/auth/src/deletion/cancel.ts
export async function cancelDeletion(userId: string) {
  const req = await db.deletionRequests.findActive(userId);
  if (!req) return { status: 'no_active_request' };

  await db.transaction(async (tx) => {
    await tx.deletionRequests.markCancelled(userId);
    await tx.users.setStatus(userId, 'active');
  });

  await queue.remove(`deletion:${userId}`);

  await audit.emit({
    type: 'account.deletion_cancelled',
    actorId: userId,
    targetId: userId,
  });

  await sendEmail({
    template: 'account-deletion-cancelled',
    to: user.email,
    data: {},
  });

  return { status: 'cancelled' };
}
```

Four cancel rules:

1. **Cancellable only during `scheduled_deletion`** — once the worker
   starts, cancellation is impossible. Document this in the UI.
2. **Remove the queued job** — leaving it scheduled and relying on
   the worker's idempotency guard is fragile; explicit removal is
   cheap and audit-loud.
3. **Cancellation email mandatory** — confirms to the user their
   account is back. Silent cancellation invites confusion.
4. **Atomic status + request update** — status must return to
   `active` in the same transaction as the cancel mark.

## Data export

Export is a **separate user-facing feature** that the deletion flow
invokes internally:

```ts
// packages/auth/src/deletion/export.ts
export async function buildExport(userId: string): Promise<Buffer> {
  const [user, orders, uploads, prefs, sessions, audits] = await Promise.all([
    db.users.findById(userId),
    db.orders.findByUser(userId),
    db.uploads.findByUser(userId),
    db.userPrefs.findByUser(userId),
    db.sessions.findByUser(userId),
    db.auditLog.findByTarget(userId),
  ]);

  const manifest = {
    exportedAt: new Date().toISOString(),
    userId,
    schemaVersion: 1,
    format: 'json+csv',
    files: ['profile.json', 'orders.csv', 'uploads.csv', 'preferences.json', 'audit.csv'],
  };

  return zip([
    { path: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
    { path: 'profile.json', data: JSON.stringify(user, null, 2) },
    { path: 'orders.csv', data: toCsv(orders) },
    { path: 'uploads.csv', data: toCsv(uploads) },
    { path: 'preferences.json', data: JSON.stringify(prefs, null, 2) },
    { path: 'audit.csv', data: toCsv(audits) },
  ]);
}
```

Six export rules:

1. **Portable formats only** — JSON + CSV. No vendor binary; no
   proprietary serialization. GDPR Art. 20 says "commonly used".
2. **Manifest first** — `manifest.json` documents schema version,
   generated-at, files included. Every export self-describes.
3. **Parallel reads inside a consistent snapshot** — if the DB
   supports `SET TRANSACTION SNAPSHOT`, use it. Exports span tables
   and must be point-in-time coherent.
4. **Include audit log** — users deserve their own audit log; it's
   their data.
5. **Exclude other users' data** — obvious, but easy to break in
   shared tables (conversations, comments): only include rows where
   the user is the author, never the recipient side of someone
   else's message. Two-sided exports require legal review.
6. **Streaming for large accounts** — for >100MB exports, stream to
   object storage and email a signed URL; don't hold in memory.

## Download surface

```ts
// src/routes/account/export/download/+server.ts
import { verifyToken } from '$lib/server/crypto';
import { storage } from '$lib/server/storage';

export async function GET({ url }) {
  const token = url.searchParams.get('t');
  const { userId, expiresAt } = verifyToken(token);
  if (new Date(expiresAt) < new Date()) throw error(410, 'Expired');

  const stream = await storage.stream(`exports/${userId}/latest.zip`);
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="account-export.zip"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
```

Five download rules:

1. **Signed URL + 72h expiry** — matches the retention of the export
   bundle in object storage.
2. **`Cache-Control: private, no-store`** — CDN caches cannot hold
   PII exports, ever.
3. **`X-Content-Type-Options: nosniff`** — browsers must not
   interpret the zip as HTML.
4. **Stream, don't buffer** — `Response(stream)` pipes without
   loading into memory.
5. **Audit the download** — `account.export_downloaded` event links
   actor to downloaded file (operator or self).

## Backup coordination

Per [backup-recovery.md](backup-recovery.md), backups can outlive
live-data retention. The deletion flow records **which backups**
contained the user and relies on **natural aging** to erase them:

```ts
// packages/auth/src/deletion/backup-registry.ts
export async function registerForBackupScrub(userId: string) {
  const activeBackups = await db.backupRegistry.findActive();
  await db.backupErasureRegistry.insert({
    userId,
    backupIds: activeBackups.map((b) => b.id),
    scheduledEraseAt: latestExpiryOf(activeBackups),
  });
}
```

Six backup rules:

1. **Don't rewrite backups** — backups are immutable append-only.
   Rewriting to excise a user breaks backup integrity.
2. **Track backups containing the user** — `backupErasureRegistry`
   lists backup ids the user was in; when the last expires, the
   erasure is complete.
3. **Document the delayed-erasure window** — users are told in the
   confirmation email: "Your data will be removed from live systems
   within 30 days; backups containing your data will be purged
   within 90 days following our backup retention policy."
4. **Legal review** — if a regulator requires faster backup
   erasure, either shorten backup retention or accept the cost of
   point-in-time restore + re-delete + re-backup.
5. **Tombstones in backups** — after backup aging, the tombstone
   id is what remains. Referential integrity survives a restore.
6. **Restore-then-redelete** — if a backup is restored (disaster
   recovery), the deletion worker must re-run for every pending
   `deletionRequest` surfaced in the restored data. Part of the
   restore runbook.

## SSO / OIDC / SCIM de-provisioning

```ts
// packages/auth/src/deletion/sso.ts
export async function revokeSSO(userId: string) {
  const providers = await db.ssoIdentities.findByUser(userId);
  for (const p of providers) {
    await revokeRefreshToken(p);
    await revokeProviderSession(p);
    if (p.scim_provisioned) {
      await scimDelete(p.scim_user_id);
    }
  }
}
```

Five SSO rules:

1. **Revoke refresh tokens at the IdP** — a valid refresh token
   outliving the deletion is a credential compromise.
2. **SCIM-provisioned users are deleted via SCIM** — the tenant's
   IdP is the source of truth for group membership; a SCIM delete
   propagates correctly.
3. **Don't rely on logout alone** — logout terminates the browser
   session; it doesn't invalidate other devices. Explicit revoke.
4. **Revocation is best-effort async** — if the IdP is down, retry
   with backoff; never block deletion on it (the user's local data
   is gone).
5. **Audit each provider** — `account.sso_revoked` per provider,
   so reviewers can see exactly what happened.

## Consent + legal hold interaction

Three interaction rules:

1. **Legal hold blocks deletion** — if a tenant/user has an active
   legal hold (litigation, regulatory investigation), the deletion
   worker refuses and queues an exception for legal review. The
   user is informed that their request is on hold.
2. **Consent withdrawal ≠ deletion** — per
   [consent-management.md](consent-management.md), withdrawing C2
   (analytics) consent stops tracking but does not delete the
   account. Deletion is a separate, higher-stakes action.
3. **Children's accounts** — under COPPA (or equivalent), parent
   requests to delete a child's account skip self-serve and go
   through operator-initiated flow with additional verification.

## Route structure

```text
/account/settings/delete               — initial confirmation form
/account/delete/confirm?t=<token>      — email link click target
/account/delete/scheduled              — status page during grace period (cancel button)
/account/export                        — self-serve export request
/account/export/ready?t=<token>        — download page with signed URL
/goodbye                               — final logged-out page
```

Six route rules:

1. **`/account/delete/scheduled`** is the source of truth during
   grace — users bookmark it and return to cancel. It shows a
   countdown + prominent cancel button + the reason they gave.
2. **`/goodbye`** is a static page — no auth, no personalization.
   Users redirect here after scheduling and after completion.
3. **Deep links to confirm/download** use **query param tokens**
   — never path segments. Path segments leak to referers + logs;
   `?t=` is scrubbed on server log ingest.
4. **No silent redirects post-completion** — if a user returns to
   `/account` with a tombstoned id cookie, they get a clear "Your
   account was deleted" page, not a 404 or 500.
5. **Grace page is unauthenticated-safe** — shows public-safe info
   with a re-auth prompt to cancel (you cancel via passkey/password,
   not via a stale session).
6. **Every route below `/account/delete/` is no-indexed** — `<meta
   name="robots" content="noindex">` + `X-Robots-Tag`.

## A11y invariants

Seven a11y rules:

1. **Confirmation dialog is a modal `role="alertdialog"`** — focus
   trap + escape closes + initial focus on the Cancel button
   (destructive default is never focused).
2. **Typed match input labelled + `aria-describedby`** linking to
   the instruction text. SR users hear "Type DELETE user@example.com
   to confirm".
3. **Countdown timer is `aria-live="polite"` + updated every minute
   not every second** — continuous updates overwhelm SR users.
4. **Reason select is native `<select>`** — stylable but accessible
   by default. Don't reinvent.
5. **Destructive button is `<button type="submit">` with clear
   label "Delete my account permanently"** — not a skull icon with
   no text; not "continue"; the word DELETE is present.
6. **Color is not the only signal** — red background + icon + the
   word "destructive". Deuteranopia users see the same thing.
7. **Reduced motion** — the grace-period countdown has no animation
   under `prefers-reduced-motion: reduce`.

## Observability

Bounded attributes only:

```ts
// packages/core/src/observability/deletion.ts
export const DELETION_ATTRIBUTES = [
  'deletion.stage',          // request | scheduled | cancelled | completed | failed
  'deletion.reason',         // bounded enum — never free text
  'deletion.requested_by',   // self | admin | automated_coppa
  'deletion.grace_days_remaining_bucket', // 0-1 | 2-7 | 8-14 | 15-30
] as const;
```

Six alerts:

1. **Deletion worker failure rate > 0.1% / hour** → page on-call
   (data-loss risk).
2. **Cancellation rate > 30% / day** → product signal (confusing
   UX or wrong audience).
3. **Completion latency > 1 hour after `runAt`** → queue backlog.
4. **Export build latency p95 > 5 minutes** → perf regression.
5. **Legal-hold blocks > 0** → legal team page (ensure process is
   followed).
6. **Download token forgery attempts** → security page.

## Testing

Six testing lanes:

1. **Unit — grace period arithmetic** with `@sveltesentio/core/clock`
   and `fake-timers`: cancel on day 29 succeeds, cancel on day 31
   returns `no_active_request`.
2. **Integration — worker idempotency** via testcontainers Postgres
   + Redis: run worker twice, one completion row + one audit event,
   not two.
3. **Integration — export completeness** asserts every user-owned
   table is represented; adds a snapshot test that fails when a new
   user-owned table is added without being exported.
4. **Playwright — full flow E2E** including email link click (via
   `mailhog` or similar) + cancel on grace page + final download.
5. **Security — token replay + hijack** asserts tokens are
   single-use; token from one user cannot delete another; expired
   tokens refuse.
6. **A11y — axe clean** on the confirmation dialog, grace page,
   and export download page.

## Anti-patterns

1. **Instant delete, no grace period** — destroys data with one
   click. Users regret this within hours; you regret it when they
   sue.
2. **Soft delete without scheduled hard delete** — "deleted" users
   accumulate forever; GDPR erasure promise is a lie.
3. **No re-authentication before scheduling** — a session hijack
   becomes account destruction.
4. **Raw token in URL logs** — reverse proxy logs the full URL;
   `?t=raw` leaks there. Hash at rest, scrub in log ingest.
5. **Using `email` as the tombstone identifier** — breaks
   `ALTER USER email unique` constraints on the next signup with
   the same email. Use the uuid.
6. **Hard-delete in multiple transactions** — partial failure
   leaves `orders` pointing at a deleted `users` row; foreign key
   cascades break; bug surfaces months later in reporting.
7. **Forgetting to orphanize financial records** — deleting
   `orders` rows is a tax-law violation in most jurisdictions.
8. **No completion email** — user has no confirmation; support
   tickets flood.
9. **Silent cancellation** — cancel worked but user never told;
   they assume it didn't and submit again.
10. **Export in one giant JSON blob** — unparsable, unportable.
    CSV + JSON + manifest; portable means portable.
11. **Cross-user data in export** — messaging thread includes
    other participants' user IDs + content. Two-sided exports
    require legal review; default to one-sided only.
12. **Backups silently retaining deleted users** — no promise
    communicated; no registry; no proof of eventual erasure. GDPR
    auditor notices; you lose.
13. **Ignoring SCIM de-provisioning** — self-serve delete works
    for the user but the enterprise IdP still lists them; tenant
    admin is surprised.
14. **Operator delete without audit reason** — "I pressed the
    button" is not an audit trail. Require ≥20-char reason.
15. **Allowing delete during active billing cycle without
    warning** — user loses access mid-month; refund support
    tickets.
16. **Download URL in browser history** — shared machines expose
    export zip via back-button. Signed URL + short expiry + `Cache-
    Control: no-store`.
17. **"Are you sure?" as the only confirmation** — everyone clicks
    Yes. Typed match + re-auth + email link is the layered defense.
18. **Grace period clock based on request-received timestamp,
    not email-confirmed timestamp** — users who never click the
    email get silently deleted when the schedule fires.
19. **No legal-hold check** — worker deletes during active
    litigation discovery; you are now destroying evidence.
20. **Destructive action submit button is the default (Enter key)**
    — muscle memory on a form with Enter-to-submit deletes accounts.
    Cancel is default; Delete requires deliberate click.
21. **Skipping the reason enum** — "other" only, no categories.
    Product loses every deletion insight.
22. **Rate-limit bypass on deletion endpoint** — attacker with a
    leaked cookie schedules deletion; 30 days later, account gone.
    Rate-limit + re-auth + email confirm stops this.
23. **No test for the 30-day boundary** — off-by-one bug means
    deletions fire a day early or late; you only notice in an
    incident.
24. **Logging the deletion reason free text at INFO level** — PII
    in logs (users write their real reasons).

## References

- GDPR Art. 17 — Right to erasure
  <https://gdpr-info.eu/art-17-gdpr/>
- GDPR Art. 20 — Right to data portability
  <https://gdpr-info.eu/art-20-gdpr/>
- CCPA/CPRA — right to delete
  <https://oag.ca.gov/privacy/ccpa>
- COPPA — children's privacy
  <https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa>
- SCIM 2.0 — de-provisioning
  <https://datatracker.ietf.org/doc/html/rfc7644>
- [ADR-0034](../adr/0034-cookie-contract.md) — cookie wipe
- [ADR-0023](../adr/0023-uuidv7-default.md) — tombstone ids
- [consent-management.md](consent-management.md)
- [audit-log.md](audit-log.md)
- [backup-recovery.md](backup-recovery.md)
- [queue-workers.md](queue-workers.md)
- [structured-emails.md](structured-emails.md)
- [admin-ui-patterns.md](admin-ui-patterns.md)
- [rbac-modeling.md](rbac-modeling.md)
