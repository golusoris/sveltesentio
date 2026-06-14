# Cron jobs — scheduled tasks + idempotent execution + overlap locks + observability

SvelteKit has no built-in scheduler — what runs periodically lives
outside the request path. This recipe is the authoritative contract
for scheduled work in sveltesentio: **HTTP-triggered endpoints
(Vercel Cron / Cloudflare Cron Triggers / GitHub Actions / Kubernetes
CronJob) as default, long-lived Node schedulers (`croner`) only when
the host genuinely supports them**. Every job must be idempotent,
overlap-safe, observable, and surviving-missed-runs with an explicit
policy.

Per [principles.md §2.1](../principles.md) (Power of 10 — no silent
failures) and [principles.md §2.2](../principles.md) (OWASP ASVS L2 —
no privileged HTTP endpoints without authentication), the posture
is: **HTTP-triggered is HMAC-signed or authenticated, idempotency is
proven at the database via advisory locks, every run emits a bounded
OTel span with `cron.job.name` + `cron.run.status`**, missed runs are
logged not silently-skipped, and the operator knows within 5 minutes
when a critical job last succeeded.

## Related

- [observability.md](observability.md) — every cron run is a top-
  level OTel span with `cron.job.name` bounded label, duration
  histogram, and error-rate counter; correlationId = `run_id`.
- [rate-limiting.md](rate-limiting.md) — cron HTTP endpoints bypass
  user-facing rate-limits via authenticated bucket `cron:<job>` with
  looser policy.
- [webhooks.md](webhooks.md) — cron-triggered HTTP endpoints share
  the HMAC-verification pattern and dedup table with inbound
  webhooks; `X-Cron-Signature` header parallels `X-Webhook-Signature`.
- [http-client.md](http-client.md) — jobs that call downstream APIs
  use the same `openapi-fetch` client with `Idempotency-Key` header.
- [audit-log.md](audit-log.md) — mutating cron runs append audit rows
  with `actor: 'system:cron:<job>'` for traceability.
- [feature-flags.md](feature-flags.md) — enabling/disabling jobs at
  runtime goes through OpenFeature; never redeploy to toggle a job.
- [clock-injection.md](clock-injection.md) — job code reads `now()`
  from injected clock, never `Date.now()` directly, for test
  determinism.
- [monorepo-releases.md](monorepo-releases.md) — cron schedule
  manifests live in the repo (`cron.json` or platform-specific) and
  change via release PR, never dashboard-edit.
- [service-limits.md](service-limits.md) — cron-driven quota
  enforcement runs daily (soft threshold) / hourly (hard threshold).
- [principles.md §2.1](../principles.md) — Power of 10 (no silent
  failures).
- [principles.md §2.7](../principles.md) — Trunk-Based Dev (schedule
  changes via PR).

## When to reach for what

```text
Vercel deploy              → Vercel Cron (HTTP-triggered, vercel.json)   DEFAULT
Cloudflare Workers         → Cloudflare Cron Triggers (wrangler.toml)    DEFAULT
Self-hosted SvelteKit Node → croner in same process (long-lived)         ESCAPE
Kubernetes                 → K8s CronJob → hits HTTP endpoint            PREFERRED
GitHub-only side-project   → GitHub Actions schedule → curl webhook      OK
Multi-tenant SaaS          → per-tenant schedules in DB + single worker  ESCAPE
```

**Three build rules:**

1. **HTTP-triggered default.** The scheduler lives outside the app
   process. This gives you horizontal scaling, clean blast-radius
   separation, and free retries when the platform supports them.
   Long-lived in-process schedulers (`croner`, `node-cron`) are an
   escape hatch — a second replica silently runs every job twice.
2. **The schedule manifest is code.** `vercel.json`, `wrangler.toml`,
   or `cron.json` committed to the repo. Dashboard-edit = drift +
   no audit trail. Platform-UI-only schedulers are rejected.
