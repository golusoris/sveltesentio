# Queue workers — BullMQ default, Inngest / Trigger.dev escapes, idempotent consumers, DLQ

> Event-driven asynchronous processing for work that must not block
> the request/response cycle (emails, heavy compute, webhooks fan-out,
> notifications). Defaults to BullMQ on Redis per
> [ADR-0019](../adr/0019-openapi-fetch-rfc9457.md) RFC 9457 error
> envelope parity with HTTP paths, plus [ADR-0023](../adr/0023-uuidv7-default.md)
> UUIDv7 for job IDs. Inngest + Trigger.dev are escape hatches for
> workflow-shaped work (long-running, step-based, durable resume)
> where BullMQ's retry model is too coarse.

A queue is **event-driven**, a cron is **schedule-driven** — see
[cron-jobs.md](cron-jobs.md) for the schedule side. Work that is
"send an email when a user signs up" belongs in a queue; work that is
"reconcile billing every midnight" belongs in cron. Workflows that
span days with human approval steps and sub-step observability belong
in Inngest/Trigger.dev, not BullMQ — BullMQ's graph ends at "job
retried N times, dead-lettered".

## Related

- [cron-jobs.md](cron-jobs.md) — scheduled counterpart to queue
- [webhooks.md](webhooks.md) — inbound HMAC receiver that typically
  enqueues downstream
- [http-client.md](http-client.md) — Idempotency-Key contract for
  workers calling external APIs
- [structured-emails.md](structured-emails.md) — most common producer
- [email-deliverability.md](email-deliverability.md) — bounce/complaint
  webhook feeds worker-side suppression
- [rate-limiting.md](rate-limiting.md) — worker throughput throttling
- [observability.md](observability.md) — OTel span per job
- [audit-log.md](audit-log.md) — audit entry after job success
- [ADR-0019](../adr/0019-openapi-fetch-rfc9457.md) — error envelope
- [ADR-0023](../adr/0023-uuidv7-default.md) — UUIDv7 job IDs

## When to use what — decision tree

```text
Sub-second latency requirement                       → sync HTTP path (not a queue)
Fire-and-forget with <10 s acceptable latency        → BullMQ (DEFAULT)
Workflows: multi-step, durable, human-in-the-loop    → Inngest OR Trigger.dev
Long-running >15 min, resumable after deploy         → Trigger.dev
Pub/sub fanout across services                       → NATS / Kafka (app-level, held)
Scheduled recurring job                              → cron-jobs.md (NOT a queue)
Throttled external-API batch                         → BullMQ with rate-limiter
Email send                                           → BullMQ via structured-emails.md
```

## Build-vs-buy matrix

| Option | Fit | Cost shape | Notes |
|---|---|---|---|
| **BullMQ** | DEFAULT self-host | Redis compute + ops | Full control, strong Redis story, proven |
| **Inngest** | Workflow abstraction | Per-run cloud | Great DX for multi-step; steps are durable |
| **Trigger.dev** | Long-running resumable | Per-run cloud | Best for >15 min jobs, resume-after-deploy |
| pg-boss | Postgres-only, small scale | DB compute | Fine when ≤1k jobs/hr, avoids Redis |
| Temporal | Workflow-native, enterprise | Self-host cluster | Overkill for most apps |
| AWS SQS + Lambda | Cloud-native fanout | Per-request | Fine when already on AWS; poor local DX |
| `node-cron` + `setInterval` | NEVER | — | No durability, no retry, no observability |

## Install

```bash
pnpm add bullmq ioredis
# Escapes (pick one per domain — not both):
pnpm add inngest
# pnpm add @trigger.dev/sdk
```

## Three build rules

1. **Every job is idempotent by design.** At-least-once delivery is
   the floor — duplicates WILL happen on retry, failover, or deploy.
2. **Job types are bounded Zod enums**, payloads are Zod-validated on
   enqueue AND on consume. Never trust "the producer and I agree".
3. **Every job emits an OTel span and an audit trail on terminal
   state.** "It ran somewhere, sometime" is not acceptable.

## Shape — bounded job registry

