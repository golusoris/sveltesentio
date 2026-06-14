# Admin UI patterns — back-office tables, bulk actions, impersonation, audit

> Back-office surface for internal operators: user search, bulk
> actions, impersonation ("view as user"), tenant management, audit
> viewer. Built on [permissions.md](permissions.md),
> [data-tables.md](data-tables.md),
> [audit-log.md](audit-log.md), and gated via
> [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md).
> Every admin action is audited with actor + target + diff; every
> bulk action has a confirm step + undo window; impersonation is
> time-boxed + prominently banner-flagged.

Admin UI is **the highest blast-radius surface in the product**. A
bug here deletes customer data by the thousand; a misplaced button
sends an email to every user. The patterns below prioritize
**reversibility, audit density, and operator friction-in-the-right-
places** over speed. Fast admin UIs are bad admin UIs.

## Related

- [permissions.md](permissions.md) — RBAC + `usePermissions` rune
- [data-tables.md](data-tables.md) — virtualized grid with a11y
- [audit-log.md](audit-log.md) — append-only tamper-evident trail
- [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md)
  — kill-switch + staged rollout for admin features
- [webhooks.md](webhooks.md) — inbound from billing/SSO for sync UI
- [service-limits.md](service-limits.md) — quota dashboard surface
- [forms.md](forms.md) — Superforms + Zod for admin edits
- [onboarding.md](onboarding.md) — user-lifecycle awareness
- [sso-saml.md](sso-saml.md) — enterprise tenant admin
- [ADR-0035](../adr/0035-permissions-load-derived.md) — permission model
- [ADR-0023](../adr/0023-uuidv7-default.md) — UUIDv7 audit ids

## When to use what — decision tree

```text
View / search across tenants                          → admin table (THIS)
Edit one field on one user                            → edit dialog + Superforms
Edit same field on many users                        → bulk action with confirm + undo
Log in as user to reproduce a bug                    → impersonation with banner
Investigate a security incident                       → audit viewer (read-only)
Export for offline analysis                           → CSV export with audit, RBAC-gated
Manual refund / disable / reset                       → destructive action + two-step confirm
```

## Three build rules

1. **Every admin mutation is audited** with actor, target, before/
   after diff, reason field required for high-risk actions.
2. **Every destructive action has a two-step confirmation** — typed
   match for the target identifier.
3. **Impersonation is time-boxed, banner-flagged, and scope-limited**
   — never silently "become" another user.

## Route structure

```text
/admin                                    — landing: KPI + recent audits
/admin/users                              — search + table
/admin/users/[id]                         — detail + edit + impersonate
/admin/tenants                            — search + table
/admin/tenants/[id]                       — detail + quota + SSO config
/admin/audits                             — event viewer with filters
/admin/bulk/[jobId]                       — bulk action status + undo
/admin/health                             — queues, cron, DLQ, flags
```

Six route rules:

1. **`/admin` is its own subtree** — same domain, separate layout,
   separate nav, separate CSP nonce scope if applicable.
2. **Every route has a server-side RBAC guard** in
   `+layout.server.ts` — browser-only checks are security theater.
3. **Bookmarkable filters** — every table state encodes to URL
   (`?q=`, `?status=`, `?page=`). Support deep-linking from incident
   reports.
4. **No SPA transitions that hide role-changes** — a revoked operator
   session should land on a 403, not a cached page.
5. **Read vs write roles are separate** — `admin:read` for audits
   team, `admin:write` narrower set.
6. **Audit-only operators** see mutations as disabled, not hidden —
   they need to know the surface exists.

## Permission gating

```ts
// src/routes/admin/+layout.server.ts
import { requireRole } from '$lib/auth/rbac';

export async function load(event) {
  const user = requireRole(event, ['admin:read', 'admin:write', 'admin:super']);
  return { adminUser: user };
}
```

Seven permission rules:

1. **Four tiers**: `admin:read`, `admin:write`, `admin:super`
   (destructive + impersonation), `admin:billing` (financial actions).
