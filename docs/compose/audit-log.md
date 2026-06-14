# Audit log — tamper-evident user-action trail (compliance ≠ operations)

An **audit log** records "who did what to which resource, when, from
where" for compliance — SOC 2 CC7.2, ISO 27001 A.8.15, HIPAA
§164.312(b), GDPR Art. 30 records-of-processing. It is **not** the
same as operational logs ([opentelemetry-logs.md](opentelemetry-logs.md)),
error tracking ([sentry-or-equivalent.md](sentry-or-equivalent.md)),
AI audit ([ai-audit-hook.md](ai-audit-hook.md)), or traces
([observability.md](observability.md)). It is a separate sink with
**different retention**, **different access controls**, and **different
durability guarantees** — the first three can be sampled, rotated, or
lost with a service crash; an audit record cannot.

Per [principles.md §2.2](../principles.md) (OWASP ASVS L2 V7 — security
logging) and [ADR-0023](../adr/0023-observability-uuidv7-rfc9457.md)
(structured observability), this recipe covers: audit-event schema,
append-only write path with hash-chain tamper evidence,
reader/exporter surface for compliance requests, retention policies
per record class, and the boundary between audit / operational /
error-tracking.

## Related

- [observability.md](observability.md) — OTel traces/metrics/logs are
  ops-focused; audit is compliance-focused. Both emit for the same
  event but land in **different sinks with different retention**.
- [opentelemetry-logs.md](opentelemetry-logs.md) — log records may
  *reference* the audit record by `audit.id` but never *replace* it.
- [sentry-or-equivalent.md](sentry-or-equivalent.md) — error-tracking
  is third per-error sink, not an audit sink. `Sentry.captureException`
  is not auditing.
- [ai-audit-hook.md](ai-audit-hook.md) — AI compliance events (EU AI
  Act) flow through a **separate** sink with AI-specific schema
  ([ADR-0045](../adr/0045-ai-audit-hook.md)). Both sinks may be the
  same storage backend but the schemas are distinct.
- [auth-oidc.md](auth-oidc.md) — login / logout / session-rotate /
  MFA-challenge are audit-table events.
- [permissions.md](permissions.md) — permission grants / revokes are
  audit-table events; permission checks are **not** (they're hot-path,
  emit via OTel metrics instead).
- [webhooks.md](webhooks.md) — inbound webhook receipts land in audit
  when they drive a state change (e.g. Stripe `invoice.paid`).
- [structured-emails.md](structured-emails.md) — password-reset /
  email-change sends are audit events.
- [webauthn-attestation.md](webauthn-attestation.md) — AAL3 step-ups
  and attested-credential registration events.
- [schemas.md](schemas.md) — every audit event has a Zod-validated
  envelope.
- [principles.md §2.2](../principles.md) — OWASP ASVS L2 V7
  (security logging + monitoring).

## What belongs in audit vs ops vs error

Rule: **audit ⇔ compliance narrative**. If a regulator, security
auditor, or incident-responder would ask "who did X and when", it
belongs in audit. Latency percentiles, cache hit rates, timeout
stacks, HTTP 5xx spikes — those belong in ops.

```text
Auth: login success / failure / lockout                          → audit
Auth: session token refresh (background)                          → ops (OTel metric)
Auth: MFA challenge issued / verified / failed                    → audit
Auth: password reset requested / completed                        → audit

Permissions: role granted / revoked by admin                      → audit
Permissions: runtime permission check (every request)             → ops (metric only)
Permissions: admin viewed another user's data                     → audit (ALWAYS)

Data: resource created / updated / deleted                        → audit (if user-initiated)
Data: cache invalidation                                          → ops
Data: export of user data (GDPR Art. 20)                          → audit
Data: data deletion request (GDPR Art. 17)                        → audit

Billing: subscription created / canceled / upgraded               → audit
Billing: Stripe webhook received                                  → audit
Billing: invoice generation (system-initiated)                    → ops

AI: prompt+response stored for compliance                         → ai-audit-hook.md (distinct)
AI: model inference latency                                       → ops

Security: 2FA bypass attempt / brute-force lockout                → audit + security-alert
Security: rate-limit trip                                         → ops (metric)

Ops: request duration / queue depth / cache hit                   → OTel ONLY, NEVER audit
Errors: 500 stacktrace / unhandled rejection                      → Sentry ONLY, NEVER audit
```