```ts
// src/lib/queue/types.ts
import { z } from 'zod';

export const JobName = z.enum([
  'email.transactional.send',
  'email.bounce.process',
  'image.variant.generate',
  'webhook.outbound.deliver',
  'user.welcome.sequence',
  'export.csv.build',
  'notification.push.send',
]);
export type JobName = z.infer<typeof JobName>;

export const JobPayloads = {
  'email.transactional.send': z.object({
    to: z.string().email(),
    template: z.string(),
    locale: z.enum(['en', 'de', 'fr']),
    vars: z.record(z.string(), z.unknown()),
    correlationId: z.string().uuid(),
  }),
  'image.variant.generate': z.object({
    originalId: z.string().uuid(),
    width: z.number().int().min(16).max(3840),
    format: z.enum(['avif', 'webp', 'jpeg']),
  }),
  // ...
} as const;

export type JobPayload<N extends JobName> = z.infer<(typeof JobPayloads)[N]>;
```

Six registry rules:

1. **Job names are dotted bounded enums** — `domain.noun.verb` —
   never free-form strings.
2. **Payload per job name is Zod** — no `unknown` escape.
3. **Schema versions are additive** — add optional fields; if a
   breaking change is needed, mint `email.transactional.send.v2`.
4. **`correlationId` (UUIDv7) in every payload** so logs + audit +
   OTel trace link.
5. **No PII in job name or queue metrics labels** — put it in the
   payload, never in an observability label.
6. **Registry is the single import** — producers and consumers both
   import from it, so schemas cannot drift.

## BullMQ — connection + queue setup

```ts
// src/lib/queue/connection.ts
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { env } from '$env/dynamic/private';

export const redisConnection: ConnectionOptions = {
  host: env.REDIS_HOST,
  port: Number(env.REDIS_PORT),
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: null, // required by BullMQ workers
  enableReadyCheck: false,
};

export const queues = {
  default: new Queue('default', { connection: redisConnection }),
  emails: new Queue('emails', { connection: redisConnection }),
  images: new Queue('images', { connection: redisConnection }),
} as const;
```

Six queue-separation rules:

1. **One queue per concurrency/priority class**, not one per job
   name. Emails + image generation need different worker counts and
   timeouts.
2. **`maxRetriesPerRequest: null`** — BullMQ requires it; default
   Redis behavior drops commands on reconnect.
3. **`enableReadyCheck: false`** — avoids a known BullMQ reconnect
   deadlock with Redis Sentinel.
4. **Never share the Redis instance** across BullMQ and application
   cache without separate DB indices — eviction on cache DB can wipe
   job state.
5. **Do not reuse the connection across Queue and Worker**
   instances — BullMQ docs are explicit; each gets its own.
6. **Name queues `<service>.<purpose>`** when multiple services share
   Redis — prevents collision on shared clusters.

## Producer — enqueue helper

```ts
// src/lib/queue/enqueue.ts
import { uuidv7 } from 'uuidv7';
import { queues } from './connection';
import { JobName, JobPayloads, type JobPayload } from './types';

type EnqueueOpts = {
  delayMs?: number;
  priority?: 1 | 5 | 10;
  dedupeKey?: string;
};

export async function enqueue<N extends (typeof JobName.options)[number]>(
  name: N,
  payload: JobPayload<N>,
  opts: EnqueueOpts = {},
): Promise<string> {
  const validated = JobPayloads[name].parse(payload);
  const jobId = opts.dedupeKey ?? uuidv7();
  const queueName = routeToQueue(name);

  await queues[queueName].add(name, validated, {
    jobId,
    delay: opts.delayMs,
    priority: opts.priority ?? 5,
    attempts: 10,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 604800 },
  });

  return jobId;
}
```

Seven enqueue rules:

1. **Validate on enqueue** — catch producer bugs before they hit the
   worker, which may not run for minutes.
2. **`jobId` is the dedupe key** — BullMQ treats duplicate IDs as
   no-ops. Use `dedupeKey` (e.g. `user:${userId}:welcome`) to collapse
   retries from the producer side.
3. **UUIDv7 default** so job IDs sort by creation for debug dashboards.
4. **`attempts: 10` + exponential backoff** — covers most transient
   failures; permanent failures should be caught in-handler and
   short-circuited to DLQ.
5. **`removeOnComplete` with age + count** — keeps the last hour or
   last 1000 jobs for debugging, then evicts. Unbounded retention fills
   Redis memory.