3. **Every job is idempotent.** A second run of the same job at the
   same logical tick must be a no-op (or update-to-same-state).
   Platforms sometimes fire twice. Retries on failure fire twice.
   Design for at-least-once, never exactly-once.

### Build-vs-buy matrix

| Option | Use when | Avoid when |
|---|---|---|
| **Vercel Cron** (DEFAULT on Vercel) | Hosted on Vercel; timezone = UTC; second-granularity not needed | Need sub-minute precision / >4000 jobs / custom retry policy |
| **Cloudflare Cron Triggers** (DEFAULT on CF) | Workers deployment; global fan-out | Same precision limits |
| **GitHub Actions schedule** | Side-projects / OSS CI-style jobs | Production SLAs (best-effort, often delayed 10-30 min) |
| **Kubernetes CronJob → HTTP** (ESCAPE for self-host) | Own cluster; mature platform engineering | Small team without K8s operator |
| **`croner` in-process** | Single-replica self-hosted Node; no external scheduler | Multi-replica (double-fires) / serverless (process dies) |
| **Temporal / Inngest / Trigger.dev** | Workflow-orchestration-not-cron (multi-step, durable, long-running) | Simple-periodic-task (cron does it) |
| **`node-cron`** | — | Unmaintained-ish; prefer `croner` for new code |

**Three key rules across platforms:**

1. **UTC everywhere in cron expressions.** `0 3 * * *` is 03:00 UTC,
   never "3 AM server time." Daylight-saving drift = duplicate or
   missing runs twice a year.
2. **No second-granularity.** Cron is minute-granular. If you need
   every-second, you want a long-lived worker, not cron.
3. **Overlap is the default bug.** A job that takes longer than its
   interval will be re-triggered mid-run unless you prevent it.

## Install

No package for the HTTP-triggered default. For self-hosted Node:

```bash
pnpm add croner
```

Platform manifests are declarative:

```jsonc
// vercel.json
{
  "crons": [
    { "path": "/api/cron/daily-cleanup", "schedule": "0 3 * * *" },
    { "path": "/api/cron/quota-recompute", "schedule": "*/15 * * * *" }
  ]
}
```

```toml
# wrangler.toml
[triggers]
crons = ["0 3 * * *", "*/15 * * * *"]
```

## Shape

```text
src/routes/api/cron/
├── daily-cleanup/+server.ts     HTTP-triggered cron endpoint
├── quota-recompute/+server.ts
└── _shared/
    ├── authn.ts                 HMAC / Bearer verification
    ├── runner.ts                withCronRun() wrapper: lock + trace + audit
    └── schemas.ts               CronRunRecord + CronJobName enum

src/lib/cron/
├── registry.ts                  CronJobName → handler map (for in-process)
└── clock.ts                     re-export clock-injection.ts

cron.json                        source-of-truth manifest (mirrored to vercel.json / wrangler.toml)

supabase/migrations/NNN_cron_runs.sql
                                 cron_runs table (dedup + history)
```

## Reference pattern — HTTP-triggered cron endpoint

### 1. Authentication: verify the trigger is the scheduler

Vercel and Cloudflare both send a bearer token. Verify it.

```typescript
// src/routes/api/cron/_shared/authn.ts
import { error } from '@sveltejs/kit';
import { CRON_SECRET } from '$env/static/private';
import { timingSafeEqual } from 'node:crypto';

export function verifyCronRequest(request: Request): void {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    throw error(401, { type: 'urn:sveltesentio:cron:unauthorized', title: 'Unauthorized' });
  }
  const token = auth.slice('Bearer '.length);
  const expected = Buffer.from(CRON_SECRET);
  const given = Buffer.from(token);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw error(401, { type: 'urn:sveltesentio:cron:unauthorized', title: 'Unauthorized' });
  }
}
```

**Four authn rules:**

1. **Bearer token from `process.env.CRON_SECRET`.** Vercel sets this
   automatically on `crons[]` routes; verify on every request.
