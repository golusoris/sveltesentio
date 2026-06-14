# Tenant provisioning — self-serve creation + plan + seed + first-admin

> Self-serve tenant (workspace, organization) creation flow and the
> server-side provisioning pipeline that sets up isolation, plan
> entitlements, seed data, and the first admin. Composes
> [sso-saml.md](sso-saml.md), [admin-ui-patterns.md](admin-ui-patterns.md),
> [rbac-modeling.md](rbac-modeling.md),
> [service-limits.md](service-limits.md),
> [queue-workers.md](queue-workers.md),
> [tenant-theming.md](tenant-theming.md),
> [onboarding.md](onboarding.md), and
> [structured-emails.md](structured-emails.md). Provisioning is
> **transactional, idempotent, resumable**, and leaves every tenant
> in a **known-good state** — never partially created.

Tenant provisioning is **the critical path for every revenue user**.
Any half-finished tenant is a support ticket or a lost signup. The
patterns below prioritize **atomicity, idempotency, and explicit
rollback** over speed. A failed provision must leave no orphan
rows, no dangling Stripe customers, no empty but "created" tenants.

## Related

- [sso-saml.md](sso-saml.md) — per-tenant IdP config bolted on post-provision
- [admin-ui-patterns.md](admin-ui-patterns.md) — operator-triggered provisioning
- [rbac-modeling.md](rbac-modeling.md) — first-admin grant is scoped + audited
- [service-limits.md](service-limits.md) — plan entitlements applied at provision
- [queue-workers.md](queue-workers.md) — heavy steps offloaded (seed, index)
- [tenant-theming.md](tenant-theming.md) — default tokens applied
- [onboarding.md](onboarding.md) — first-admin enters onboarding flow
- [structured-emails.md](structured-emails.md) — welcome + activation link
- [payments.md](payments.md) — Stripe customer + default payment method
- [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md) — gradual rollout of new-tenant features
- [audit-log.md](audit-log.md) — provisioning events audited
- [ADR-0035](../adr/0035-permissions-load-derived.md) — tenant-scoped grants
- [ADR-0023](../adr/0023-uuidv7-default.md) — tenant id = UUIDv7

## When to use what — decision tree

```text
Self-serve "Create workspace" button              → self-serve flow (THIS)
Operator provisions for enterprise deal           → operator flow via admin-ui-patterns.md (audited)
SSO-initiated first login creates a tenant        → JIT tenant via sso-saml.md
Tenant cloned for test/sandbox environment        → clone flow (separate doc)
Two tenants merge after acquisition               → merge flow (operator + legal review)
Tenant split (spin-off)                           → operator + data-migrations.md
Tenant archived / suspended                       → lifecycle flow (not THIS)
Tenant deleted                                    → lifecycle flow + account-deletion.md
```

## Three build rules

1. **One transaction or a saga with compensations.** Provisioning
   touches DB + Stripe + search index + object storage + IdP —
   at least three external systems. Either all-atomic inside a
   DB tx (for local-only work) or a saga with explicit rollback
   steps for each external side-effect.
2. **Idempotent by `tenantId`.** Re-running provisioning with the
   same id produces the same tenant, never a second one. `jobId`
   = `provision:${tenantId}` at every queue boundary.
3. **No half-finished tenants.** A tenant has a bounded
   `status` (`provisioning|active|suspended|archived|deleted`).
   Failed provision returns to `archived` with a reason; never
   `active-but-broken`.

## The flow (happy path)