**Rule of thumb:** if your answer to "why log this?" starts with
"to improve performance", it's ops. If it starts with "to prove we
did / didn't do X", it's audit.

## Schema — the canonical event envelope

Every audit event conforms to a single Zod schema. The schema is
**append-only**: fields may be added, never removed or renamed —
because audit records outlive code.

```ts
// packages/audit/src/schema.ts
import { z } from 'zod';

export const AuditAction = z.enum([
  // Auth
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.logout',
  'auth.session.rotated',
  'auth.mfa.challenged',
  'auth.mfa.verified',
  'auth.mfa.failed',
  'auth.password.reset_requested',
  'auth.password.reset_completed',
  'auth.passkey.registered',
  'auth.passkey.removed',
  // Permissions
  'permissions.role.granted',
  'permissions.role.revoked',
  'permissions.admin_viewed_user_data',
  // Data
  'data.resource.created',
  'data.resource.updated',
  'data.resource.deleted',
  'data.export.requested',
  'data.export.completed',
  'data.deletion.requested',
  'data.deletion.completed',
  // Billing
  'billing.subscription.created',
  'billing.subscription.canceled',
  'billing.subscription.upgraded',
  'billing.webhook.received',
  // Security
  'security.lockout.triggered',
  'security.admin.impersonation_started',
  'security.admin.impersonation_ended',
]);
export type AuditAction = z.infer<typeof AuditAction>;

export const AuditEvent = z.object({
  id: z.string().uuid(),                    // UUIDv7 → time-sortable
  timestamp: z.string().datetime(),         // ISO 8601 server clock

  // WHO
  actor: z.object({
    type: z.enum(['user', 'system', 'admin', 'service']),
    id: z.string().nullable(),              // user/admin UUID; null for unauth (e.g. failed login)
    label: z.string().nullable(),           // denormalized: email/name at time of event
  }),
  onBehalfOf: z.object({                    // for admin impersonation / service-acting-as-user
    type: z.enum(['user']),
    id: z.string(),
    label: z.string().nullable(),
  }).nullable(),

  // WHAT
  action: AuditAction,
  target: z.object({
    type: z.string(),                       // 'project' / 'user' / 'invoice' / ...
    id: z.string().nullable(),
    label: z.string().nullable(),           // denormalized
  }).nullable(),

  // HOW / WHERE
  source: z.object({
    ip: z.string().nullable(),              // anonymize per retention policy (last-octet-zero)
    userAgent: z.string().nullable(),
    requestId: z.string(),                  // correlation.id UUIDv7 → joins OTel
    origin: z.enum(['web', 'api', 'webhook', 'cron', 'admin-tool']),
  }),

  // RESULT
  outcome: z.enum(['success', 'failure', 'denied']),
  reason: z.string().nullable(),            // e.g. 'mfa_required' / 'rate_limited' / 'invalid_credentials'

  // CONTEXT (bounded: no free-form PII)
  metadata: z.record(z.string(), z.union([
    z.string(), z.number(), z.boolean(), z.null(),
  ])).default({}),

  // TAMPER EVIDENCE
  prevHash: z.string().nullable(),          // sha256(prev.id + prev.timestamp + prev.hash) — null for first row
  hash: z.string(),                         // sha256(canonical-json of this event minus `hash`)
});
export type AuditEvent = z.infer<typeof AuditEvent>;
```

**Seven schema rules:**

1. **`actor.label` is denormalized at write time.** If a user's email
   changes later, the old audit record still shows the email they had
   when they did the thing. Never JOIN to `users` at read time for
   that field.
2. **`correlation.id` in `source.requestId`** threads every audit
   event to its OTel span + logs for incident forensics.
3. **`action` is a bounded enum** — adding a new action is a schema
   change that goes through code review.
4. **`metadata` is a flat string-keyed record of scalars** — no nested
   objects, no arrays of objects. Keeps storage query-friendly and
   prevents PII sprawl.
5. **`outcome` is three-valued, not boolean.** `failure` (system
   error) and `denied` (authorization rejection) are different
   compliance narratives.
6. **`onBehalfOf` is mandatory for impersonation.** Admin viewing a
   user's data is two events: `security.admin.impersonation_started`
   *and* every subsequent action with `actor.type=admin` +
   `onBehalfOf.id=userId`.
