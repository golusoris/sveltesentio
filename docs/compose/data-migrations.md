# Data migrations — forward-only + zero-downtime + expand/contract

> Relational schema + data migrations executed as **forward-only**,
> **zero-downtime** changes via the **expand/contract** pattern
> (a.k.a. parallel-change). Composes
> [backup-recovery.md](backup-recovery.md),
> [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md),
> [observability.md](observability.md),
> [queue-workers.md](queue-workers.md),
> [secrets-management.md](secrets-management.md), and
> [admin-ui-patterns.md](admin-ui-patterns.md). Every migration is
> **reviewed, reversible only by forward-fix**, **backward-compatible
> across at least one deploy**, and **accompanied by a runbook**.

Data migrations are **the most dangerous boring work in any
codebase**. The difference between a seamless rollout and a
multi-hour outage is the discipline applied to *boring* steps. The
patterns below prioritize **safety, reversibility-by-roll-forward,
and observability over velocity**. A migration that "usually works"
is a migration that will take the database down.

## Related

- [backup-recovery.md](backup-recovery.md) — PITR baseline before every migration
- [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md) — dual-write flag + cutover flag
- [queue-workers.md](queue-workers.md) — backfills run as jobs with backoff + DLQ
- [secrets-management.md](secrets-management.md) — migration-runner has its own elevated credentials
- [admin-ui-patterns.md](admin-ui-patterns.md) — migration status dashboard
- [observability.md](observability.md) — progress gauges, lock-wait alerts
- [caching.md](caching.md) — cache invalidation after schema change
- [api-versioning.md](api-versioning.md) — external surface compat during migration
- [audit-log.md](audit-log.md) — every migration audited with version + applied_at
- [ADR-0019](../adr/0019-error-model.md) — ProblemError on migration-runner failure
- [ADR-0023](../adr/0023-uuidv7-default.md) — UUIDv7 ids for migration batches

## When to use what — decision tree

```text
Add a nullable column, default null               → single-step migration (still review!)
Add a non-null column with default                → expand/backfill/contract (THIS)
Rename a column                                   → expand (new col) + dual-write + migrate reads + contract
Drop a column                                     → stop-writing + verify-no-reads + contract (THIS)
Rename a table                                    → new-table + dual-write + cut reads + drop old (THIS)
Change column type (widen)                         → dual-column + cast + cut + drop
Change column type (narrow)                        → app-level validate + dual + cut + drop (riskier)
Move data to a new shape (denorm/reshape)          → backfill worker with batches (THIS)
Move data across services / DBs                    → dual-write + verify + cut + retire
Drop a unique index                                → single-step (usually safe; lock-aware)
Add a unique index on large table                  → `CREATE INDEX CONCURRENTLY` (THIS) + validate
Change default value                              → single-step, but re-run against existing rows?
                                                    → if yes: expand/contract
```

## Three build rules

1. **Forward-only.** No `down` migrations. Every change is fixed
   by a new migration, not by reverting.
2. **Zero-downtime via expand/contract.** Breaking changes are
   split across at least two deploys: expand (new schema coexists
   with old), cut (traffic moves), contract (old schema removed).
3. **Every migration has a runbook.** Preflight checks, expected
   duration, lock strategy, rollback trigger (= deploy previous
   app version, since schema is forward-only), observability
   targets, success criteria.

## Migration inventory file

```text
migrations/
  20260418-0001-add-users-deleted-at.sql
  20260418-0002-backfill-users-deleted-at.ts
  20260418-0003-users-deleted-at-not-null.sql
  README.md                                      ← runbook index
```

Five file rules:

1. **Timestamp + ordinal prefix** (`20260418-0001-…`) — globally
   sortable, conflict-free across branches that merge out of
   order.
2. **One migration per file** — a rename is three files, not one.
3. **`.sql` for schema, `.ts` for data** — schema is declarative
   and reviewable; data needs application logic, typed batching,
   progress tracking.
4. **README.md lists every migration** with link, risk class,
   expected duration, dependencies.
5. **Committed to the main repo**, not a separate infra repo —
   schema co-evolves with the app.

## Runner