```text
┌────────────────────────────────────────────────────────────────┐
│ Step 1  User on marketing page → /signup/workspace              │
│         → form: workspace name, slug, plan, admin email         │
│         → Zod validation + slug uniqueness check                │
│         → create pending User + send magic-link email           │
├────────────────────────────────────────────────────────────────┤
│ Step 2  User clicks magic link                                  │
│         → User.email_verified = true                             │
│         → DB tx: insert Tenant(status='provisioning')           │
│         → insert TenantMember(role='owner', user_id)            │
│         → insert TenantSettings(defaults)                       │
│         → audit `tenant.provisioning_started`                   │
│         → enqueue `tenant.provision` (jobId = tenantId)         │
├────────────────────────────────────────────────────────────────┤
│ Step 3  Provisioning worker runs                                │
│         → Stripe customer.create (idempotency-key = tenantId)   │
│         → Stripe subscription.create (trial 14d)                │
│         → object-storage: create tenant-scoped bucket/prefix    │
│         → search: create tenant-scoped index                    │
│         → seed: run seed SQL + optional demo data               │
│         → feature-flags: apply default plan entitlements        │
│         → DB tx: Tenant.status = 'active', mark worker complete │
│         → audit `tenant.provisioning_completed`                 │
│         → email: welcome + link to /onboarding                  │
├────────────────────────────────────────────────────────────────┤
│ Step 4  User lands on /onboarding                               │
│         → per onboarding.md progressive-disclosure              │
│         → team invites, theme, first item                       │
└────────────────────────────────────────────────────────────────┘
```

On failure, compensations run in reverse.

## Install

No single dependency. The flow composes:

- [Superforms v2](forms.md) + Zod for the signup form
- [BullMQ](queue-workers.md) for the provisioning worker
- [Stripe Node SDK](payments.md) for billing
- [S3-compatible SDK](uploads.md) for object storage
- [Typesense or Postgres FTS](search.md) for search
- [mjml-svelte + Postmark](structured-emails.md) for email
- [clock-injection](clock-injection.md) for test-deterministic trial end

## Shape — bounded Zod

```ts
// packages/tenants/src/types.ts
import { z } from 'zod';

export const Plan = z.enum(['free', 'pro', 'team', 'enterprise']);
export type Plan = z.infer<typeof Plan>;

export const TenantStatus = z.enum([
  'provisioning',
  'active',
  'suspended',
  'archived',
  'deleted',
]);

export const Slug = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/)
  .refine((s) => !RESERVED_SLUGS.includes(s), 'reserved');

export const SignupInput = z.object({
  workspaceName: z.string().min(1).max(64),
  slug: Slug,
  plan: Plan,
  adminEmail: z.string().email().max(254),
  country: z.string().length(2),
  termsAcceptedAt: z.string().datetime(),
  marketingOptIn: z.boolean(),
});

export const ProvisionJob = z.object({
  tenantId: z.string().uuid(),
  plan: Plan,
  adminUserId: z.string().uuid(),
  attempt: z.number().int().min(0).max(10),
});
```

Seven shape rules:

1. **`Slug` regex enforces Unicode-ASCII-only** — slugs appear in
   URLs and subdomains; non-ASCII is a support nightmare.
2. **`RESERVED_SLUGS`** includes `admin`, `api`, `app`, `status`,
   `help`, `login`, `signup`, `www`, `mail`, `ftp`, locale codes,
   and anything your routes use. Declare once, import everywhere.
3. **`Plan` is bounded** — not free-text. Maps 1:1 to a plan
   entitlement matrix (see [service-limits.md](service-limits.md)).
4. **`TenantStatus` is bounded** — every state is explicit; the
   DB check constraint enforces it.
5. **`termsAcceptedAt` is a datetime** — regulatory audit trail;
   legal needs to prove consent existed at signup.
6. **`country: z.string().length(2)`** — ISO 3166-1 alpha-2; used
   for tax + data-residency routing.
7. **`ProvisionJob.attempt`** is capped at 10; BullMQ backoff
   reaches this before the DLQ catches it.

## The signup endpoint (Step 1-2)

```ts
// src/routes/signup/workspace/+page.server.ts
import { superValidate, message } from 'sveltekit-superforms/server';
import { zod } from 'sveltekit-superforms/adapters';
import { SignupInput } from '@sveltesentio/tenants/types';
import { db } from '$lib/server/db';
import { sendEmail } from '$lib/server/email';
import { clock } from '@sveltesentio/core/clock';
import { uuidv7 } from '@sveltesentio/core/ids';

export const actions = {
  default: async ({ request }) => {
    const form = await superValidate(request, zod(SignupInput));
    if (!form.valid) return { form };

    const taken = await db.tenants.slugTaken(form.data.slug);
    if (taken) return message(form, 'slug_taken', { status: 409 });

    const tenantId = uuidv7();
    const userId = uuidv7();

    await db.transaction(async (tx) => {
      await tx.users.upsertByEmail({
        id: userId,
        email: form.data.adminEmail,
        emailVerified: false,
      });
      await tx.pendingTenants.insert({
        id: tenantId,
        slug: form.data.slug,
        name: form.data.workspaceName,
        plan: form.data.plan,
        adminUserId: userId,
        createdAt: clock.now().toISOString(),
        termsAcceptedAt: form.data.termsAcceptedAt,
        country: form.data.country,
      });
    });

    const token = await issueMagicLink(userId, { purpose: 'verify_and_provision', tenantId });
    await sendEmail({
      template: 'workspace-activation',
      to: form.data.adminEmail,
      data: { activationUrl: `${PUBLIC_ORIGIN}/signup/activate?t=${token}` },
    });

    return message(form, 'check_email');
  },
};
```