6. **`removeOnFail` age 7 days** — leave failed jobs visible long
   enough to triage.
7. **Never enqueue from inside a DB transaction** — commit first,
   then enqueue. Otherwise the worker may process before the write is
   visible.

## Worker — `withJobRun()` wrapper

```ts
// src/lib/queue/worker.ts
import { Worker, type Job } from 'bullmq';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { redisConnection } from './connection';
import { JobName, JobPayloads } from './types';
import { audit } from '$lib/audit';

const tracer = trace.getTracer('queue');

export function makeWorker(
  queueName: string,
  handlers: { [N in JobName]?: (payload: JobPayload<N>) => Promise<void> },
  concurrency = 10,
) {
  return new Worker(
    queueName,
    async (job: Job) => {
      const parsedName = JobName.safeParse(job.name);
      if (!parsedName.success) throw new Error(`unknown job name: ${job.name}`);
      const name = parsedName.data;
      const handler = handlers[name];
      if (!handler) throw new Error(`no handler for ${name}`);

      const payload = JobPayloads[name].parse(job.data);

      await tracer.startActiveSpan(
        `queue.${name}`,
        {
          attributes: {
            'queue.job.name': name,
            'queue.job.id': job.id ?? '',
            'queue.attempt': job.attemptsMade,
          },
        },
        async (span) => {
          try {
            await handler(payload as never);
            span.setStatus({ code: SpanStatusCode.OK });
            await audit('job_succeeded', {
              actor: 'system:queue',
              subject: name,
              correlationId: (payload as { correlationId?: string }).correlationId,
            });
          } catch (err) {
            span.recordException(err as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw err; // BullMQ increments attempts + retries
          } finally {
            span.end();
          }
        },
      );
    },
    {
      connection: redisConnection,
      concurrency,
      limiter: { max: 100, duration: 1000 },
      lockDuration: 30_000,
      stalledInterval: 30_000,
      maxStalledCount: 1,
    },
  );
}
```

Eight worker rules:

1. **Span per job, not per batch** — one `queue.<name>` span with
   attempt number as attribute.
2. **Bounded `queue.job.name` as attribute or label** — never `job.id`
   as a label (cardinality explosion).
3. **Validate payload on consume** — even though producer validated.
   Corrupt Redis state, schema drift, replays — defense in depth.
4. **Throw to retry; return to succeed.** Do not catch errors and
   return normally — the job will be marked "done" and the retry is
   lost.
5. **`limiter` bounds external-API call rate** — 100 jobs/s on the
   email queue prevents hitting Postmark's rate limit.
6. **`lockDuration` > p99 job duration** — otherwise BullMQ considers
   the job stalled and re-enqueues it while still running.
7. **`maxStalledCount: 1`** moves chronically stalled jobs to failed
   state rather than infinitely re-claimed.
8. **`concurrency` is per-worker-process** — horizontal scaling
   multiplies, so size both together.

## Idempotency pattern

Five rules:

1. **Use `correlationId` from payload as the external-side dedupe
   key** — `Idempotency-Key` on HTTP calls, `event_id UNIQUE` on DB
   inserts.
2. **Check "already done" at job start** — query the target state; if
   the side-effect is already applied (e.g. email has `sent_at`), no-op
   and succeed.
3. **Use transactional outbox** for "enqueue after DB write" —
   enqueue from a follower-cron reading an `outbox_events` table
   instead of direct `enqueue()` inside a mutation. Avoids the lost-
   write race on producer crash.
4. **Never rely on "retries are rare"** — deploy-time restarts, worker
   crashes, and network partitions make them common enough to matter.
5. **Writes with side effects (payment, email) need ledgers** — the
   ledger is the idempotency evidence; the job is the trigger.

## DLQ and permanent-failure handling

```ts
// src/lib/queue/dlq.ts
import { Worker, QueueEvents } from 'bullmq';
import { redisConnection } from './connection';
import { notifyOpsChannel } from '$lib/ops';

export function attachDLQ(queueName: string) {
  const events = new QueueEvents(queueName, { connection: redisConnection });
  events.on('failed', async ({ jobId, failedReason, prev }) => {
    if (prev !== 'active') return; // only count terminal failures
    await notifyOpsChannel({
      severity: 'warn',
      summary: `job ${queueName}/${jobId} permanently failed`,
      failedReason,
    });
    await recordDLQEntry(queueName, jobId, failedReason);
  });
}
```