7. **Hash chain** links each record to its predecessor; any gap or
   mutation is detectable at export time.

## Append-only write path

Audit rows are **insert-only**. No `UPDATE`, no `DELETE` from
application code. The database user that the application connects as
has `INSERT` and `SELECT` only — not `UPDATE` or `DELETE` — on the
audit table. A separate migration-time role handles schema changes.

```sql
-- supabase/migrations/NNNN_audit_log.sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_type TEXT NOT NULL,
  actor_id UUID NULL,
  actor_label TEXT NULL,
  on_behalf_of_id UUID NULL,
  on_behalf_of_label TEXT NULL,
  action TEXT NOT NULL,
  target_type TEXT NULL,
  target_id TEXT NULL,
  target_label TEXT NULL,
  source_ip INET NULL,
  source_user_agent TEXT NULL,
  source_request_id UUID NOT NULL,
  source_origin TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash TEXT NULL,
  hash TEXT NOT NULL UNIQUE
);

CREATE INDEX idx_audit_actor ON audit_log (actor_id, timestamp DESC);
CREATE INDEX idx_audit_target ON audit_log (target_type, target_id, timestamp DESC);
CREATE INDEX idx_audit_action_time ON audit_log (action, timestamp DESC);
CREATE INDEX idx_audit_correlation ON audit_log (source_request_id);

-- Application role: INSERT + SELECT only
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_rw;
GRANT INSERT, SELECT ON audit_log TO app_rw;
```

`emit()` helper:

```ts
// packages/audit/src/emit.ts
import { createHash } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import { uuidv7 } from '@sveltesentio/core';
import { AuditEvent, type AuditEvent as AuditEventT } from './schema';

export async function emit(
  partial: Omit<AuditEventT, 'id' | 'timestamp' | 'prevHash' | 'hash'>,
): Promise<{ id: string }> {
  const id = uuidv7();
  const timestamp = new Date().toISOString();

  // Atomically: fetch the latest hash, compute this row's hash, insert.
  // Single transaction prevents hash-chain race under concurrent writes.
  return db.transaction().execute(async (tx) => {
    const prev = await tx.selectFrom('audit_log')
      .select(['hash'])
      .orderBy('timestamp', 'desc')
      .limit(1)
      .executeTakeFirst();

    const prevHash = prev?.hash ?? null;
    const unhashed = { id, timestamp, prevHash, ...partial };
    const hash = createHash('sha256')
      .update(canonicalJson(unhashed))
      .digest('hex');

    const row: AuditEventT = { ...unhashed, hash };
    const validated = AuditEvent.parse(row);

    await tx.insertInto('audit_log').values(rowToDb(validated)).execute();

    // Thread to OTel for ops-side visibility (the audit row is authoritative).
    trace.getActiveSpan()?.setAttributes({
      'audit.id': id,
      'audit.action': partial.action,
      'audit.outcome': partial.outcome,
    });
    return { id };
  });
}

function canonicalJson(obj: unknown): string {
  // Deterministic JSON: sort keys, no whitespace — critical for hash stability.
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}
```

**Six emit rules:**

1. **One transaction per event.** Hash chain requires serialized
   writes; Postgres serializable isolation or explicit row-lock on a
   sentinel prevents concurrent-insert divergence.
2. **`canonicalJson` is deterministic.** Sort keys, no whitespace,
   no number-precision drift. Any implementation must produce
   byte-identical output for the same input, or hash verification
   fails on export.
3. **Zod-validate before insert.** A bad shape that reaches the DB
   corrupts the chain. Never `db.insert` without `AuditEvent.parse`.
4. **Never emit from inside a user's main DB transaction.** If the
   user's write rolls back, the audit write must stay — emit is a
   separate transaction that commits regardless.
5. **Failure to emit must alert + page.** Audit write failure is a
   compliance incident, not a latency blip. Route to `AUDIT_WRITE_FAILED`
   alert per [observability.md](observability.md).
6. **Emit on success AND on denial.** A denied action is compliance-
   relevant ("user X tried to access resource Y, denied"). Don't
   only log successes.

## Call sites — where `emit()` belongs

In request handlers, after the action completes (success or denial):