2. **Permissions are role-bound**, never user-bound — adding a user
   to a role is auditable.
3. **Elevation to `admin:super` requires re-auth with MFA** within
   the last 5 minutes (see [mfa.md](mfa.md)).
4. **No "god mode"** — even `admin:super` cannot bypass audit or
   tenant-level tombstones (GDPR erasure).
5. **Cross-tenant actions** require both source and target tenant to
   be in operator's scope — implicit cross-tenant admin is a
   data-leak path.
6. **Revoke is immediate** — a removed admin role invalidates session
   and loads return 403 on next request; no 5-minute cache.
7. **Session-bound "current tenant" selector** for multi-tenant
   operators — prevents accidental cross-tenant writes.

## Back-office tables

Delegate to [data-tables.md](data-tables.md) (`@sveltesentio/ui/data`)
for the virtualization and a11y envelope. Admin-specific concerns on
top:

Six table rules:

1. **Default sort by most-recent-activity** — operators are usually
   chasing a recent event.
2. **Column selection persisted per-operator** — they tune their
   view; forcing a fixed layout wastes time.
3. **Right-click row → context menu** for common actions (view,
   impersonate, disable) — keyboard-accessible via `Menu` role.
4. **Bulk-select with "select all matching filter"** explicit confirm
   — visible count, not just a checkbox ("Select all 1,243
   matching").
5. **Inline edit is opt-in per column** — most columns open a dialog
   instead; inline edits on admin tables cause destructive typos.
6. **Empty states explain why** (no permission? no matches? feature
   flagged off?) — admin UIs cannot afford the "it just didn't show"
   bug class.

## Bulk actions

```ts
// src/lib/admin/bulk.ts
import { z } from 'zod';

export const BulkAction = z.enum([
  'user.suspend',
  'user.resume',
  'user.reset_mfa',
  'user.export_data',
  'tenant.freeze_billing',
  'notification.resend',
]);
export type BulkAction = z.infer<typeof BulkAction>;

export const BulkRequest = z.object({
  action: BulkAction,
  targetIds: z.array(z.string().uuid()).min(1).max(10_000),
  reason: z.string().min(12),
  dryRun: z.boolean().default(true),
  confirmToken: z.string().length(6),
});
```

Seven bulk rules:

1. **Bounded action enum** — free-form bulk endpoints are an SSRF
   waiting to happen.
2. **Max batch size** per action (default 10k) — prevents accidental
   "select all 2 million users".
3. **`dryRun` default true** — a dry run returns the diff preview;
   operator flips to real after review.
4. **6-character confirm token** surfaces when the operator clicks
   execute; they type it back — stops muscle-memory clicks.
5. **Reason field ≥12 chars** — audit value is only as good as the
   reason.
6. **Bulk job is asynchronous** (see
   [queue-workers.md](queue-workers.md)) — progress page with live
   count, cancel button up to 50 % done.
7. **Undo window** for reversible actions (suspend, rate-limit
   overrides) — 15 minutes; a second bulk undoes the first with the
   same audit linkage.

### Bulk job UI

```svelte
<!-- src/routes/admin/bulk/[jobId]/+page.svelte -->
<script lang="ts">
  const { data } = $props();
  const job = $derived(data.job);
  const canCancel = $derived(job.progress < 0.5 && job.status === 'running');
  const canUndo = $derived(
    job.status === 'completed' &&
    job.undoExpiresAt > Date.now() &&
    job.reversible,
  );
</script>

<section aria-label="Bulk job status">
  <h1>{job.action} — {job.totalTargets} targets</h1>
  <progress value={job.progress} max="1" aria-label="progress" />
  <dl>
    <dt>Started by</dt><dd>{job.actor}</dd>
    <dt>Reason</dt><dd>{job.reason}</dd>
    <dt>Processed</dt><dd>{job.processed} / {job.totalTargets}</dd>
    <dt>Failures</dt><dd>{job.failures}</dd>
  </dl>
  {#if canCancel}<button onclick={cancel}>Cancel</button>{/if}
  {#if canUndo}<button onclick={undo}>Undo (expires {relative(job.undoExpiresAt)})</button>{/if}
</section>
```

Six status-UI rules:

1. **Live progress via SSE** (see [sse.md](sse.md)) — not polling.
2. **Determinate progress always** — the server knows total targets.
3. **Failure list is expandable** per-target — operators need to see
   which IDs failed and why.
4. **Cancel up to 50 %** — beyond that, continuing to completion is
   cheaper than rollback.
5. **Undo window surfaces countdown** — operators know their time
   budget.
6. **Failed targets are re-queueable** individually — don't force a
   full re-run.

## Impersonation ("view as user")

```ts
// src/lib/admin/impersonate.ts
import { z } from 'zod';

export const ImpersonationRequest = z.object({
  targetUserId: z.string().uuid(),
  reason: z.string().min(12),
  durationMinutes: z.number().int().min(5).max(60),
  scope: z.enum(['read_only', 'read_write']),
});

export async function startImpersonation(
  actor: User,
  req: ImpersonationRequest,
): Promise<ImpersonationSession> {
  if (!actor.roles.includes('admin:super')) throw forbidden();
  if (await isProtectedAccount(req.targetUserId)) throw forbidden();
  const session = await createImpersonationSession({
    actorId: actor.id,
    targetUserId: req.targetUserId,
    expiresAt: new Date(Date.now() + req.durationMinutes * 60_000),
    scope: req.scope,
    reason: req.reason,
  });
  await audit('impersonation_started', {
    actor: actor.id,
    target: req.targetUserId,
    scope: req.scope,
    durationMinutes: req.durationMinutes,
    reason: req.reason,
  });
  await notifyTargetUserByEmail(req.targetUserId, session);
  return session;
}
```

Ten impersonation rules:

1. **`admin:super` only** — not every admin can impersonate.
2. **Time-boxed**: 5–60 minutes, default 15; auto-ends via cron.
3. **Scope-limited**: `read_only` (safe default) vs `read_write`
   (rare, logged more).
4. **Protected accounts cannot be impersonated** — owners of the
   company, security-team members, accounts on an explicit
   `no_impersonate` list.
5. **Banner on every page** during impersonation — red, full-width,
   "You are viewing as X — end session". Never dismissible.
6. **Session cookie is distinct** — `__Host-impersonation` layered on
   top of the regular session; revocation of either ends the
   view-as state.
7. **Target user is notified** — email + in-app notification
   "administrator X viewed your account for Y minutes".
8. **Destructive actions disabled** in `read_only` scope; visible but
   inert — clarity over stealth.
9. **All actions during impersonation are double-audited** — both as
   the target user (for their audit trail) and as the impersonating
   admin (for the admin audit trail).
10. **End-session surface is one click away** — keyboard shortcut
    `Esc Esc` ends immediately; UI banner button always present.

### Impersonation banner

```svelte
<!-- src/lib/admin/ImpersonationBanner.svelte -->
<script lang="ts">
  const { session } = $props();
  const remaining = $derived(session.expiresAt - Date.now());
</script>

<div role="alert" aria-live="assertive" class="impersonation-banner">
  <strong>Impersonating:</strong> {session.targetUserEmail}
  — {Math.floor(remaining / 60_000)} min remaining
  <button onclick={endSession}>End session</button>
</div>

<style>
  .impersonation-banner {
    position: sticky;
    top: 0;
    z-index: 9999;
    background: oklch(45% 0.2 25);
    color: white;
    padding: 0.75rem 1rem;
  }
</style>
```

Five banner rules:

1. **`role="alert"` + `aria-live="assertive"`** — screen readers
   announce the state on every page load.
2. **High-contrast fixed color** — no theming; the banner is always
   visible.
3. **Sticky to viewport top** — never scrollable out of sight.
4. **Time-remaining counter** — operators stay aware of the session
   expiration.
5. **`Esc Esc`** keyboard shortcut wired in layout — standard exit.

## Destructive actions — two-step

```svelte
<!-- Dialog fragment -->
<Dialog open={confirmOpen}>
  <h2>Delete tenant <code>{tenant.name}</code>?</h2>
  <p>This will remove all data irreversibly after 30-day grace.</p>
  <label>
    Type <code>{tenant.slug}</code> to confirm:
    <input bind:value={typed} />
  </label>
  <label>
    Reason (min 20 chars):
    <textarea bind:value={reason}></textarea>
  </label>
  <button
    disabled={typed !== tenant.slug || reason.length < 20}
    onclick={execute}
  >
    Delete tenant
  </button>
</Dialog>
```

Seven destructive rules:

1. **Typed-match confirm** — user types tenant slug, user email, or
   bulk ID; arbitrary "DELETE" strings are too-easily-muscle-memory.
2. **Reason is mandatory and long** — 20+ characters for destructive
   actions.
3. **Grace period default** — tenant delete is a 30-day soft-delete
   with restoration; hard delete is a separate admin flow.
4. **Destructive buttons are red with icon** — never the default
   action in a dialog.
5. **Tab-order puts Cancel first** — Enter defaults to cancel, not
   delete.
6. **Parallel destructive actions disabled** — only one delete
   in-flight per admin session; prevents accidental rapid-fire.
7. **Post-delete summary** — email to operator + team channel
   "tenant X deleted by Y for reason Z".

## Audit viewer

Six viewer rules:

1. **Read-only** — operator cannot edit or delete audit rows; the
   audit table is append-only per [audit-log.md](audit-log.md).
2. **Filter by actor, target, action, time-range** — every common
   incident-response query is one URL away.
3. **Diff view** for mutation events — before/after JSON side-by-side
   with field highlighting.
4. **Link-back to the target** — audit row for "user suspended" links
   to the user detail page.
5. **Export CSV with audit-of-audit** — exporting audit logs is
   itself audited.
6. **Retention-aware** — UI surfaces "records older than N days are
   cold storage; contact ops" when a filter crosses the boundary.

## Search + filter

Six search rules:

1. **Typesense** (per [search.md](search.md)) or Postgres FTS on
   indexed columns — LIKE-on-a-million-rows is an outage.
2. **Pseudonymous IDs searchable alongside email** — operators often
   have a UUID from a log.
3. **Debounced client input** (300 ms) with server-side cancellation
   of stale requests.
4. **"Search by anything" is ambitious** — gate to 3–4 indexed
   fields; a free-text catch-all is an abuse vector.
5. **Search audit row** — every search logs actor + query + match
   count (not matched IDs) for privacy.
6. **Recent searches** saved per-operator — not shared globally (PII
   leakage).

## CSV export

Six export rules:

1. **Scope-limited**: `admin:write` for tenant-bounded export;
   `admin:super` for cross-tenant.
2. **Row limit** default 100k; above that, offer async job with
   signed-URL download.
3. **Column allowlist** — operator picks fields; "export all
   columns" is a default that leaks internal columns.
4. **Audit every export** — actor, filter, row count, column list.
5. **Signed URL expires in 1 hour** — link-sharing is not license to
   share the data.
6. **PII-scrub option** — "mask emails" checkbox offers a safe
   export for bug reports shared with vendors.

## Dashboards

Six dashboard rules:

1. **Operational health first** (queues, cron, DLQ, recent errors) —
   product metrics second.
2. **No customer PII** on the landing dashboard — KPIs aggregate.
3. **Links to source systems** — OTel trace, Sentry issue, Grafana
   chart — admin UI is the directory, not the full dashboard.
4. **Incident-response shortcuts**: kill-switch panel, recent
   rollouts, current SLO status.
5. **Personal dashboard** per-operator — saved views for recurring
   investigation patterns.
6. **Read-mostly** — the admin dashboard is not where mutations
   happen; dedicated edit surfaces keep the mental model clean.

## Observability

Bounded attributes:

- `admin.action` — bounded enum (≤50 values)
- `admin.role` — `admin:read|admin:write|admin:super|admin:billing`
- `admin.target_type` — `user|tenant|audit|flag|quota|...`
- `admin.scope` — `single|bulk|impersonation`
- `admin.outcome` — `ok|forbidden|dry_run|cancelled|undone|failed`

Gauges:

- `admin.actions_per_hour_per_operator`
- `admin.impersonation.active_sessions`
- `admin.bulk.in_flight`
- `admin.audit_lag_seconds` (time from mutation to audit row)

Alerts:

- Impersonation session > 60 min — page on-call (bug or policy
  violation)
- Bulk action > 100k targets — approval workflow triggered
- Audit lag > 10 s — append-only pipeline broken
- `admin.outcome == 'forbidden'` spike — potential credential misuse

## Testing

Five lanes:

1. **Unit** — RBAC guards reject unauthorized roles; reason
   validation catches <12 chars.
2. **Integration** — bulk action dry-run produces expected diff
   without mutating DB.
3. **Playwright** — impersonation banner is announced by screen
   reader (axe-core + aria-live assertions).
4. **Chaos** — cancel bulk mid-flight, confirm partial state is
   consistent + auditable.
5. **Security** — SSRF, IDOR, and CSRF tests per destructive action;
   absent fields in audit are a CI failure.

## Anti-patterns

1. **Client-side-only role checks** — forge a JWT, bypass the UI.
2. **"Select all" without count** — admins destroy data they didn't
   know they selected.
3. **Free-form action endpoints** — `/admin/do?cmd=...` is SSRF-
   adjacent.
4. **Impersonation without banner** — operators forget, user pages
   show weird state.
5. **No impersonation time-box** — operator leaves tab open overnight,
   session abused on shared machine.
6. **Silent impersonation** — target user never notified.
7. **No reason field** — audit trail is worthless without "why".
8. **Destructive button as default** in dialog — Enter triggers
   catastrophic action.
9. **Inline edits on admin tables** — typo → wrong user suspended.
10. **No dry-run for bulk** — irreversible 10k-row mistakes.
11. **Audit table editable** — tamper erases evidence.
12. **PII in URLs** for admin routes — leaks via referer + browser
    history on shared machines.
13. **SPA transition hiding session changes** — revoked admin still
    sees cached admin UI.
14. **Admin on same origin as app without CSP scoping** — XSS on the
    product pops admin tokens.
15. **No kill-switch for admin actions themselves** — a runaway
    admin feature cannot be paused.
16. **CSV export ignoring RBAC** — operator with read-access exports
    columns they cannot see in the table.
17. **"Unlimited" retention on audit viewer** — UX promises that
    break when cold storage kicks in.
18. **Impersonation crosses tenant boundary without extra consent** —
    implicit super-admin.
19. **Bulk actions with no undo window** — operator loses 15 minutes
    of options on irreversible mistakes.
20. **Using customer support tool to impersonate** without going
    through the audit + banner flow — bypasses all controls.

## References

- [ADR-0035 — permissions `load`-derived](../adr/0035-permissions-load-derived.md)
- [ADR-0023 — UUIDv7 default](../adr/0023-uuidv7-default.md)
- [permissions.md](permissions.md) / [data-tables.md](data-tables.md) / [audit-log.md](audit-log.md) / [forms.md](forms.md) / [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md) / [sso-saml.md](sso-saml.md) / [mfa.md](mfa.md) / [queue-workers.md](queue-workers.md) / [sse.md](sse.md) / [search.md](search.md)
- [NIST SP 800-53 AC-6 — least privilege](https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final)
- [OWASP ASVS L2 §V4 — access control](https://owasp.org/www-project-application-security-verification-standard/)
- [CIS Controls v8 §6 — account management](https://www.cisecurity.org/controls/)
