# `job-scheduling-advanced.md` — advanced job orchestration recipe for sveltesentio

When [cron-jobs.md](cron-jobs.md) (HTTP-triggered + croner escape)
and [queue-workers.md](queue-workers.md) (BullMQ default) outgrow
their envelope — distributed cron coordination across N regions,
fan-out/fan-in workflows (process 100K records, then aggregate),
durable timers (sleep for 7 days then continue), and human-in-the-
loop steps (wait for approval before proceeding) — you need
**workflow orchestration** (Temporal / Inngest / Trigger.dev), per
[ADR-0019](../adr/0019-server-runtime-contract.md) +
[ADR-0023](../adr/0023-compliance-observability.md).

This recipe covers the patterns that BullMQ alone can't model
ergonomically: **distributed locks** (only one region runs the
nightly billing job), **fan-out/fan-in** (split-aggregate),
**durable timers** (delay weeks without process state), **saga
compensations** (multi-step transactions with rollback), and
**human-in-the-loop** (pause until external signal). The library
choice is **Temporal** for workflow-heavy systems, **Inngest** for
serverless-friendly event-driven, **BullMQ + advisory locks** when
you can stretch the basics.

## Related

- [cron-jobs.md](cron-jobs.md) — single-region scheduled jobs
  baseline
- [queue-workers.md](queue-workers.md) — BullMQ workers + DLQ
- [multi-region-deployment.md](multi-region-deployment.md) —
  distributed-lock requirement comes from multi-region
- [observability.md](observability.md) — workflow spans cross steps
- [audit-log.md](audit-log.md) — saga decisions logged
- [tenant-provisioning.md](tenant-provisioning.md) — saga reference
  pattern
- [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md) —
  rollout of new workflow versions
- [ADR-0019](../adr/0019-server-runtime-contract.md)
- [ADR-0023](../adr/0023-compliance-observability.md)

## When to use what — decision tree

```text
Single periodic task                              → cron-jobs.md
Background work, fire-and-forget                  → queue-workers.md (BullMQ)
Multi-step transaction with rollback              → tenant-provisioning.md saga pattern
Multi-region single-leader periodic               → BullMQ + Postgres advisory lock (this recipe)
Process 100K rows then aggregate                  → fan-out/fan-in (this recipe)
Sleep for 30 days then send reminder              → Temporal / Inngest durable timer (this recipe)
Wait for human approval mid-flow                  → Temporal / Inngest signal (this recipe)
Long-running computation > 1h                     → BullMQ chunking OR Temporal activity
Schedule jobs > 1000/sec                          → Kafka + custom scheduler (out of scope)
Backfill 100M rows                                → backfill worker per data-migrations.md
```

## Pattern 1 — distributed cron lock (single-leader across regions)

When you have N regions and the nightly billing job must run **once
globally**, plain cron in each region runs N times. Postgres
advisory locks give you cluster-wide mutual exclusion without
extra infrastructure:

```ts
// packages/jobs/src/distributed-cron.ts
import { db } from '$lib/server/db';

// Stable 64-bit lock key per job name (hashed once at definition time).
const LOCK_KEYS = {
  'billing.nightly': 0x1a2b3c4d_5e6f7081n,
  'reports.weekly': 0x2b3c4d5e_6f708192n,
  'cleanup.daily': 0x3c4d5e6f_70819203n,
} as const;

export async function withDistributedLock<T>(
  jobName: keyof typeof LOCK_KEYS,
  fn: () => Promise<T>,
): Promise<T | null> {
  const key = LOCK_KEYS[jobName];

  return db.transaction(async (tx) => {
    // pg_try_advisory_xact_lock: non-blocking; returns false if held elsewhere.
    // Released automatically at transaction commit/rollback.
    const { rows } = await tx.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired`,
      [key],
    );

    if (!rows[0].acquired) {
      // Another region/instance holds the lock — silently no-op.
      return null;
    }

    return await fn();
  });
}
```

```ts
// src/routes/cron/billing/+server.ts
import { error } from '@sveltejs/kit';
import { verifyCronSignature } from '$lib/server/cron';
import { withDistributedLock } from '@sveltesentio/jobs/distributed-cron';
import { runNightlyBilling } from '@sveltesentio/billing';