Six signup rules:

1. **Two-table insert (user + pendingTenant) in one transaction** —
   one rollback covers both. A user without their pending tenant
   is orphaned; a pending tenant without its admin is a ghost.
2. **Slug check is pre-transaction advisory** — the transaction
   itself needs a unique constraint; the pre-check exists only to
   return a 409 before wasting DB work. Always check again inside
   the tx via constraint violation.
3. **`uuidv7()` ids** per [ADR-0023](../adr/0023-uuidv7-default.md);
   the tenant id remains stable for the entire lifecycle.
4. **Magic link scoped to `verify_and_provision`** — cannot be
   replayed for login; single-use; 1h TTL.
5. **Email sent after commit** — if the email fails, user can
   resend from the status page; the data is committed.
6. **No Stripe call here** — Stripe and other external systems
   happen in the worker (Step 3), not in the request path. Keep
   the request latency low.

## The activation endpoint

```ts
// src/routes/signup/activate/+server.ts
export async function GET({ url, cookies }) {
  const raw = url.searchParams.get('t');
  if (!raw) throw error(400);
  const claim = await verifyMagicLink(raw);
  if (!claim || claim.purpose !== 'verify_and_provision') throw error(410);

  const pending = await db.pendingTenants.findById(claim.tenantId);
  if (!pending) throw error(404);
  if (pending.provisionedAt) {
    return redirect(303, `/workspace/${pending.slug}/onboarding`);
  }

  await db.transaction(async (tx) => {
    await tx.users.markEmailVerified(pending.adminUserId);
    await tx.tenants.insert({
      id: pending.id,
      slug: pending.slug,
      name: pending.name,
      plan: pending.plan,
      status: 'provisioning',
      country: pending.country,
      termsAcceptedAt: pending.termsAcceptedAt,
    });
    await tx.tenantMembers.insert({
      tenantId: pending.id,
      userId: pending.adminUserId,
      role: 'owner',
      grantedBy: 'system',
      grantedAt: new Date().toISOString(),
      reason: 'workspace creator',
    });
    await tx.tenantSettings.insertDefaults(pending.id);
  });

  await queue.enqueue('tenant.provision', {
    tenantId: pending.id,
    plan: pending.plan,
    adminUserId: pending.adminUserId,
    attempt: 0,
  }, { jobId: `provision:${pending.id}` });

  await audit.emit({
    type: 'tenant.provisioning_started',
    actorId: pending.adminUserId,
    targetId: pending.id,
  });

  setSessionCookie(cookies, pending.adminUserId);
  throw redirect(303, `/workspace/${pending.slug}/onboarding/pending`);
}
```

Six activation rules:

1. **Idempotent** — clicking the link twice returns a redirect to
   onboarding; does not create a second tenant.
2. **DB-local work first, queue second** — `tenant` + `member` +
   `settings` are inserted synchronously so the user sees the
   workspace immediately; heavy external integrations happen async.
3. **`grantedBy: 'system'`** — audit trail distinguishes self-
   signup from operator-initiated; per
   [rbac-modeling.md](rbac-modeling.md).
4. **Status `provisioning`** — the UI shows a banner "Your
   workspace is being set up" on every page until `active`.
5. **Session cookie set before redirect** — user lands logged in;
   no "verify your email and log in" double-step.
6. **`jobId: provision:${tenantId}`** — replaying this endpoint
   does not stack duplicate jobs; BullMQ drops.