2. **`timingSafeEqual`** never `===` for secret comparison — avoids
   timing side-channel that leaks length/prefix.
3. **Never expose `/api/cron/*` without authn.** One wide-open cron
   endpoint = anyone on the internet can DoS your expensive job.
4. **No user-facing 401 body** — generic `{type,title}` ProblemError,
   no "invalid token" debug info.

### 2. The `withCronRun()` wrapper: lock + trace + audit

```typescript
// src/routes/api/cron/_shared/runner.ts
import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import { db } from '$lib/db';
import { now } from '$lib/clock';
import { uuidv7 } from '$lib/observability';
import type { CronJobName } from './schemas';

const tracer = trace.getTracer('sveltesentio.cron');

interface CronRunResult {
  processed: number;
  skipped: number;
  details?: Record<string, number | string>;
}

export async function withCronRun<T extends CronRunResult>(
  name: CronJobName,
  handler: (ctx: { runId: string; startedAt: Date }) => Promise<T>,
): Promise<Response> {
  const runId = uuidv7();
  const startedAt = now();

  return tracer.startActiveSpan(
    `cron.${name}`,
    { attributes: { 'cron.job.name': name, 'cron.run.id': runId } },
    async (span) => {
      const lockKey = hashJobName(name);
      const locked = await db.oneOrNone<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [lockKey],
      );

      if (!locked?.locked) {
        span.setAttribute('cron.run.status', 'skipped_overlap');
        span.end();
        return new Response(
          JSON.stringify({ runId, status: 'skipped_overlap' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      try {
        await db.none(
          `INSERT INTO cron_runs (run_id, job_name, started_at, status)
           VALUES ($1, $2, $3, 'running')`,
          [runId, name, startedAt],
        );

        const result = await handler({ runId, startedAt });

        await db.none(
          `UPDATE cron_runs
             SET status = 'ok', finished_at = $2, processed = $3, skipped = $4
             WHERE run_id = $1`,
          [runId, now(), result.processed, result.skipped],
        );

        span.setAttribute('cron.run.status', 'ok');
        span.setAttribute('cron.run.processed', result.processed);
        span.setAttribute('cron.run.skipped', result.skipped);
        span.setStatus({ code: SpanStatusCode.OK });

        return new Response(
          JSON.stringify({ runId, status: 'ok', ...result }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      } catch (err) {
        await db.none(
          `UPDATE cron_runs
             SET status = 'failed', finished_at = $2, error = $3
             WHERE run_id = $1`,
          [runId, now(), String(err)],
        );

        span.recordException(err as Error);
        span.setAttribute('cron.run.status', 'failed');
        span.setStatus({ code: SpanStatusCode.ERROR });

        throw err;
      } finally {
        await db.none('SELECT pg_advisory_unlock($1)', [lockKey]);
        span.end();
      }
    },
  );
}

function hashJobName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return h;
}
```

### 3. Endpoint composition

```typescript
// src/routes/api/cron/daily-cleanup/+server.ts
import type { RequestHandler } from './$types';
import { verifyCronRequest } from '../_shared/authn';
import { withCronRun } from '../_shared/runner';
import { db } from '$lib/db';
import { subDays } from 'date-fns';
import { now } from '$lib/clock';

export const POST: RequestHandler = async ({ request }) => {
  verifyCronRequest(request);

  return withCronRun('daily-cleanup', async () => {
    const cutoff = subDays(now(), 30);

    const result = await db.result(
      `DELETE FROM sessions WHERE expires_at < $1`,
      [cutoff],
    );

    return { processed: result.rowCount ?? 0, skipped: 0 };
  });
};

export const GET = POST;
```

**Four endpoint rules:**

1. **`POST` preferred — `GET` tolerated** for platforms that only
   send `GET` (Vercel Cron sends `GET`). Accept both; `GET` on a
   mutating endpoint is fine *because it's authenticated*.