export const POST = async ({ request }) => {
  if (!verifyCronSignature(request)) throw error(401);

  const result = await withDistributedLock('billing.nightly', async () => {
    return await runNightlyBilling();
  });

  return new Response(result === null ? 'skipped (lock held)' : 'ok');
};
```

`pg_try_advisory_xact_lock` is **transaction-scoped** — the lock
auto-releases on commit/rollback. No risk of "leaked locks" if the
process crashes mid-job (txn aborts → lock released).

Cron triggers fire in every region (per [cron-jobs.md](cron-jobs.md)
HTTP-triggered baseline); only one wins the lock and runs the work.
The losers exit cheaply.

## Pattern 2 — fan-out / fan-in

Process 100K user records, then aggregate the results. BullMQ's
`Flow` API + a Postgres aggregation table:

```ts
// packages/jobs/src/fanout-fanin.ts
import { FlowProducer, Queue, Worker } from 'bullmq';
import { uuidv7 } from 'uuidv7';
import { db } from '$lib/server/db';

const flow = new FlowProducer({ connection: redisConfig });

export async function startReportGeneration(reportId: string) {
  const userIds = await db.queryColumn<string>(
    `SELECT id FROM users WHERE active = TRUE`,
  );

  // Each leaf job processes one user; the parent job (aggregate)
  // runs only after ALL children complete.
  await flow.add({
    name: 'aggregate-report',
    queueName: 'reports',
    data: { reportId, totalChildren: userIds.length },
    children: userIds.map((userId) => ({
      name: 'process-user',
      queueName: 'reports',
      data: { reportId, userId },
      opts: {
        jobId: `report:${reportId}:user:${userId}`, // idempotent
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    })),
  });
}

// Leaf worker: each child writes its partial result to a shared table
new Worker('reports', async (job) => {
  if (job.name === 'process-user') {
    const { reportId, userId } = job.data;
    const partial = await computeUserPartial(userId);
    await db.query(
      `INSERT INTO report_partials (report_id, user_id, data) VALUES ($1, $2, $3)
       ON CONFLICT (report_id, user_id) DO UPDATE SET data = EXCLUDED.data`,
      [reportId, userId, JSON.stringify(partial)],
    );
  } else if (job.name === 'aggregate-report') {
    // Parent runs only after all children succeed.
    const { reportId } = job.data;
    const partials = await db.query(
      `SELECT data FROM report_partials WHERE report_id = $1`,
      [reportId],
    );
    const aggregate = combinePartials(partials.rows.map((r) => r.data));
    await db.query(
      `UPDATE reports SET status = 'completed', data = $1 WHERE id = $2`,
      [JSON.stringify(aggregate), reportId],
    );
  }
}, { connection: redisConfig, concurrency: 50 });
```

The parent **does not start** until every child either succeeds or
exhausts retries. Failed children block the aggregation — design
your leaves to be retry-safe + report errors via the partial table.

## Pattern 3 — durable timer (sleep weeks without state)

"Send a follow-up email 7 days after signup, but only if the user
hasn't completed onboarding yet."

BullMQ `delay` works for **<24h** durable delays; for longer, use
**Temporal** or **Inngest** which persist workflow state and
guarantee resumption across deploys:

```ts
// packages/jobs/src/onboarding-followup.ts (Inngest example)
import { inngest } from '$lib/server/inngest';

export const onboardingFollowup = inngest.createFunction(
  { id: 'onboarding-followup', name: 'Onboarding 7-day follow-up' },
  { event: 'user.signed_up' },
  async ({ event, step }) => {
    // Sleep is durable: process can restart, deploy, scale; resumes on time.
    await step.sleep('wait-7-days', '7d');

    const user = await step.run('reload-user', async () =>
      userRepo.findById(event.data.userId),
    );

    if (user.onboardingCompletedAt) {
      // Onboarded already — skip.
      return { skipped: true };
    }

    await step.run('send-reminder-email', async () =>
      sendEmail({
        to: user.email,
        template: 'onboarding-reminder',
        data: { name: user.name },
      }),
    );

    return { sent: true };
  },
);
```

Each `step.sleep` / `step.run` checkpoint is durably persisted by
Inngest. If the process crashes between steps, on restart the
workflow resumes from the last checkpoint with the same inputs. No
need to model state machines manually.

## Pattern 4 — human-in-the-loop signal

"Process refund request: validate → wait for finance approval →
execute → notify customer."

```ts
// packages/jobs/src/refund-flow.ts (Inngest example)
export const refundFlow = inngest.createFunction(
  { id: 'refund-approval', name: 'Refund with approval gate' },
  { event: 'refund.requested' },
  async ({ event, step }) => {
    const validated = await step.run('validate', async () =>
      validateRefund(event.data),
    );
    if (!validated.eligible) return { rejected: validated.reason };

    // Wait for an external "approval" event with matching refundId.
    // Times out after 7 days → auto-rejected.
    const approval = await step.waitForEvent('approval', {
      event: 'refund.approved',
      timeout: '7d',
      match: 'data.refundId',
    });

    if (!approval) {
      await step.run('mark-expired', async () =>
        markRefundExpired(event.data.refundId),
      );
      return { expired: true };
    }

    await step.run('execute', async () => executeRefund(event.data.refundId));
    await step.run('notify', async () =>
      notifyCustomer(event.data.userId, 'refund.completed'),
    );
    return { completed: true };
  },
);
```

Finance approval surface (admin UI, Slack action, etc.) emits
`inngest.send({ name: 'refund.approved', data: { refundId } })`.
The waiting workflow wakes up, runs the rest. The 7-day timeout
prevents infinite parking.

## Pattern 5 — saga with compensations (covered fully in tenant-provisioning.md)

Sketched here for completeness:

```ts
const steps: { undo: () => Promise<void> }[] = [];
try {
  const a = await stepA(); steps.push({ undo: () => undoA(a) });
  const b = await stepB(a); steps.push({ undo: () => undoB(b) });
  const c = await stepC(b); steps.push({ undo: () => undoC(c) });
} catch (err) {
  // Best-effort, idempotent, reverse-order undo.
  for (const s of steps.reverse()) {
    try { await s.undo(); } catch (e) { /* log + continue */ }
  }
  throw err;
}
```

See [tenant-provisioning.md](tenant-provisioning.md) for the full
worked example with Stripe + DB + storage + search-index undo.

## Bounded Zod schemas

```ts
// packages/jobs/src/schema.ts
import { z } from 'zod';

export const JobName = z.enum([
  'billing.nightly',
  'reports.weekly',
  'cleanup.daily',
  'onboarding.followup',
  'refund.flow',
  'tenant.provision',
]);
export type JobName = z.infer<typeof JobName>;

export const WorkflowStatus = z.enum([
  'pending',
  'running',
  'waiting_signal',
  'completed',
  'failed',
  'cancelled',
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatus>;

export const RetryPolicy = z.object({
  maxAttempts: z.number().int().min(1).max(20).default(3),
  initialDelayMs: z.number().int().min(100).max(60_000).default(5000),
  backoff: z.enum(['exponential', 'fixed', 'linear']).default('exponential'),
  maxDelayMs: z.number().int().min(1000).max(3600_000).default(300_000),
});
export type RetryPolicy = z.infer<typeof RetryPolicy>;
```

## Choosing a workflow engine

```text
Need                                | Choice
─────────────────────────────────────|─────────────────────────
Distributed lock only                | BullMQ + pg_try_advisory_xact_lock
Fan-out/fan-in <1000 children        | BullMQ Flow API
Durable timer < 24h                  | BullMQ delay
Durable timer > 24h                  | Inngest (serverless) or Temporal (self-host)
Human-in-the-loop                    | Inngest signals or Temporal signals
Complex multi-step + compensation    | Temporal (best-in-class) or hand-rolled saga
Already on Vercel / serverless       | Inngest (no infrastructure)
Self-host preferred                  | Temporal (complex) or BullMQ (simple)
```

**Default to BullMQ + Postgres locks** until you genuinely need
durable timers > 24h or human-in-the-loop. Adding Temporal/Inngest
is a significant operational burden.

## Anti-patterns (24)

1. **Distributed cron without lock** — same job runs N times in N
   regions; double-billing, duplicate emails, race conditions.
2. **Per-row lock instead of per-job** — N row locks vs 1 job lock;
   massive overhead. Lock the **decision to run**, not each
   operation inside.
3. **Lock without auto-release** — `pg_advisory_lock` (session) vs
   `pg_advisory_xact_lock` (transaction). Use xact unless you need
   cross-transaction.
4. **Lock key collisions** — same hash for two different jobs;
   silent serialization. Pre-compute distinct 64-bit keys.
5. **`setTimeout` for "send in 7 days"** — process restart loses the
   timer; deploy = lost reminder.
6. **BullMQ delay > 24h** — works but impractical (Redis memory
   pressure, no observability into far-future jobs). Use durable
   workflow engine.
7. **Polling DB every minute "to check if any reminders due"** —
   fragile, expensive, easy to skip rows. Use durable timers.
8. **Fan-out without idempotent leaves** — child retry runs work
   twice; partial table double-counts. `jobId` per child + `ON
   CONFLICT DO NOTHING/UPDATE`.
9. **Fan-in without all-children-success guarantee** — aggregate
   runs on partial data. BullMQ Flow waits; Inngest `step.run` in a
   loop with `step.waitForEvent` doesn't.
10. **Workflow that mutates external state inside `step.run`
    without idempotency** — retry double-charges, double-emails.
    Idempotency key on every external call.
11. **Signal name collision across workflows** — wrong workflow
    wakes up. Always namespace signals with workflow + entity id.
12. **No timeout on `waitForEvent`** — workflow parks forever; queue
    fills with zombies. Always cap waits.
13. **Workflow versioning ignored** — running workflow has v1 logic;
    deploy v2 → mid-flight workflow uses inconsistent code. Pin
    workflow version per `step` boundary.
14. **Long-running step inside workflow (5+ min)** — workflow
    timeout fires; step retried but already started side-effects.
    Decompose into smaller steps + idempotent calls.
15. **No DLQ for workflow failures** — failed runs invisible.
    Inngest/Temporal both have failed-run UI; use it.
16. **Saga compensations not idempotent** — compensation retried →
    double-undo; already-undone state corrupted. Each undo checks
    "is this still done?" first.
17. **Compensations not in reverse order** — undoing earlier steps
    before later steps leaves dangling state.
18. **Workflow code in same package as request handlers** — deploy
    of UI changes invalidates running workflows. Separate workflow
    package + version pinning.
19. **No alert on workflow failure rate** — silent regressions.
    SLO: <0.1% of workflows fail per
    [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md)
    SLO-guard.
20. **Cron schedule drift across regions due to clock skew** —
    `cleanup.daily` runs 3am UTC in EU but 2:59am UTC in US;
    near-simultaneous start triggers lock contention. Use NTP +
    intentional jitter.
21. **Job arguments mutated after enqueue** — pass-by-reference
    bug; worker sees different data than enqueuer intended. Always
    serialize at enqueue.
22. **Workflow stores entire payload in event** — Redis/Postgres
    bloat. Store reference (id), reload data inside workflow.
23. **Human-in-the-loop without escalation** — approval pending for
    weeks; nobody notices. Reminders + on-call escalation.
24. **No audit-log on workflow decisions** — refund auto-rejected
    after timeout; finance has no record. Audit each `step.run` +
    each terminal state per [audit-log.md](audit-log.md).

## References

- ADRs: [0019](../adr/0019-server-runtime-contract.md),
  [0023](../adr/0023-compliance-observability.md)
- Sibling recipes:
  [cron-jobs.md](cron-jobs.md),
  [queue-workers.md](queue-workers.md),
  [multi-region-deployment.md](multi-region-deployment.md),
  [tenant-provisioning.md](tenant-provisioning.md),
  [observability.md](observability.md),
  [audit-log.md](audit-log.md),
  [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md),
  [data-migrations.md](data-migrations.md)
- Upstream:
  Temporal `temporal.io/docs`,
  Inngest `www.inngest.com/docs`,
  Trigger.dev `trigger.dev/docs`,
  BullMQ Flow `docs.bullmq.io/guide/flows`,
  PostgreSQL Advisory Locks
  `www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS`,
  Saga pattern (Microservices.io)
  `microservices.io/patterns/data/saga.html`.