## The provisioning worker (Step 3)

```ts
// packages/tenants/src/provision/worker.ts
import { makeWorker } from '$lib/server/queue';
import { ProvisionJob } from '../types';
import { stripe } from '$lib/server/stripe';
import { storage } from '$lib/server/storage';
import { search } from '$lib/server/search';
import { db } from '$lib/server/db';
import { sendEmail } from '$lib/server/email';
import { audit } from '$lib/server/audit';
import { applyPlanEntitlements } from './entitlements';
import { seedTenant } from './seed';

export const provisionWorker = makeWorker(
  'tenant.provision',
  ProvisionJob,
  async ({ tenantId, plan, adminUserId }) => {
    const tenant = await db.tenants.findById(tenantId);
    if (!tenant) return { skipped: 'tenant_missing' };
    if (tenant.status === 'active') return { skipped: 'already_provisioned' };

    const steps: CompensatingStep[] = [];

    try {
      const stripeCustomer = await stripe.customers.create({
        metadata: { tenant_id: tenantId },
      }, { idempotencyKey: `tenant-customer-${tenantId}` });
      steps.push({ undo: () => stripe.customers.del(stripeCustomer.id) });

      const sub = await stripe.subscriptions.create({
        customer: stripeCustomer.id,
        items: [{ price: priceIdFor(plan) }],
        trial_period_days: 14,
        metadata: { tenant_id: tenantId },
      }, { idempotencyKey: `tenant-sub-${tenantId}` });
      steps.push({ undo: () => stripe.subscriptions.cancel(sub.id) });

      await storage.createPrefix(`tenants/${tenantId}/`);
      steps.push({ undo: () => storage.deletePrefix(`tenants/${tenantId}/`) });

      await search.createIndex(`tenant-${tenantId}`);
      steps.push({ undo: () => search.deleteIndex(`tenant-${tenantId}`) });

      await seedTenant(tenantId, plan);
      await applyPlanEntitlements(tenantId, plan);

      await db.transaction(async (tx) => {
        await tx.tenantBilling.insert({
          tenantId,
          stripeCustomerId: stripeCustomer.id,
          stripeSubscriptionId: sub.id,
        });
        await tx.tenants.setStatus(tenantId, 'active');
      });

      await sendEmail({
        template: 'workspace-welcome',
        to: (await db.users.findById(adminUserId)).email,
        data: { workspaceUrl: `${PUBLIC_ORIGIN}/w/${tenant.slug}` },
      });

      await audit.emit({
        type: 'tenant.provisioning_completed',
        actorId: 'system',
        targetId: tenantId,
        meta: { plan, trialDays: 14 },
      });

      return { ok: true };
    } catch (err) {
      for (const s of steps.reverse()) {
        try { await s.undo(); } catch (e) { /* log, do not throw */ }
      }
      await db.tenants.setStatus(tenantId, 'archived', { reason: 'provision_failed' });
      await audit.emit({
        type: 'tenant.provisioning_failed',
        actorId: 'system',
        targetId: tenantId,
        meta: { error: serializeError(err) },
      });
      throw err;
    }
  },
);
```

Eleven worker rules:

1. **`if (tenant.status === 'active') return { skipped }`** — the
   worker is idempotent; a retry after partial failure resumes
   only if explicitly designed (harder — prefer full rollback +
   re-run).
2. **Compensations are recorded as a stack** — run in reverse on
   failure. Each `undo` wrapped in its own try/catch (compensation
   failures must not hide the original error).
3. **Stripe idempotency keys are `tenant-*-${tenantId}`** — the
   Stripe API deduplicates at their side; retry safe.
4. **`trial_period_days`** set from a config, not hardcoded — the
   business may change it; passing via job payload is explicit.
5. **Seed happens after external integrations** — if Stripe
   fails, no data was written; failure surface is smaller.
6. **Billing record + status flip in one transaction** — the
   tenant does not become `active` without its Stripe linkage.
7. **Welcome email after commit** — the email contains the link
   to the workspace; sending before the status flip risks a
   broken link if the commit rolls back.
8. **`audit.emit` for both success and failure** — every
   provisioning attempt is forensically trackable.