```ts
// packages/db/src/migrate/runner.ts
import { z } from 'zod';
import { clock } from '@sveltesentio/core/clock';

export const MigrationRecord = z.object({
  id: z.string().regex(/^\d{8}-\d{4}-[a-z0-9-]+$/),
  kind: z.enum(['schema', 'data']),
  appliedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  actor: z.string().min(1),
  checksum: z.string().length(64),
  status: z.enum(['running', 'succeeded', 'failed', 'partial']),
});

export async function runMigration(id: string) {
  const conn = await connect(MIGRATION_ROLE);
  await conn.query('SET lock_timeout = $1', [LOCK_TIMEOUT_MS]);
  await conn.query('SET statement_timeout = $1', [STATEMENT_TIMEOUT_MS]);

  const existing = await conn.findOne('migrations', { id });
  if (existing?.status === 'succeeded') return { skipped: true };

  const started = clock.now();
  await conn.insertOrUpdate('migrations', {
    id,
    kind: loadKind(id),
    appliedAt: started.toISOString(),
    actor: process.env.MIGRATION_ACTOR ?? 'unknown',
    checksum: await checksum(id),
    status: 'running',
  });
  // run the SQL or TS module; catch, set status 'failed', re-throw
}
```

Nine runner rules:

1. **Dedicated DB role `migrator`** — minimal privileges needed
   for schema changes; app role cannot DDL.
2. **`lock_timeout` + `statement_timeout` always set** — an
   unbounded DDL holds up every query on the table. Fail fast.
3. **Migrations table tracks every run** — id, checksum, timing,
   actor, status. Audit gold.
4. **Checksum is SHA-256 of the file contents** — detects
   post-hoc tampering. A re-applied migration with a different
   checksum fails.
5. **Idempotent by id** — already-succeeded migrations are
   skipped; partial failures require operator investigation.
6. **`status: 'running'`** row inserted before work starts — a
   crashed runner leaves a breadcrumb.
7. **Running runner is singleton** via Postgres advisory lock
   `pg_try_advisory_lock(MIGRATION_LOCK_ID)`. Two runners cannot
   race.
8. **Separate connection from the app pool** — migrations do not
   consume app connections; app downtime from connection pool
   exhaustion is its own bug.
9. **Always record `actor`** — CI user, operator handle, or
   `automated-bot`. Who ran what must be knowable.

## Single-step migration (low-risk)

For changes that are safe in one transaction:

```sql
-- migrations/20260418-0001-add-users-marketing-opt-in.sql
BEGIN;
  ALTER TABLE users
    ADD COLUMN marketing_opt_in boolean NOT NULL DEFAULT false;
COMMIT;
```

Five single-step rules:

1. **Always `BEGIN; … COMMIT;`** — failures roll back cleanly.
2. **`NOT NULL` safe only with a constant default** — Postgres 11+
   writes the default metadata without rewriting rows; older
   versions rewrite. Know your version.
3. **No `NOT NULL` on a new column in a large table pre-PG11** —
   use expand/contract.
4. **Reviewed lock impact** — `ALTER TABLE ADD COLUMN` with
   constant default is `AccessExclusiveLock`-brief on PG11+; on
   older or with computed default, it rewrites → long outage.
5. **Check constraint** adds are `NOT VALID` + `VALIDATE
   CONSTRAINT` later; otherwise they scan the whole table under
   lock.

## Expand / backfill / contract (THE pattern)

For breaking changes:

### Phase 1 — Expand (additive only)

```sql
-- migrations/20260418-0001-expand-users-add-email-normalized.sql
BEGIN;
  ALTER TABLE users ADD COLUMN email_normalized text;
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_normalized
    ON users (email_normalized);
COMMIT;
```

Six expand rules:

1. **Only additive DDL** — columns added, indexes created, tables
   created. Nothing removed or narrowed.
2. **`CREATE INDEX CONCURRENTLY`** for any non-trivial table —
   does not block writes. Always outside a transaction.
3. **New columns nullable** during expand — backfill fills them
   in Phase 2.
4. **Application code written to read old, write both** (for
   renames) or **read old preferred** (for type widens) — the
   new column is shadow.
5. **Expand deploy ships first** — schema change + app code that
   dual-writes. Deploy lands; telemetry confirms dual-write works.
6. **No code path reads the new column yet** — reads are still
   from the old.

### Phase 2 — Backfill

```ts
// migrations/20260418-0002-backfill-users-email-normalized.ts
import { makeBackfill } from '@sveltesentio/db/migrate';
import { z } from 'zod';

export default makeBackfill({
  id: '20260418-0002-backfill-users-email-normalized',
  batchSize: 500,
  pollInterval: 50,
  select: `
    SELECT id, email FROM users
    WHERE email_normalized IS NULL
    ORDER BY id ASC
    LIMIT $1
  `,
  apply: async (tx, rows) => {
    for (const r of rows) {
      await tx.query(
        'UPDATE users SET email_normalized = $1 WHERE id = $2 AND email_normalized IS NULL',
        [normalize(r.email), r.id],
      );
    }
  },
});
```

Eight backfill rules:

1. **Idempotent** via `WHERE email_normalized IS NULL` — reruns
   are safe; partial completions resume.
2. **Small batches** (100-1000 rows) — long-held locks break
   concurrency; small tx commits frequently.
3. **`ORDER BY id ASC` with cursor** — deterministic order for
   resumability; never `ORDER BY RANDOM()`.
4. **Poll interval between batches** (50-250 ms) — gives room to
   live traffic; avoids replication lag spikes.
5. **Observe via OTel** — `migration.backfill.rows` counter,
   `migration.backfill.batch_ms` histogram, `migration.backfill.
   remaining` gauge.
6. **Alert on stalls** — no progress for 5 minutes at expected
   rate = page on-call.
7. **Can run as a queue worker** per
   [queue-workers.md](queue-workers.md) — durable, retriable,
   pausable via admin UI.
8. **Always a `WHERE` predicate ensuring idempotency** — a
   backfill that re-processes already-done rows is wasteful or,
   worse, corrupts computed values.

### Phase 3 — Cutover (flag-gated)

```ts
// app code
const email = (await flags.isOn('users.read.email_normalized', { userId: ctx.userId }))
  ? row.email_normalized
  : normalize(row.email);
```

Six cutover rules:

1. **Feature flag per
   [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md)**
   — canary 1% → 25% → 50% → 100%.
2. **SLO guards on the flag** — error rate + latency; auto-
   rollback if either degrades.
3. **Dual-write remains on** during cutover — both columns stay
   in sync. Cutover changes only the read path.
4. **Consistency check** — background job compares `email` vs.
   `email_normalized`; deltas page on-call.
5. **Cutover runs for ≥7 days** before Phase 4 — buys room for
   latent bug discovery.
6. **Flag `expiresAt` set** — forces removal after migration
   completes, per flag hygiene.

### Phase 4 — Contract (the scary part)

```sql
-- migrations/20260418-0003-contract-users-email-normalized.sql
BEGIN;
  ALTER TABLE users ALTER COLUMN email_normalized SET NOT NULL;
  ALTER TABLE users DROP COLUMN email;
COMMIT;
```

Seven contract rules:

1. **Ship code that stops writing the old column first** — deploy
   lands, dual-write disabled, telemetry confirms silence on old
   column for ≥72h.
2. **Only then run the contract migration** — at least **three
   deploys between expand and contract**.
3. **Verify no reads** via query-log analysis / DB audit logs —
   automated check that `email` is not referenced by any live
   query.
4. **Drop constraints/indexes before columns** — avoids table
   rewrites.
5. **`SET NOT NULL` on a populated column is a full-table
   `AccessExclusiveLock`** — plan for a maintenance window for
   very large tables, or use `CHECK (email_normalized IS NOT
   NULL) NOT VALID` + `VALIDATE CONSTRAINT`.
6. **Backup PITR marker** created right before contract — roll
   forward is the path, but PITR lets you recover if the contract
   surfaces a hidden reader.
7. **Announce in the same ops channel** as any rollout; someone
   is awake when the drop happens.

## Large-scale backfill — as a queue worker

```ts
// packages/db/src/migrate/workers/backfill.ts
import { makeWorker } from '$lib/server/queue';

export const backfillWorker = makeWorker(
  'migration.backfill',
  PayloadSchema,
  async ({ migrationId, batchSize }) => {
    const { done, processed } = await runOneBatch(migrationId, batchSize);
    if (done) {
      await db.migrations.setStatus(migrationId, 'succeeded');
      return { completed: true };
    }
    await queue.enqueue('migration.backfill', { migrationId, batchSize }, { delay: 50 });
    return { processed };
  },
);
```

Six queue-worker rules:

1. **Self-re-enqueue** on partial completion — better than a
   single long-running job; survives restarts.
2. **`jobId` includes batch cursor** or migration id — dedupe
   retries.
3. **Pause button in admin UI** — emergency stop; job reads a
   `paused` flag each iteration.
4. **Throttle via BullMQ `limiter`** — global cap on rows/second
   prevents replication lag.
5. **Progress event stream** — SSE updates the admin UI dashboard
   live.
6. **DLQ entries are a tier-1 incident** — a stuck backfill
   blocks the migration pipeline.

## Risk classes

Five risk classes (label every migration):

| Class | Example | Lock | Pre-deploy | Window |
|---|---|---|---|---|
| R1 low | nullable column add, index create concurrently | brief | PR review | anytime |
| R2 medium | `NOT NULL` with default on new column, PG11+ | brief | PR + ops review | anytime |
| R3 expand | expand phase of parallel-change | brief | PR + ops + plan | anytime |
| R4 cutover | flag-gated read switch | none | PR + rollout plan | business hours |
| R5 contract | drop column/table, `SET NOT NULL` on existing | long | PR + ops + window | maintenance window |