2. **Return JSON with `runId`** — operators debugging a missed run
   can grep logs by `runId`.
3. **Always return 200 on skipped-overlap** — not 409/503. Platform
   retry policy shouldn't hammer a long-running job.
4. **Propagate unexpected errors** — `withCronRun` re-throws; the
   platform then retries per its policy. Never `try/catch/return 200`
   to silence errors.

## Idempotency — the dedup table

```sql
CREATE TABLE cron_runs (
  run_id       UUID PRIMARY KEY,
  job_name     TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  finished_at  TIMESTAMPTZ,
  status       TEXT NOT NULL CHECK (status IN ('running','ok','failed','skipped_overlap')),
  processed    INTEGER,
  skipped      INTEGER,
  error        TEXT,

  CONSTRAINT cron_runs_job_name_check
    CHECK (length(job_name) <= 64)
);

CREATE INDEX cron_runs_job_started_idx ON cron_runs (job_name, started_at DESC);
CREATE INDEX cron_runs_status_idx ON cron_runs (status) WHERE status != 'ok';
```

**Five idempotency rules:**

1. **Every run gets a `run_id` (UUIDv7).** Threads through OTel
   spans, logs, and audit entries. Operators chase a single run by
   UUID.
2. **Advisory lock prevents overlap.** `pg_try_advisory_lock` is
   non-blocking and auto-released on session end — safer than
   row-locks that can deadlock. One lock per job_name.
3. **Handler logic must be idempotent independently** of the lock.
   The lock prevents *concurrent* overlap but not *sequential*
   retries — a second run 2 seconds after the first (platform
   retry) finds no lock held and runs the handler. That handler must
   be idempotent by design.
4. **Use `ON CONFLICT DO NOTHING`** for inserts that a retry
   shouldn't duplicate; `ON CONFLICT DO UPDATE` for re-compute jobs
   where latest-wins is correct.
5. **`started_at`-based queries are deliberately rough** — don't
   depend on exact tick times. Handlers read the window they want
   from their own state (`WHERE last_processed_at > …`), not from
   the trigger time.

## Missed-run policy

```typescript
const MISSED_RUN_POLICY: Record<CronJobName, 'catchup' | 'skip-forward'> = {
  'daily-cleanup':    'skip-forward',
  'quota-recompute':  'catchup',
  'invoice-finalize': 'catchup',
  'session-rotate':   'skip-forward',
} satisfies Record<CronJobName, 'catchup' | 'skip-forward'>;
```

**Three missed-run rules:**

1. **Default is `skip-forward`.** If the 03:00 run was missed, run
   tomorrow's 03:00 and move on. Catchup is for financial /
   billing / quota work where every interval must be accounted.
2. **Catchup runs the *latest* missed interval, not all of them.**
   If cron fires once after an 8-hour outage, the handler looks at
   its high-water-mark and processes from there to `now()` — one
   run, one pass. Never loop `for (i=0; i<missed; i++) run()`.
3. **Alert on missed runs.** `cron_runs` row not present in the
   expected interval window → OTel alert `cron.missed_run`. A silent
   miss is worse than a crash.

## Observability — the bounded label set

```text
Span name:       cron.<job_name>                           (e.g. cron.daily-cleanup)
Attributes:      cron.job.name           (bounded enum: CronJobName)
                 cron.run.id             (UUIDv7)
                 cron.run.status         (ok | failed | skipped_overlap)
                 cron.run.processed      (integer counter)
                 cron.run.skipped        (integer counter)
                 cron.run.duration_ms    (via span duration, not attribute)
Metrics:         cron.run.count          (counter, labels: job, status)
                 cron.run.duration       (histogram, labels: job)
                 cron.missed_run.count   (counter, labels: job)
```

**Five observability rules:**

1. **`cron.job.name` is a bounded enum**, same as every other OTel
   label. New job = new enum value + ADR (if durable) or just PR
   approval.