9. **Failure sets `archived`, never `active-but-broken`** — the
   status is truthful; ops can resurrect via re-run or delete.
10. **`throw err` after compensation** — BullMQ retries per its
    configured backoff; user-visible "provisioning failed" banner
    appears after max retries.
11. **Step ordering** matters: local DB last, external first. A
    local-DB failure is recoverable (replay); an external-system
    failure mid-transaction leaves persistent side-effects.

## Compensations

```ts
// packages/tenants/src/provision/compensations.ts
export type CompensatingStep = {
  name?: string;
  undo: () => Promise<void>;
};
```

Six compensation rules:

1. **Every side-effecting call registers a compensation** — no
   exceptions. If you cannot compensate (e.g., email sent), defer
   that call to after the commit.
2. **Compensation runs in reverse order** — the last thing done
   is the first thing undone.
3. **Compensation is best-effort** — log failures; never let a
   compensation error prevent other compensations from running.
4. **Compensation is idempotent** — deleting an already-deleted
   Stripe customer is a no-op.
5. **Do not compensate after commit** — once the final DB status
   flip succeeds, the tenant is live; a "compensate" at this
   point is a destructive action requiring operator sign-off.
6. **Test compensation paths** — inject failures at each step; the
   system must end up in a clean state.

## Plan entitlements

```ts
// packages/tenants/src/provision/entitlements.ts
import { Plan } from '../types';

const PLAN_ENTITLEMENTS: Record<z.infer<typeof Plan>, Entitlements> = {
  free:       { maxUsers: 3,   maxProjects: 2,   maxStorageGb: 1,   features: ['basic'] },
  pro:        { maxUsers: 10,  maxProjects: 20,  maxStorageGb: 50,  features: ['basic', 'exports'] },
  team:       { maxUsers: 50,  maxProjects: 100, maxStorageGb: 500, features: ['basic', 'exports', 'sso'] },
  enterprise: { maxUsers: -1,  maxProjects: -1,  maxStorageGb: -1,  features: ['basic', 'exports', 'sso', 'audit', 'scim'] },
};

export async function applyPlanEntitlements(tenantId: string, plan: z.infer<typeof Plan>) {
  const ent = PLAN_ENTITLEMENTS[plan];
  await db.tenantEntitlements.upsert({ tenantId, ...ent, appliedAt: new Date().toISOString() });
}
```

Five entitlement rules:

1. **Single source of truth** — `PLAN_ENTITLEMENTS` is code, not
   DB config. Ops cannot edit entitlements by hand without a
   deployment + audit.
2. **`-1` means unlimited** — clearer than `Infinity`; serializes
   cleanly.
3. **Applied at provision, updated on plan change** — the
   entitlement row is the working copy; the plan column is the
   purchase record.
4. **Feature gates read entitlements via
   [service-limits.md](service-limits.md)** — never re-derive
   from plan at each check.
5. **Enterprise plans often override defaults** — a contract
   rider increases limits; the entitlement row is mutable for
   enterprise only, with operator audit.

## Seed data

```ts
// packages/tenants/src/provision/seed.ts
export async function seedTenant(tenantId: string, plan: Plan) {
  await db.transaction(async (tx) => {
    await tx.projects.insert({
      id: uuidv7(),
      tenantId,
      name: 'Welcome',
      createdBy: 'system',
    });
    if (plan !== 'free') {
      await tx.projects.insertMany(demoProjects(tenantId));
    }
    await tx.tenantPreferences.insert({
      tenantId,
      locale: 'en',
      timezone: 'UTC',
      theme: 'system',
    });
  });
}
```

Six seed rules:

1. **Seed is deterministic by `tenantId`** — same id, same seed
   (modulo randomness which should use a `tenantId`-derived seed
   for testability).
2. **Seed inside a transaction** — partial seed leaves a confusing
   workspace.
3. **Demo data gated by plan** — free tier gets a minimal "Welcome"
   project; pro+ gets demo content that showcases features.
4. **Seed is idempotent with upserts** — re-running on a provisioned
   tenant is a safe no-op.
5. **No external lookups in seed** — the seed must run offline
   (no Stripe fetch, no CDN download). Those are separate steps.