Six DLQ rules:

1. **Listen to `QueueEvents` in a separate process** — don't add this
   to the worker loop.
2. **Record DLQ entries in a DB table**, not just Redis — survives
   Redis eviction/flush.
3. **Manual retry UI** — ops should be able to re-enqueue a failed
   job after fixing the underlying issue without writing SQL.
4. **Ping ops on first DLQ entry per hour per job-type**, not on
   every failure — fatigue kills paging.
5. **Failed payload stays queryable** — it is the evidence for the
   bug fix. Redact PII before display in the ops UI.
6. **Auto-discard only for known-discardable error types** — e.g.
   "user deleted mid-job"; everything else requires human review.

## Retry strategy

Five retry rules:

1. **Exponential backoff with full jitter** — `random(0, base *
   2^attempt)` — avoids thundering-herd after an upstream recovers.
2. **Cap at 10 attempts or 24 h** (whichever first) — otherwise jobs
   linger forever.
3. **4xx external responses are permanent failures**; 5xx and network
   errors are retryable. Wrap external calls to classify explicitly.
4. **Rate-limit errors (429) honor `Retry-After`** — BullMQ
   `Job.moveToDelayed(retryAfter)` rather than immediate backoff.
5. **Dead-after-first-attempt for "poisonous" payloads** — schema
   validation failure, missing required resource. Retrying will not
   fix a malformed payload.

## Graceful shutdown

```ts
// src/lib/queue/shutdown.ts
export async function shutdownWorker(worker: Worker): Promise<void> {
  await worker.close(true); // true = wait for in-flight jobs
}

process.on('SIGTERM', async () => {
  await Promise.all(Object.values(workers).map(shutdownWorker));
  process.exit(0);
});
```

Five shutdown rules:

1. **SIGTERM waits for in-flight**; SIGKILL is the last resort.
2. **Stop accepting new jobs first**, then drain — `worker.close(true)`
   handles both.
3. **Bound drain time** with a Kubernetes `terminationGracePeriodSeconds`
   larger than the longest expected job.
4. **On timeout, let the job retry** — BullMQ will pick up stalled
   jobs via `stalledInterval`.
5. **Never exit inside the job handler** — `process.exit()` in a
   worker corrupts job state.

## Workflow escape — Inngest

```ts
// src/lib/workflows/welcome.ts
import { inngest } from '$lib/inngest/client';

export const welcome = inngest.createFunction(
  { id: 'user.welcome', retries: 3 },
  { event: 'user/signed_up' },
  async ({ event, step }) => {
    await step.run('send-welcome', () => sendEmail(event.data.userId, 'welcome'));
    await step.sleep('wait-2-days', '2d');
    await step.run('send-tips', () => sendEmail(event.data.userId, 'tips'));
    const engaged = await step.run('check-engagement', () =>
      checkEngagement(event.data.userId),
    );
    if (!engaged) {
      await step.run('send-nudge', () => sendEmail(event.data.userId, 'nudge'));
    }
  },
);
```

Five Inngest rules:

1. **Each `step.run` is durable** — survives deploys and worker
   crashes; BullMQ cannot do this.
2. **`step.sleep` is free** — no worker spinning during the 2-day
   delay, unlike BullMQ delay jobs which hold a slot.
3. **Retries are per-step**, not per-function.
4. **Event-triggered, not direct-invoked** — decouples producers
   from workflow definition.
5. **Default to BullMQ** unless you need `step.sleep >1 h`, human-in-
   the-loop approvals, or resume-after-deploy.

## Observability

Bounded labels only:

- `queue.name` — bounded enum
- `queue.job.name` — bounded enum (from registry)
- `queue.status` — `success|failed|stalled|delayed`
- `queue.attempt_bucket` — `1|2-3|4-5|6-10|>10`
- `queue.latency_bucket` — `<1s|1-10s|10-60s|>60s`

Gauges:

- `queue.depth` per queue
- `queue.oldest_pending_age_s` per queue — paging threshold if >60 s
  on critical queues