```ts
// src/routes/(app)/admin/users/[id]/+server.ts — admin impersonation start
import { emit } from '@sveltesentio/audit';

export async function POST({ params, locals, request }) {
  const { session, correlationId } = locals;
  requireAdmin(session);  // throws 403 if not admin

  const target = await db.selectFrom('users').where('id', '=', params.id)
    .select(['id', 'email']).executeTakeFirstOrThrow();

  const impersonationToken = await issueImpersonationToken(session.adminId, target.id);

  await emit({
    actor: { type: 'admin', id: session.adminId, label: session.email },
    onBehalfOf: null,
    action: 'security.admin.impersonation_started',
    target: { type: 'user', id: target.id, label: target.email },
    source: {
      ip: anonymizeIp(request.headers.get('x-forwarded-for')),
      userAgent: request.headers.get('user-agent'),
      requestId: correlationId,
      origin: 'admin-tool',
    },
    outcome: 'success',
    reason: null,
    metadata: { reason_code: 'support_ticket', ticket_id: request.headers.get('x-ticket') ?? '' },
  });

  return json({ token: impersonationToken });
}
```

In `hooks.server.ts` for pervasive events (login success/failure):

```ts
// After auth-oidc.md session-issue:
await emit({
  actor: { type: 'user', id: user.id, label: user.email },
  onBehalfOf: null,
  action: 'auth.login.succeeded',
  target: null,
  source: { ip: anonymizeIp(ip), userAgent: ua, requestId: correlationId, origin: 'web' },
  outcome: 'success',
  reason: null,
  metadata: { method: 'passkey' },  // or 'password' / 'oidc' / 'mfa_totp'
});
```

## Export + verification — compliance reader

Compliance workflows (SOC 2 evidence, GDPR subject access request,
incident investigation) need signed exports with hash-chain
verification.

```ts
// packages/audit/src/export.ts
export async function exportForSubject(
  subjectId: string,
  window: { from: Date; to: Date },
): Promise<{ ndjson: string; verified: boolean; gaps: string[] }> {
  const rows = await db.selectFrom('audit_log')
    .where((eb) => eb.or([
      eb('actor_id', '=', subjectId),
      eb('on_behalf_of_id', '=', subjectId),
      eb(eb.and([eb('target_type', '=', 'user'), eb('target_id', '=', subjectId)])),
    ]))
    .where('timestamp', '>=', window.from)
    .where('timestamp', '<=', window.to)
    .orderBy('timestamp', 'asc')
    .selectAll()
    .execute();

  const gaps: string[] = [];
  let expectedPrev: string | null = rows[0]?.prev_hash ?? null;
  for (const row of rows) {
    const recomputed = createHash('sha256')
      .update(canonicalJson(rowMinusHash(row)))
      .digest('hex');
    if (recomputed !== row.hash) gaps.push(`hash_mismatch:${row.id}`);
    if (row.prev_hash !== expectedPrev) gaps.push(`chain_break:${row.id}`);
    expectedPrev = row.hash;
  }

  const ndjson = rows.map((r) => JSON.stringify(r)).join('\n');
  return { ndjson, verified: gaps.length === 0, gaps };
}
```

**Export rules:**

1. **Verify hash chain on every export.** A downstream auditor will
   do this anyway; catching gaps at export is better than at audit.
2. **Sign the export bundle** (e.g. `openssl smime -sign` with an
   offline-rotated key, or cosign). Attestation matters.
3. **Log the export itself** — `data.export.completed` is an audit
   event. Exports are privileged; track who ran them.

## Retention + anonymization

| Record class | Retention | Anonymization trigger |
|---|---|---|
| Auth (login/logout/MFA) | 13 months | User-deletion → actor_label=null, source_ip=null |
| Permissions (grants/revokes) | 7 years | Never (compliance requires full trail) |
| Data (resource lifecycle) | 7 years for billing-linked; 25 months others | User-deletion → target_label=null |
| Billing | 7 years (SOC 2 + tax) | Never |
| Security (lockout/impersonation) | 7 years | Never |
| Admin impersonation | 7 years | Never |

Retention is enforced by a **privileged cron job** (not application
code) that `ANONYMIZE`s rather than `DELETE`s — the row structure +
hash chain stays intact; PII fields are NULL-ed or redacted. This
preserves the chain-verification property while honoring GDPR Art. 17.