6. **Seed produces clean rows only** — no placeholder strings like
   "Lorem ipsum" that ship to production.

## Failure surface + retries

Five failure rules:

1. **BullMQ retries per
   [queue-workers.md](queue-workers.md)** — exponential backoff,
   max 10 attempts, DLQ after.
2. **DLQ triggers ops page** — a tenant stuck provisioning > 15
   minutes is an incident.
3. **User-visible status page** — `/signup/activate` redirects to
   a "provisioning in progress" page on first click, refreshes
   every 5s, shows "failed + retry + contact support" on terminal
   failure.
4. **Manual retry from operator** — ops can re-enqueue with
   `attempt: 0` via admin UI; prior compensations must have run.
5. **No automatic "resume mid-flight"** — simpler to full-rollback
   + re-run than to track partial state.

## SSO-initiated tenant creation

Four SSO-JIT rules:

1. **IdP-first signup** — user clicks "Log in with Google
   Workspace" / Okta from a marketing page; no tenant exists; the
   OIDC callback triggers provisioning for the claimed domain.
2. **Domain claim verification** — the first tenant from a domain
   claims it; subsequent users from that domain join the existing
   tenant unless explicitly opted out. DNS-record verification
   optional for enterprise.
3. **SCIM de-provisioning applies symmetrically** — user
   offboarded at IdP is removed from tenant within minutes.
4. **JIT provisioning is a separate worker path** — simpler flow
   (no email verify, IdP asserts identity), same compensations.

## Route structure

```text
/signup/workspace                      — self-serve form
/signup/activate?t=<token>             — magic link lands here
/workspace/<slug>/onboarding/pending   — provisioning status page
/workspace/<slug>/onboarding           — onboarding.md flow
/admin/tenants/new                     — operator-initiated form
```

Five route rules:

1. **`/signup/workspace` is public** — no rate limit bypass, but
   aggressive per-IP rate-limiting to prevent mass signups.
2. **`/signup/activate` accepts GET with token query param** —
   matches email-client behavior; never POST.
3. **`/onboarding/pending` shows SSE live-status** of the
   provision worker (determinate progress, retry button,
   contact-support link).
4. **`/admin/tenants/new` is `admin:write`-gated** — operators
   provision tenants for enterprise-sales deals with reason ≥20
   chars (per [admin-ui-patterns.md](admin-ui-patterns.md)).
5. **Slug in URL** — canonical; `id` also accepted for
   operator-internal routes. Users see slugs.

## A11y invariants

Six a11y rules:

1. **Signup form uses Superforms + Formsnap** per
   [forms.md](forms.md); every field labelled, errors announced.
2. **Slug availability check shows live `aria-live="polite"`
   message** — "This slug is available" / "Taken, try X".
3. **Plan selector is a radio group**, not custom divs; labels
   include price + key limits.
4. **Provisioning-progress page is `role="status"` + `aria-
   live="polite"`** with determinate percentage.
5. **Failure state has a `role="alert"`** with a clear retry
   button and support link.
6. **Onboarding redirect uses meta-refresh or JS redirect with
   announcement**, not a silent URL change mid-page.

## Observability

Bounded attributes only:

```ts
export const PROVISION_ATTRIBUTES = [
  'provision.plan',              // bounded: free | pro | team | enterprise
  'provision.outcome',           // started | completed | failed | compensated
  'provision.step',              // stripe_customer | stripe_sub | storage | search | seed | entitle | commit
  'provision.source',            // self_serve | sso_jit | operator
  'provision.failure_reason',    // bounded ≤20: stripe_timeout | slug_collision | quota_exceeded | ...
  'provision.duration_bucket',   // <5s | <15s | <60s | >60s
] as const;
```

Six alerts:

1. **Provisioning failure rate > 2% / hour** → page on-call.
2. **Median provisioning duration > 30s** → Stripe / external
   latency regression.
3. **DLQ entries > 0 per hour** → ops + customer-success page.
4. **Compensation failure rate > 0** → stop-the-line; orphan
   resources accumulating.
5. **Slug-collision rate > 5% of signups** → reserved list or
   slug-generator regression.
6. **SSO-JIT + self-serve double-provision for same email** →
   identity reconciliation bug.

## Testing