Six risk rules:

1. **Label every migration R1-R5 in the PR title** — reviewers
   calibrate.
2. **R5 requires maintenance-window approval** from on-call
   rotation.
3. **R3-R4 have a rollout plan** per
   [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md).
4. **R1-R2 still have a runbook section** — mitigation if lock
   timeout fires.
5. **R5 has a backup checkpoint** before running.
6. **No R5 on a Friday.**

## Preflight + postflight

Seven preflight rules:

1. **Dry-run on staging** with production-scale row counts (or a
   statistically-sampled subset).
2. **Replication lag snapshot before start** — baseline.
3. **`pg_stat_statements` snapshot** — detect query plan changes
   post-migration.
4. **Storage headroom check** — adding a column to a 1TB table
   may need 200GB free for the dead tuples vacuum.
5. **Vacuum / analyze just before** large migrations — fresh
   statistics reduce plan surprises.
6. **Active-connection count** — peak-time migrations worsen
   lock contention.
7. **Feature flags enumerated** — every flag touching affected
   tables is listed; rollback plan covers them.

Six postflight rules:

1. **Compare row counts** — `SELECT COUNT(*)` before and after;
   delta must match expectations.
2. **Consistency check** — sample N rows and assert invariants.
3. **Query-plan review** — run `EXPLAIN` on hot queries touching
   the changed tables; regressions surface immediately.
4. **Replication lag returned to baseline** within SLO minutes.
5. **Monitor error rate** for 24h; alert spike correlates with
   the change.
6. **Runbook update** — note anything surprising; next
   migration's preflight references it.

## SQLite / SQL Server / MySQL deltas

Five cross-db rules:

1. **Postgres is the default assumption** in sveltesentio; MySQL
   has different online-DDL support (Aurora / Vitess), SQL Server
   different lock escalation.
2. **MySQL 8 `INSTANT ADD COLUMN`** is the counterpart of
   Postgres 11+ fast default — great, but beware row-format limits.
3. **SQLite does not support many DDLs online** — table recreate
   is the only path for some changes; avoid on live-write SQLite.
4. **Orchestrators like `gh-ost` / `pt-online-schema-change`**
   for MySQL — integrate as the runner when adopted.
5. **ORM-generated migrations** are a starting point only; hand-
   review every one — ORM defaults may produce R5-grade changes
   unknowingly.

## Cross-service migrations (app + search + cache)

Six cross-service rules:

1. **Plan covers every dependent system** — Typesense schema,
   OpenSearch mapping, Redis cache key layout, CDN-cached
   responses.
2. **Search schema migrated via
   [search.md](search.md)** reindex pattern — dual-index → cut
   → drop.
3. **Cache invalidation** explicit — version-prefix the cache
   keys; new version drains old naturally.
4. **Consumer services** — if your schema is consumed by
   downstream services / a Kafka topic, stage the fields
   additively and coordinate consumer deploys.
5. **API versioning** per
   [api-versioning.md](api-versioning.md) — external clients may
   pin to old shapes; never break them mid-migration.
6. **Observability first** — emit OTel events for every dual-
   write mismatch; investigate before cutover.

## Rollback philosophy

Five rollback rules:

1. **There is no "down migration"** — reverting a schema change
   is itself a new migration.
2. **App rollback is safe during expand** — old code reads old
   column; new schema is additive.
3. **App rollback during cutover is safe** if dual-write still
   active — flip the flag off.
4. **App rollback after contract is broken** — old code expects
   the dropped column; that's why contract is last, only after
   multiple deploys prove cutover.
5. **PITR is the "nuclear" rollback** — restore from
   [backup-recovery.md](backup-recovery.md), replay validated
   writes; only for catastrophic data corruption.

## Observability

Bounded attributes only:

```ts
export const MIGRATION_ATTRIBUTES = [
  'migration.id',              // bounded per release — not unbounded user input
  'migration.kind',            // schema | data
  'migration.phase',           // expand | backfill | cutover | contract
  'migration.risk',            // r1-r5
  'migration.outcome',         // succeeded | failed | partial | skipped
  'migration.duration_bucket', // <1s | <10s | <1m | <10m | <1h | >1h
] as const;
```

Seven alerts:

1. **Migration `status: 'failed'`** → page on-call immediately.
2. **`status: 'partial'` longer than 10 min** → page.
3. **Lock wait > 30s on migration runner** → ops page.
4. **Replication lag > 60s during migration** → ops page.
5. **Backfill throughput < 50% of expected for 5 min** → ops
   slack.