2. **Never put `run_id` as a label** — unbounded cardinality kills
   Prometheus. It's a span attribute (low-cardinality per span),
   not a metric label.
3. **Duration is the span duration** — don't emit your own
   `cron.run.duration_ms` counter; span histograms are the
   authoritative source.
4. **Alert on `failure_rate > 0` and `missed_run > 0`**, not just
   latency. A never-running cron isn't late — it's broken.
5. **Retention: 90 days** on `cron_runs` table via `DELETE WHERE
   finished_at < now() - interval '90 days'` in the
   `daily-cleanup` job itself (eat your own dog food).

## Self-hosted Node: `croner` (escape hatch)

```typescript
// src/hooks.server.ts (only on single-replica long-lived deploys)
import { Cron } from 'croner';
import { CRON_ENABLED } from '$env/static/private';
import { dailyCleanup, quotaRecompute } from '$lib/cron/handlers';

if (CRON_ENABLED === 'true' && !globalThis.__cronStarted) {
  globalThis.__cronStarted = true;

  new Cron('0 3 * * *', { name: 'daily-cleanup', protect: true, timezone: 'UTC' }, dailyCleanup);
  new Cron('*/15 * * * *', { name: 'quota-recompute', protect: true, timezone: 'UTC' }, quotaRecompute);
}
```

**Five in-process-scheduler rules:**

1. **Guard with `CRON_ENABLED` env var** — only the designated
   replica runs cron. Scaling to 2 replicas with `CRON_ENABLED=true`
   on both = every job fires twice per tick.
2. **`globalThis.__cronStarted` guard** — SvelteKit dev mode
   hot-reloads `hooks.server.ts` and would spawn N schedulers. The
   guard survives HMR.
3. **`protect: true`** — croner's built-in overlap prevention. This
   is *in addition* to the DB advisory lock — belt and suspenders.
4. **`timezone: 'UTC'`** — always. Even if the server is in UTC by
   default, pin it so DST-on-the-host can't break you.
5. **Handlers are identical to HTTP-triggered handlers** — they go
   through `withCronRun()`. Same lock, same audit, same OTel. The
   only difference is the trigger.

## Testing — three lanes

```typescript
// unit: handler runs deterministically under injected clock
it('daily-cleanup removes expired sessions', async () => {
  const clock = fixedClock('2026-04-18T00:00:00Z');
  seedDb([
    { id: 's1', expires_at: '2026-03-17T00:00:00Z' }, // 32 days ago → delete
    { id: 's2', expires_at: '2026-04-17T00:00:00Z' }, // 1 day ago → keep
  ]);

  const result = await dailyCleanup({ runId: 'r1', startedAt: clock.now() });

  expect(result).toEqual({ processed: 1, skipped: 0 });
});

// integration: HTTP endpoint with auth + DB
it('POST /api/cron/daily-cleanup returns 401 without bearer', async () => {
  const res = await app.request('/api/cron/daily-cleanup', { method: 'POST' });
  expect(res.status).toBe(401);
});

// integration: second concurrent run skips via lock
it('concurrent runs return skipped_overlap on the loser', async () => {
  const [a, b] = await Promise.all([
    app.request('/api/cron/daily-cleanup', { method: 'POST', headers: authHeader() }),
    app.request('/api/cron/daily-cleanup', { method: 'POST', headers: authHeader() }),
  ]);
  const statuses = [await a.json(), await b.json()].map((r) => r.status).sort();
  expect(statuses).toEqual(['ok', 'skipped_overlap']);
});
```

**Three test rules:**

1. **Handlers accept an injected clock**, never read
   `Date.now()`/`new Date()`. Otherwise schedule-edge tests
   (end-of-month, DST) become flaky.
2. **Overlap-lock tested explicitly** — fire two requests in
   parallel, assert one wins and one returns `skipped_overlap`.
   This is the single easiest thing to regress.
3. **Smoke-run in staging via `vercel cron trigger`** (or platform
   equivalent) pre-prod — prove the authn + the OTel pipeline work
   end-to-end before depending on the job in prod.