- `queue.worker.active` — expected concurrency met
- `queue.worker.stalled_per_hour` — >5 on a single worker = bug

Alerts:

- Depth > N for >5 min (per queue)
- DLQ rate >0.1 %/hour of throughput
- Oldest-pending > SLO (queue-specific)
- Worker count below expected (autoscaler failure)

## Testing

```ts
// src/lib/queue/handler.spec.ts
import { describe, it, expect } from 'vitest';
import { sendEmailHandler } from './handlers/email';

describe('sendEmailHandler', () => {
  it('is idempotent on replay', async () => {
    const payload = { to: 'a@b.c', template: 'welcome', locale: 'en', vars: {}, correlationId: 'x' };
    await sendEmailHandler(payload);
    await sendEmailHandler(payload);
    expect(outboundSpy.calls).toHaveLength(1);
  });
  it('rejects unknown template', async () => { /* ... */ });
  it('retries on 5xx', async () => { /* ... */ });
  it('permanently fails on 4xx', async () => { /* ... */ });
});
```

Four test lanes:

1. **Unit — handler is a pure async function** given a payload;
   mock side effects and assert idempotency.
2. **Integration** — enqueue + process end-to-end against real Redis
   via `testcontainers`.
3. **Chaos** — kill the worker mid-handler, verify replay completes.
4. **Load** — simulate bursty producer, confirm `queue.depth` drains
   within SLO.

## Anti-patterns

1. **Using a queue for synchronous latency-critical work** — queues
   add seconds of tail latency; a blocking HTTP call is fine for
   <100 ms work.
2. **`setInterval` or `node-cron` in a request process** — no
   durability, no observability, no retry. Queue or cron-jobs.md.
3. **Enqueue inside a DB transaction** — producer crash after commit
   loses the enqueue; enqueue after commit or use outbox pattern.
4. **Free-form job name strings** — cardinality bomb, no type safety.
5. **No payload Zod on consume** — producer bug or schema drift
   silently poisons the queue.
6. **Silent catch-and-return** in handler — job marked "done", bug
   hidden.
7. **Unbounded retries** — jobs live forever, Redis fills up.
8. **Immediate retry without backoff** — thundering herd during
   outages.
9. **`lockDuration` < p99 job duration** — chronic stall-and-retry
   loop.
10. **Shared Redis DB index for cache + queue** — cache eviction
    deletes jobs.
11. **Job name in OTel labels as free-form** — cardinality bomb.
12. **No DLQ** — failed jobs vanish; you learn about the bug from the
    user report instead of paging.
13. **Retrying 4xx on external API** — a 404 from an external service
    is permanent; retrying wastes budget and masks the real failure.
14. **No graceful shutdown** — deploys kill in-flight jobs mid-side-
    effect.
15. **Single queue for everything** — a slow email sender starves the
    fast-path image variant worker.
16. **Horizontal scaling without a limiter** — 50 pods × 10 concurrency
    × 100 req/s = rate-limit lockout on the upstream.
17. **No `correlationId`** — logs, audit, and OTel cannot be joined.
18. **Using Inngest/Trigger.dev for sub-second fire-and-forget** —
    per-run billing is wasted, BullMQ is the better tool.
19. **Polling the queue for status from the UI** — expose job state
    via a dedicated `/jobs/:id` endpoint backed by BullMQ
    `getJobState`, not ad-hoc Redis reads.
20. **DLQ alert per-failure spam** — fatigue; aggregate by hour per
    job type.

## References

- [ADR-0019 — openapi-fetch + RFC 9457](../adr/0019-openapi-fetch-rfc9457.md)
- [ADR-0023 — UUIDv7 default](../adr/0023-uuidv7-default.md)
- [BullMQ documentation](https://docs.bullmq.io/)
- [Inngest — step functions](https://www.inngest.com/docs/functions/steps)
- [Trigger.dev — long-running tasks](https://trigger.dev/docs/v3/tasks)
- [Transactional Outbox pattern](https://microservices.io/patterns/data/transactional-outbox.html)
- [cron-jobs.md](cron-jobs.md) / [webhooks.md](webhooks.md) / [structured-emails.md](structured-emails.md) / [rate-limiting.md](rate-limiting.md) / [observability.md](observability.md) / [audit-log.md](audit-log.md)