6. **Dual-write mismatch rate > 0.01%** → stop-the-line, halt
   cutover.
7. **Checksum mismatch on replay** → stop-the-line.

## Testing

Seven testing lanes:

1. **Unit — each migration's TS logic** on testcontainers
   Postgres.
2. **Integration — full sequence** up, run, assert schema +
   invariants.
3. **Chaos — runner killed mid-migration** — on restart,
   resumes cleanly (`status: 'running'` → partial → retry).
4. **Property-based — backfill idempotency** — run twice, result
   identical.
5. **Performance — backfill on 10M-row fixture** — throughput
   meets SLO.
6. **Concurrency — simulate app writes during expand** —
   dual-write correctness holds.
7. **Checksum — tamper detection** — flipping a byte in a
   migration file makes the runner refuse.

## Anti-patterns

1. **`DROP COLUMN` in the same PR as the code that stopped using
   it** — old replicas still query the column; cascading 500s.
2. **`ALTER TABLE` without `lock_timeout`** — unbounded lock =
   outage.
3. **`CREATE INDEX` (non-concurrent) on a large table** — writes
   block for the duration.
4. **`down` migrations as the rollback plan** — reverting
   data-destructive migrations by re-running is worse than forward-
   fixing.
5. **ORM auto-generated migrations committed without review** —
   renames become drop+add; data loss.
6. **Single giant migration doing 20 things** — partial failure
   leaves the schema mid-shaped; debugging is impossible.
7. **Backfill as a single `UPDATE users SET … WHERE`** — holds
   one enormous lock; replication explodes.
8. **No idempotency predicate on backfill** — reruns corrupt
   computed fields.
9. **Cutover without flag or SLO guard** — regressions hit 100%
   of users.
10. **Contract the day after cutover** — no buffer for latent
    bugs; readers might still exist.
11. **Shared migration runner role with app** — compromised app
    can DDL.
12. **No advisory lock on runner** — two CI pipelines race; both
    apply migration `0001`, one fails, the other half-commits.
13. **No checksum** — a colleague edits the migration post-
    merge; the re-run silently drifts.
14. **No preflight storage check** — backfill runs out of WAL
    disk mid-flight; writes stop globally.
15. **Running R5 with replication not caught up** — replica
    promotion unsafe; loss scenario.
16. **No observability on dual-writes** — mismatches pile up
    invisible; cutover ships with silent divergence.
17. **Using production rows to test migrations** — data-leak and
    privacy breach; use synthetic or anonymized fixtures.
18. **Migration naming without timestamps** — merge conflicts on
    ordinal collisions; untraceable order.
19. **Committing credentials in migration scripts** — secrets in
    git; see [secrets-management.md](secrets-management.md).
20. **Skipping `VACUUM ANALYZE`** after bulk data changes — query
    planner goes crazy.
21. **No postflight row-count compare** — silent data loss goes
    undetected.
22. **Backfill with no throttle** — replication lag → replica
    reads break app-wide.
23. **Mixing schema and data in one file** — atomicity mismatch;
    each has its own retry / recovery profile.
24. **No runbook entry** — next week, no one remembers why the
    column exists.
25. **Running migrations from a developer laptop** — no audit, no
    retry, no observability. Always via CI or operator tool with
    audit.

## References

- Parallel-change pattern (Martin Fowler)
  <https://martinfowler.com/bliki/ParallelChange.html>
- Postgres DDL locking matrix
  <https://www.postgresql.org/docs/current/explicit-locking.html>
- `CREATE INDEX CONCURRENTLY` — Postgres docs
  <https://www.postgresql.org/docs/current/sql-createindex.html>
- `pt-online-schema-change` (Percona)
  <https://docs.percona.com/percona-toolkit/pt-online-schema-change.html>
- `gh-ost` (GitHub)
  <https://github.com/github/gh-ost>
- Zero-downtime migrations at scale (Shopify engineering blog)
  <https://shopify.engineering/what-is-zero-downtime-deployment>
- [ADR-0019](../adr/0019-error-model.md) — ProblemError
- [ADR-0023](../adr/0023-uuidv7-default.md) — UUIDv7 ids
- [backup-recovery.md](backup-recovery.md)
- [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md)
- [queue-workers.md](queue-workers.md)
- [admin-ui-patterns.md](admin-ui-patterns.md)
- [secrets-management.md](secrets-management.md)
- [api-versioning.md](api-versioning.md)
- [audit-log.md](audit-log.md)