```sql
-- Quarterly retention job (DBA role, not app):
UPDATE audit_log
  SET actor_label = NULL, source_ip = NULL, metadata = metadata - 'email'
  WHERE timestamp < now() - interval '13 months'
    AND action LIKE 'auth.%'
    AND actor_id IS NOT NULL;
```

(Hash is **not** recomputed after anonymization; original hash stays.
The verification tool must tolerate anonymized-row pattern: fields
that match `(null, null, redacted-pattern)` AND a retention-policy
annotation are not chain-breaks.)

## Anti-patterns

- **Don't use audit as operational logs.** Latency percentiles, cache
  stats, queue depth — those are [observability.md](observability.md).
  Audit is expensive, append-only, high-durability storage; polluting
  it with metric-shaped data inflates costs and slows exports.
- **Don't use operational logs as audit.** OTel logs are ephemeral
  (30 / 90 days), sampled, and mutable by log-processor. They are
  not compliance evidence. A "find who deleted the user" query that
  grep's OTel logs is the wrong shape.
- **Don't allow `UPDATE` or `DELETE` from app role.** Even for
  "fixing a typo in the actor label". A mutable audit log is not an
  audit log — it's a story-we're-telling.
- **Don't emit audit rows from inside the user's main transaction.**
  Audit must survive user-transaction rollback. Separate transaction,
  or the audit row will vanish alongside the action that was rolled
  back.
- **Don't skip the hash chain.** "We'll add tamper detection later"
  — no you won't. Retrofitting a hash chain onto an existing table
  requires recomputing history, which requires a trusted starting
  point, which you don't have. Build the chain on day one.
- **Don't store free-form JSON blobs in `metadata`.** Bounded flat
  scalars only. Arbitrary JSON hides PII growth, inflates storage,
  and breaks queryability. If you need a shape, add a bounded
  top-level field.
- **Don't log permission checks** (every request). Audit every
  permission *grant/revoke* (admin action) and every *denied* access
  to sensitive resources. Successful reads of normal resources are
  noise at audit volume.
- **Don't forget admin impersonation.** Admin-as-user is the highest-
  risk surface in the product; every action during impersonation
  must record `actor.type=admin`, `onBehalfOf.id=user`. Never attribute
  admin-triggered actions to the user being impersonated.
- **Don't reuse audit sink for AI compliance.** EU AI Act needs
  model-version / prompt-hash / response-hash / tool-call traces —
  a different schema. Route through [ai-audit-hook.md](ai-audit-hook.md);
  both sinks may share storage but the event shape is distinct.
- **Don't expose audit read APIs to application users.** "Let users
  see their own audit" is a product feature, not the compliance
  surface. Build a dedicated, rate-limited, read-filtered projection
  for user-facing "activity log" — never query `audit_log` directly
  from user-facing routes.
- **Don't silence audit-write failures.** A failed emit is not a
  "try again later" case — it's a compliance incident that pages
  on-call. Alert on it with `AUDIT_WRITE_FAILED` severity.

## References

- [ADR-0023 — Observability: OTel + UUIDv7 + RFC 9457](../adr/0023-observability-uuidv7-rfc9457.md)
- [ADR-0045 — AI audit hook](../adr/0045-ai-audit-hook.md)
- [principles.md §2.2 — OWASP ASVS L2 V7 (security logging + monitoring)](../principles.md)
- Sibling recipes: [observability.md](observability.md),
  [opentelemetry-logs.md](opentelemetry-logs.md),
  [sentry-or-equivalent.md](sentry-or-equivalent.md),
  [ai-audit-hook.md](ai-audit-hook.md),
  [auth-oidc.md](auth-oidc.md),
  [permissions.md](permissions.md),
  [webhooks.md](webhooks.md),
  [structured-emails.md](structured-emails.md),
  [webauthn-attestation.md](webauthn-attestation.md),
  [schemas.md](schemas.md).
- Upstream specs:
  - OWASP ASVS v5 V7 (security logging): <https://github.com/OWASP/ASVS>
  - SOC 2 CC7.2 (system monitoring): <https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2>
  - GDPR Art. 30 (records of processing): <https://gdpr-info.eu/art-30-gdpr/>
  - NIST SP 800-92 (log management): <https://csrc.nist.gov/publications/detail/sp/800-92/final>
  - RFC 3161 (timestamp protocol, for signed export attestation): <https://www.rfc-editor.org/rfc/rfc3161>