Six testing lanes:

1. **Unit — `applyPlanEntitlements`** and `seedTenant` pure logic.
2. **Integration — full worker** with Stripe fake (Stripe CLI's
   mock), S3 via minio, Typesense via testcontainers.
3. **Failure injection — each step fails in isolation**, assert
   compensations run and final state is `archived`.
4. **Idempotency — run worker twice**, assert no duplicate
   customer, no duplicate seed rows.
5. **E2E — Playwright signup form → magic link → onboarding
   landing** (mailhog for link).
6. **Security — slug-squatting**, reserved-slug bypass, magic
   link replay, cross-user activation.

## Anti-patterns

1. **Stripe call in the request path** — signup latency becomes
   Stripe latency; Stripe downtime becomes signup downtime.
2. **No `idempotencyKey` on Stripe create** — retry creates two
   customers; billing reconciliation nightmare.
3. **Tenant status flipped `active` before external integrations
   done** — users enter a broken workspace.
4. **Compensations run in forward order** — later steps depend on
   earlier; undoing forward leaves dangling references.
5. **No DLQ monitoring** — failed provisions sit forever; users
   never hear back; support tickets flood.
6. **Seed data outside a transaction** — half-seeded workspace
   confuses users.
7. **Slug uniqueness checked only in app code** — race between
   two signups creates duplicates; DB constraint is the only truth.
8. **Reserved-slug list in app code only, not in DB constraint** —
   a bug path creates `admin` as a slug; routing breaks.
9. **Magic-link token stored raw** — log leak = account takeover.
   Hash at rest.
10. **Magic-link reusable** — email forward becomes tenant theft.
    Single-use + short TTL.
11. **No rate limit on signup form** — mass-signup abuse fills DB
    with ghost tenants.
12. **Free-form plan column** — breaks entitlements; bounded enum
    + DB check constraint.
13. **`country` stored as free text** — tax routing breaks; ISO
    code enforced.
14. **No audit on provisioning start/complete/fail** — ops cannot
    reconstruct any incident.
15. **Session cookie not set before redirect to workspace** —
    user lands on workspace, gets redirected to login, confused.
16. **No "provisioning in progress" banner** — users refresh and
    see broken empty workspace, churn.
17. **Seed data includes "Lorem ipsum"** — embarrasses users
    demoing the product.
18. **Entitlements stored in Stripe metadata** — Stripe outage =
    feature-gates break; app is source of truth, Stripe is only
    for billing.
19. **SSO JIT creates a new tenant per user** (should join
    existing domain tenant) — data siloed by accident.
20. **Operator provisioning bypasses audit + reason** — compliance
    audit finds mystery tenants.
21. **Re-provisioning on a stuck tenant without rollback first** —
    duplicates Stripe subs; double-billing.
22. **Coupling tenant id to slug** (using slug as primary key) —
    rebrand requires DB migration; always use uuidv7 for id.
23. **Welcome email includes the magic-link token** — replay
    attack surface; use a fresh session-scoped link.
24. **Deleting the pending-tenant row immediately on worker
    start** — mid-flight failure loses the original signup data;
    keep until `active`.

## References

- RFC 3986 — URI slug constraints
  <https://datatracker.ietf.org/doc/html/rfc3986>
- Stripe idempotency keys
  <https://docs.stripe.com/api/idempotent_requests>
- Saga pattern (Garcia-Molina 1987)
  <https://www.cs.cornell.edu/andru/cs711/2002fa/reading/sagas.pdf>
- OIDC JIT provisioning
  <https://openid.net/specs/openid-connect-core-1_0.html>
- [ADR-0035](../adr/0035-permissions-load-derived.md) — tenant-scoped grants
- [ADR-0023](../adr/0023-uuidv7-default.md) — UUIDv7 ids
- [admin-ui-patterns.md](admin-ui-patterns.md)
- [rbac-modeling.md](rbac-modeling.md)
- [sso-saml.md](sso-saml.md)
- [service-limits.md](service-limits.md)
- [queue-workers.md](queue-workers.md)
- [payments.md](payments.md)
- [onboarding.md](onboarding.md)
- [structured-emails.md](structured-emails.md)
- [audit-log.md](audit-log.md)