## Anti-patterns

1. **`setInterval` in a long-lived route.** Dies when the route is
   evicted; double-fires if the route is kept alive across
   hot-reloads. Use `croner` at the hooks level or HTTP-triggered.
2. **Unauthenticated `/api/cron/*`.** Anyone on the internet can
   DoS your expensive recompute job. Always bearer-gated.
3. **No overlap lock.** A 12-minute job on a 10-minute schedule
   stampedes itself — two runs, then three, then your DB melts.
4. **Reading trigger time as "what to process."** Platforms
   sometimes fire early/late/twice. Handlers read their own
   high-water-mark, not the cron tick.
5. **Cron schedule edited in a platform dashboard.** Drift between
   repo and prod, no audit, no rollback. Manifests are code.
6. **Second-granularity expectations.** Cron is minute-granular at
   best; platform cron is often ±60s. If you need "exactly every
   10 seconds" you want a worker, not cron.
7. **Local-timezone cron expressions.** `0 3 * * *` in
   `America/New_York` flips by one hour twice a year. UTC or go
   home.
8. **Catchup that loops through missed intervals.** `for (i=0; i<n;
   i++) run()` turns an 8-hour outage into 96 concurrent 5-minute
   jobs. Process the span once from the high-water-mark.
9. **Swallowing errors to return 200.** The platform can't retry
   what it thinks succeeded. Re-throw and let the platform retry
   policy do its job (and your `cron.run.status=failed` metric
   light up).
10. **Per-tenant loop without batching.** `for (const tenant of
    tenants) await processTenant(tenant)` in a single cron run
    means tenant #500 waits for 499 predecessors. Either fan-out
    (per-tenant HTTP sub-trigger) or batch (parallel with
    `Promise.allSettled` and concurrency cap).
11. **Cron that calls its own app HTTP endpoints in a loop.**
    Self-DoS — `/api/cron/X` hammers `/api/users/:id` 10k times
    through the load balancer. Use the DB directly or a service
    boundary, not your own public endpoints.
12. **Running cron in dev mode unintentionally.** `CRON_ENABLED`
    flag default = `false`; dev-run is opt-in. Nothing worse than
    `pnpm dev` sending "daily" production-shaped emails.
13. **No visibility into "when did it last succeed?".** A dashboard
    panel per critical job: `time_since_last_ok_run < alert_threshold`.
    Silent success is fine; silent silence is a page.
14. **Audit row missing `actor: 'system:cron:<job>'`.** Post-hoc
    incident: "who deleted these rows?" — `user_id = null` is not
    an answer. Every mutating cron writes audit with actor identity.
15. **Mixing cron with user-facing endpoints on the same route.**
    `/api/admin/cleanup?mode=cron` is both a UI action and a
    scheduled job. Split: two endpoints, same handler function,
    different auth + observability.

## References

- [ADR-0019 — structured errors](../adr/0019-structured-errors.md) —
  cron failures flow through the same ProblemError envelope.
- [ADR-0023 — observability](../adr/0023-observability.md) — UUIDv7
  `run_id`, bounded `cron.job.name` label.
- [observability.md](observability.md) — OTel span structure.
- [webhooks.md](webhooks.md) — sibling HMAC-signed-HTTP pattern.
- [rate-limiting.md](rate-limiting.md) — authenticated cron bucket.
- [audit-log.md](audit-log.md) — `actor: 'system:cron:<job>'`.
- [clock-injection.md](clock-injection.md) — deterministic time.
- [service-limits.md](service-limits.md) — cron-driven quota
  enforcement.
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs) — platform
  docs.
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) — platform docs.
- [`croner`](https://github.com/hexagon/croner) — self-hosted Node
  scheduler.
- [PostgreSQL advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS) — `pg_try_advisory_lock` semantics.
- [crontab.guru](https://crontab.guru/) — validate expressions.
