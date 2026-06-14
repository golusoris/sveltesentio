# Backup and recovery — RPO/RTO + PITR + encrypted snapshots + disaster drill

A backup that has never been restored is not a backup. Recovery
capability — not snapshot frequency — is the metric that matters.
This recipe is the authoritative contract for **per-data-class
RPO/RTO targets**, **Postgres PITR (Point-In-Time Recovery) as
default plus object-store snapshots**, **encrypted-at-rest with
KMS-managed keys separate from the primary-DB key**, **monthly
disaster-recovery drills with documented runbooks**, and
**cross-region replication for tier-1 data**.

Per [principles.md §2.2](../principles.md) (OWASP ASVS L2 V14 —
data-protection including backup), [principles.md §2.5](../principles.md)
(supply chain — encrypted artifacts), and [principles.md §2.1](../principles.md)
(Power of 10 — no silent failures), the posture is: **every data
class has a written RPO/RTO**, **backups encrypted with a KMS key
whose access is role-separated from the DB primary**, **restore
tested monthly by an unattended cron that produces a pass/fail
signal**, **PITR window covers the 7-day root-cause-analysis
window**, and **cross-region replication for anything irreplaceable
(tenants, audit-log, billing-ledger)**.

## Related

- [observability.md](observability.md) — `backup.status` + `restore.drill.status`
  bounded labels; RPO/RTO gauges alert when drift exceeds policy.
- [audit-log.md](audit-log.md) — audit-log is tier-1 data with
  tightest RPO; backup-access and restore-events themselves write
  audit entries.
- [cron-jobs.md](cron-jobs.md) — nightly snapshot + monthly
  restore-drill run as authenticated cron jobs with overlap locks
  and alert on missed runs.
- [payments.md](payments.md) — Stripe subscription state must
  reconcile against webhook source-of-truth after any restore;
  never restore billing blindly.
- [consent-management.md](consent-management.md) — GDPR Art. 17
  right-to-erasure requires backup-tombstone contract; restored
  rows for deleted users must re-apply erasure.
- [service-limits.md](service-limits.md) — usage-counter
  reconciliation after restore from `usage_events` ledger.
- [monorepo-releases.md](monorepo-releases.md) — each release
  records the DB migration version; restore-to-point-in-time
  requires migration-version pinning.
- [permissions.md](permissions.md) — backup access is a separate
  role (`role:backup-operator`) — not conflated with DB admin.
- [principles.md §2.2](../principles.md) — OWASP ASVS L2 V14.

## What "recovery" actually means

```text
RPO (Recovery Point Objective)  = how much data loss is acceptable
                                  (e.g. RPO 15min = lose at most 15min of writes)
RTO (Recovery Time Objective)   = how long recovery takes
                                  (e.g. RTO 2h = restore operational within 2h)
MTTD (Mean Time To Detect)      = how long until we notice we need recovery
                                  (often the dominant term; monitoring matters)
MTTR (Mean Time To Recover)     = MTTD + decision-time + RTO
```

**Three measurement rules:**

1. **RPO and RTO are per-data-class, not global.** Audit-log has
   5-minute RPO; product analytics has 24-hour RPO. One uniform
   policy wastes money on low-value data and under-protects
   high-value data.
2. **MTTR is what users feel.** A 30-minute RTO is irrelevant if
   MTTD is 4 hours — you're down for 4.5 hours. Invest in
   detection (see [observability.md](observability.md)) before
   reducing RTO.
3. **"We have backups" ≠ "we can recover."** The restore-drill
   test is the authoritative signal. Anything else is a
   hypothesis.

## Data-class tiers

```text
Tier 0  Financial / legal / audit        RPO 5min   RTO 30min   cross-region
Tier 1  User data (tenants, content)      RPO 1h     RTO 2h      cross-region
Tier 2  Session / cache / queues          RPO 24h    RTO 4h      single-region
Tier 3  Analytics / telemetry (derived)   RPO 7d     RTO 7d      best-effort
Tier 4  Ephemeral (OTel spans, logs)      no RPO     no RTO      regenerate
```

**Six tier rules:**

1. **Every table is labeled with a tier** in a `data_tiers.md`
   doc committed to the repo. PRs that add tables update the
   doc (pre-commit hook enforces).
2. **Tier 0 is append-only by policy.** Audit, billing-ledger,
   regulatory-evidence — never overwrite, never hard-delete.
   Soft-delete + retention schedule.
3. **Tier 2 is recoverable via replay** when possible. Sessions
   regenerate on next login; queue messages are retried by
   producers. Budget accordingly.
4. **Tier 3 is acceptable to lose** for derived data; the source
   (usually tier 0/1) can reconstruct. Backing up tier 3 is
   a cost-saving omission, not a negligence.
5. **Cross-region only for tier 0 + 1.** Other tiers use
   same-region snapshots (cheaper, lower latency). Cross-region
   bandwidth isn't free.
6. **Encryption-at-rest applies uniformly across tiers.** Even
   tier 3 data has PII in aggregate; encrypt everything.

## Reference pattern — Postgres

### 1. PITR + logical base backups

```text
Primary Postgres
 ├─ continuous WAL archive  → wal-g or pgBackRest  →  S3 (eu-west-1, encrypted)
 ├─ nightly base backup     → pg_basebackup        →  S3 (eu-west-1, encrypted)
 └─ nightly logical dump    → pg_dump              →  S3 (us-east-1, encrypted)
                                                       (second region, different KMS key)
```

```yaml
# wal-g configuration (excerpt, running under systemd or sidecar)
WALG_S3_PREFIX: s3://sveltesentio-backup-eu/postgres
WALG_COMPRESSION_METHOD: zstd
WALG_DELTA_MAX_STEPS: 6
AWS_REGION: eu-west-1
WALG_LIBSODIUM_KEY_PATH: /run/secrets/wal-g-libsodium.key
PGHOST: /var/run/postgresql
```

**Five PITR rules:**

1. **WAL archival is continuous.** Not "every N minutes" — every
   WAL segment as it finalizes. RPO of N minutes means WAL is
   at-most-N-minutes-behind S3.
2. **PITR window ≥ 7 days.** Root cause of a bug is often "last
   Tuesday someone ran a bad migration" — you need to restore
   to before the migration to diff schema + data.
3. **Logical dump is the disaster-of-binary-incompatibility
   backup.** `pg_basebackup` requires identical Postgres version;
   `pg_dump` works across majors. You need both.
4. **Base backup retention ≥ PITR window.** Can't restore to a
   point-in-time without a base backup older than that point.
5. **Dump to a different region with a different KMS key.**
   Region-wide outage + primary-KMS compromise are both
   non-theoretical. Belt and suspenders.

### 2. Per-application logical backup (Stripe, OpenAI, etc.)

External services are their own source-of-truth. We back up the
*references* to them, not the data itself:

```sql
-- billing_ledger is a local cache; Stripe is source-of-truth
-- but the join keys (stripe_customer_id, stripe_subscription_id)
-- are tier-0 and must survive restore
CREATE TABLE billing_ledger (
  id                     UUID PRIMARY KEY,
  tenant_id              UUID NOT NULL,
  stripe_customer_id     TEXT NOT NULL,
  stripe_subscription_id TEXT,
  event_id               TEXT NOT NULL UNIQUE,
  event_type             TEXT NOT NULL,
  payload                JSONB NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Three rules:**

1. **Never restore billing state blindly.** After a DB restore,
   run reconciliation against Stripe webhook history — their
   state is authoritative.
2. **`event_id UNIQUE` survives restore-and-replay.** Webhook
   replay from Stripe produces duplicates if we forgot what we
   processed; unique constraint rejects them.
3. **Keep tenant → external-id mappings in tier 0.** Losing
   `stripe_customer_id` means manual reconciliation by
   customer-success for every tenant.

### 3. Encryption-at-rest with KMS

```text
Backup artifact          → envelope-encrypted with data-key
Data-key                 → encrypted with KMS-managed customer-master-key (CMK)
CMK                      → KMS (AWS KMS / GCP KMS / HSM)
CMK access               → role:backup-operator (not DB admin, not app)
Key rotation             → CMK rotates yearly; old versions retained for 7 years
```

**Seven encryption rules:**

1. **Envelope encryption, not direct.** A data-key encrypts the
   backup; the CMK encrypts the data-key. This is how every
   cloud-native backup system works — don't reinvent.
2. **CMK separate from primary DB encryption key.** If a primary
   DB key is compromised, attacker shouldn't also have backup
   key. Different KMS aliases, different IAM roles.
3. **Backup-operator role is not DB-admin role.** Compromised
   DB-admin can read data but not exfil the historical record;
   compromised backup-operator can read backups but not alter
   live data. Split the blast radius.
4. **Key rotation is automated, yearly minimum.** Old CMK
   versions stay active to decrypt old backups; rotated-out
   versions go to "disabled" after retention window.
5. **Restore-access logged separately.** Every `DecryptDataKey`
   call on the backup CMK is a CloudTrail / Cloud Audit Logs
   entry — suspicious activity visible.
6. **Client-side encryption preferred over server-side for
   cross-region.** The source region shouldn't hand plaintext
   data to the destination region's KMS; encrypt before upload.
7. **Never store the CMK plaintext anywhere** — not in env vars,
   not in secrets managers. The CMK is the KMS's private
   material; only metadata leaves.

## Disaster-recovery drill — the monthly unattended restore

```typescript
// src/routes/api/cron/dr-drill/+server.ts
import { withCronRun } from '../_shared/runner';
import { verifyCronRequest } from '../_shared/authn';
import { runDrill } from '$lib/backup/drill';

export const POST: RequestHandler = async ({ request }) => {
  verifyCronRequest(request);

  return withCronRun('dr-drill', async () => {
    const result = await runDrill({
      sourceBackup: 'latest-base-backup',
      targetPostgres: 'drill-ephemeral',
      smokeChecks: [
        'tenants_row_count > 0',
        'latest_audit_row within_24h',
        'billing_ledger row_count matches source',
        'migration_version matches latest',
      ],
    });

    return {
      processed: result.checksPassed,
      skipped: result.checksSkipped,
      details: {
        restoreDurationMinutes: result.restoreDurationMinutes,
        checksPassedCount: result.checksPassed,
        checksFailedCount: result.checksFailed,
        measuredRtoMinutes: result.measuredRtoMinutes,
        measuredRpoMinutes: result.measuredRpoMinutes,
      },
    };
  });
};
```

**Six drill rules:**

1. **Unattended cron, not a quarterly ceremony.** Monthly is
   the minimum; weekly is better for tier 0. A drill that
   requires human attention gets skipped — automate it.
2. **Target is an ephemeral environment, not prod-alt.** Restore
   into a throwaway Postgres instance spun up for the drill,
   torn down after. Never restore into a running environment
   that could have writes of its own.
3. **Smoke-checks are data-shape checks, not query-execution
   checks.** `row_count > 0`, `latest_timestamp within_N`,
   `unique_constraints_present` — fast, deterministic, no
   application code needed.
4. **Measure RTO and RPO as metrics, not assertions.** The
   drill records how long restore took (RTO) and how old the
   most-recent data is (RPO). Alert if either exceeds
   per-tier-policy.
5. **Failed drills page an on-call.** A silent failed drill is
   worse than no drill — you have a broken backup and no
   signal to fix it.
6. **Rotate the source backup.** One drill uses the latest
   backup; the next uses a 7-day-old backup; the next uses
   the oldest in the PITR window. Catches regressions in the
   whole window, not just the happy path.

## Runbook — when production is down

```text
1. Detect          (MTTD)
   - OTel alerts fire; on-call paged
   - Confirm scope: which tiers affected, which regions

2. Decide          (≤ 15min target)
   - Is this a deploy regression? → rollback via monorepo-releases.md
   - Is this a data-corruption bug? → restore to PITR timestamp before
   - Is this infrastructure? → failover or scale

3. Communicate     (parallel to step 2)
   - Status page update: degraded / partial-outage / full-outage
   - Internal Slack #incident channel opened
   - Customer-facing comms queued for send on resolution

4. Recover         (the RTO clock)
   - For restore: follow backup-restore.md (this file's playbook)
   - For failover: switch DNS / load-balancer (seconds if preconfigured)

5. Reconcile       (post-recovery, ≤ 30min after service restored)
   - Stripe webhook replay (see payments.md)
   - Analytics + feature-flag exposure logs reconciled
   - Audit-log entries for restore event itself

6. Post-mortem     (within 3 business days)
   - Written post-mortem: what happened, detection gap, response gap
   - Action items filed; assign owners; track to completion
```

**Four runbook rules:**

1. **Decision in 15 minutes or escalate.** Indecision is the
   worst outcome. If on-call can't choose between rollback and
   restore in 15 minutes, escalate to architect / CTO.
2. **Communicate before recovered.** Users forgive outages;
   they don't forgive silence. Status page updated within
   15 minutes of detection.
3. **Reconciliation is step 5, not step 4.** Getting the
   service back up comes first; reconciling Stripe and
   analytics can happen in the next 30 minutes.
4. **Post-mortem is mandatory and blameless.** Filed within
   3 business days, action items tracked. Repeated
   post-mortems with no action-items-completed is itself an
   incident.

## Restore playbook — PITR

```bash
# Provisioning the restore target (ephemeral or prod-alt)
terraform apply -target=module.postgres_restore_target

# Configure wal-g on the target
export WALG_S3_PREFIX=s3://sveltesentio-backup-eu/postgres
export WALG_LIBSODIUM_KEY_PATH=/run/secrets/wal-g-libsodium.key
export PGDATA=/var/lib/postgresql/data

# Stop Postgres if running
systemctl stop postgresql

# Fetch base backup
wal-g backup-fetch $PGDATA LATEST

# Write recovery.conf (Postgres 12+) / recovery.signal
cat > $PGDATA/postgresql.auto.conf <<EOF
restore_command = 'wal-g wal-fetch %f %p'
recovery_target_time = '2026-04-18 14:00:00 UTC'
recovery_target_action = 'promote'
EOF

touch $PGDATA/recovery.signal

# Start Postgres in recovery mode
systemctl start postgresql

# Verify recovery target reached
psql -c "SELECT pg_is_in_recovery(), pg_last_wal_replay_lsn()"
```

**Six restore-playbook rules:**

1. **Target is a fresh `PGDATA` directory.** Never restore on
   top of an existing data directory — collision breaks
   recovery.
2. **`recovery_target_time` is UTC.** Same timezone rule as
   [cron-jobs.md](cron-jobs.md). DST drift during restore is
   career-limiting.
3. **`recovery_target_action = 'promote'`** to bring the
   restored DB online for queries. Default `pause` holds in
   recovery mode and confuses operators.
4. **Migration version pinning.** After restore, verify
   `SELECT max(version) FROM schema_migrations` matches what
   the application expects. Application code at commit SHA X
   may not work against DB at migration version Y-5.
5. **Read-only verification before write traffic.** Point
   application at restored DB in read-only mode; run smoke
   tests; only then switch writes over.
6. **DNS / load-balancer cutover is the write-switch.** Not
   application-level. Keep the switch at infrastructure layer
   so rollback is also infrastructure-level (seconds, not
   minutes).

## Cross-region replication — tier 0 + 1

```text
Primary region (eu-west-1)
 ├─ Postgres primary
 ├─ WAL archive → S3 eu-west-1
 └─ Logical dump → S3 us-east-1 (second region)

Secondary region (us-east-1)
 └─ Postgres read-replica (logical replication from primary)
    + WAL archive → S3 us-east-1
```

**Five replication rules:**

1. **Logical replication, not streaming replication, for
   cross-region.** Logical survives major-version upgrades;
   streaming doesn't. Also filters — we don't replicate
   tier 2/3 across regions.
2. **Replication lag is a monitored metric.** `pg_replication_lag`
   gauge; alert on > 60 seconds for tier 0.
3. **Failover is manual, not automatic.** Automatic failover
   in a multi-region setup causes split-brain more often than
   it saves time. Human decision with a documented checklist.
4. **The replica is read-only for applications.** Never let
   app code write to the replica; replication breaks on
   conflict and you've lost the DR surface.
5. **Annual region-failover drill.** Rarer than DB-restore
   drill (more disruptive), but still mandatory. Promote
   replica, switch DNS, run for 30 minutes, switch back.

## Object-store (S3 / R2 / GCS) backups

```text
Per-bucket
 ├─ Versioning: enabled (retains deletes + overwrites)
 ├─ Lifecycle: expire non-current versions after 90 days
 ├─ Replication: enabled to second region for tier 0 + 1 buckets
 ├─ Access logs: enabled, written to log-bucket (different account)
 └─ Object Lock: enabled for tier 0 (audit artifacts, legal holds)
```

**Four object-store rules:**

1. **Versioning is the default.** "Delete" on a versioned
   bucket creates a delete-marker; the original is still
   there. Undo is possible; "oops" is recoverable.
2. **Object Lock for tier 0 artifacts.** WORM (write-once-read-
   many) — compliance requirement for audit logs and legal
   holds. Can't be deleted even by root accounts until the
   lock expires.
3. **Access-logs bucket is a different account.** Compromise
   of the main account still leaves forensic trail.
4. **Replication is cross-region.** S3 Cross-Region Replication
   (CRR) or equivalent — asynchronous, within minutes. For
   tier 0, pair with versioning so accidental-deletes replicate
   as delete-markers (not lost forever).

## GDPR compatibility — the tombstone contract

```sql
CREATE TABLE erasure_tombstones (
  user_id        UUID PRIMARY KEY,
  requested_at   TIMESTAMPTZ NOT NULL,
  erased_at      TIMESTAMPTZ NOT NULL,
  scope          TEXT NOT NULL CHECK (scope IN ('account', 'pii_only', 'account_and_audit'))
);
```

**Four tombstone rules:**

1. **Erasure tombstones are NOT backed up with the same
   retention as other data.** They must outlast all backups
   containing the erased user's data — typically 7-10 years.
2. **After any restore, re-apply erasure.** A cron job scans
   for any user_id present in both `users` and
   `erasure_tombstones` post-restore and re-runs the erasure.
3. **Backup-lifecycle shorter than tombstone-lifetime.**
   Otherwise you can't prove "we no longer retain data on
   deleted user X" — a GDPR response asks about the last
   backup, not the live DB.
4. **Audit scope for erasure carefully.** Legal retention
   (audit log, invoices) may be exempt from GDPR erasure;
   `scope: 'pii_only'` preserves those, `scope:
   'account_and_audit'` doesn't. Get legal sign-off on
   which applies.

## Observability

```text
Attribute              Values
──────────────────────────────────────────────────────
backup.job              'wal-archive' | 'base-backup' | 'logical-dump' | 'object-store-replication'
backup.tier             'tier_0' | 'tier_1' | 'tier_2' | 'tier_3'
backup.status           'ok' | 'failed' | 'skipped'
restore.drill.status    'ok' | 'failed' | 'partial'

Metrics
──────────────────────────────────────────────────────
backup.lag.seconds               gauge, labels: job, tier
backup.size.bytes                gauge, labels: job, tier
backup.duration.seconds          histogram, labels: job
restore.drill.duration.minutes   histogram (monthly drill)
restore.drill.rpo.minutes        gauge (measured RPO at drill)
restore.drill.rto.minutes        gauge (measured RTO at drill)
```

**Five observability rules:**

1. **Alert on `backup.lag.seconds > RPO-threshold-per-tier`.**
   Tier 0 lag > 5min pages oncall. Tier 2 lag > 24h is a
   daily-digest item.
2. **`restore.drill.status != 'ok'` is a sev-2 page.** Don't
   let it wait for the next drill.
3. **Track backup size over time.** Sudden growth can indicate
   accidental retention of ephemeral data; sudden shrinkage
   can indicate bugs in data-capture.
4. **Dashboard: "time since last successful restore drill
   per tier."** If it's longer than 45 days for any tier, the
   dashboard turns red.
5. **Retention: 1 year** on backup-metric history. Gives the
   audit view needed for annual compliance review.

## Testing — three lanes

```typescript
it('wal-g archives WAL within RPO', async () => {
  const lastWalTime = await fetchLastArchivedWalTimestamp();
  const lag = Date.now() - lastWalTime.getTime();
  expect(lag).toBeLessThan(5 * 60 * 1000);
});

it('monthly restore drill produces pass status', async () => {
  const result = await runDrillInStaging({ sourceBackup: 'latest' });
  expect(result.checksPassedCount).toBeGreaterThan(0);
  expect(result.checksFailedCount).toBe(0);
  expect(result.measuredRtoMinutes).toBeLessThan(30);
});

it('erasure tombstone re-applies after restore', async () => {
  await erasureTombstone('user-x');
  await runDrillInStaging({ sourceBackup: 'pre-erasure' });
  await reapplyTombstones();
  const user = await db.oneOrNone('SELECT * FROM users WHERE id = $1', ['user-x']);
  expect(user).toBeNull();
});
```

**Three test rules:**

1. **Backup-lag smoke lane is a continuous test**, not a
   one-off. Cron every 5 minutes, page on fail.
2. **Drill assertion in the drill itself**, not in CI. CI
   can't run a real restore — too slow, too resource-heavy.
3. **Tombstone re-application tested** as part of the drill.
   GDPR compliance is non-negotiable; a restore that brings
   back erased users is a regulatory incident.

## Anti-patterns

1. **"We have RDS snapshots" as the whole plan.** Snapshots
   alone don't give PITR; they don't give cross-region; they
   don't give tested restore.
2. **Backups stored in the same account as prod.** Ransomware
   on the prod account encrypts the backups too.
3. **Backup-encryption key in the same IAM role as DB-access.**
   Compromise one, compromise both.
4. **No restore drill.** "We haven't needed to restore in
   years" = "we don't know if we can."
5. **Uniform RPO/RTO across all tables.** Wastes money on low-
   value data and under-protects tier 0.
6. **Ignoring WAL-archive lag.** WAL isn't reaching S3 →
   you have no PITR capability past the last base backup →
   your RPO just became 24 hours.
7. **Restoring on top of the primary DB.** Collision, data
   corruption, and no rollback. Always restore to a fresh
   target.
8. **No migration-version check after restore.** App crashes
   on "column does not exist" because code is at schema 42
   and restored DB is at schema 40.
9. **Cross-region replication without filtering.** Replicating
   tier 3 analytics across regions is expensive and pointless.
10. **Not honoring erasure tombstones post-restore.** GDPR
    fine, customer-trust hit, audit finding.
11. **Failing backup → alert → ignore → repeat.** Alert fatigue
    turns backup failures into normal background noise.
    Failed backup = page, not email.
12. **Storing encryption keys next to backup artifacts.** S3
    bucket with both the encrypted data and the decryption
    key = convenience, not security.
13. **No object-store versioning.** A single `aws s3 rm --recursive`
    erases everything; versioning makes it recoverable.
14. **Automatic cross-region failover.** Split-brain risk +
    network-partition misdetection exceed the downtime saved.
    Automate detection; human-approve failover.
15. **Documentation of restore procedure only in a single
    person's head.** They quit; you're now in a
    not-tested-in-practice state. Runbooks checked into the
    repo, reviewed quarterly.
16. **Retaining backups forever "just in case."** GDPR /
    data-protection statutes require defined retention. Older
    than the policy window must be deleted; old backups with
    PII are a liability, not an asset.
17. **No distinction between backup and archive.** Backups
    are for recovery (short-retention, fast-restore); archives
    are for compliance (long-retention, slow-retrieval,
    cheaper storage class). Conflating them either costs money
    or misses compliance.

## References

- [ADR-0019 — structured errors](../adr/0019-structured-errors.md) —
  restore errors flow through ProblemError.
- [ADR-0023 — observability](../adr/0023-observability.md) — bounded
  `backup.job` + `backup.tier` labels.
- [observability.md](observability.md) — metric contracts.
- [audit-log.md](audit-log.md) — restore events themselves audited.
- [cron-jobs.md](cron-jobs.md) — nightly snapshot + monthly drill
  scheduling.
- [payments.md](payments.md) — Stripe reconciliation after restore.
- [consent-management.md](consent-management.md) — GDPR tombstones.
- [monorepo-releases.md](monorepo-releases.md) — migration-version
  pinning.
- [permissions.md](permissions.md) — `role:backup-operator` split.
- [PostgreSQL docs — PITR](https://www.postgresql.org/docs/current/continuous-archiving.html) — continuous archiving semantics.
- [wal-g](https://github.com/wal-g/wal-g) — WAL archival tool used in reference.
- [pgBackRest](https://pgbackrest.org/) — alternative to wal-g for larger deployments.
- [AWS Backup and Restore best practices](https://docs.aws.amazon.com/prescriptive-guidance/latest/backup-recovery/) — tier/RPO/RTO framing.
- [NIST SP 800-34 — Contingency Planning](https://csrc.nist.gov/publications/detail/sp/800-34/rev-1/final) — RPO/RTO formalism.
- [GDPR Art. 17 (Right to erasure)](https://gdpr-info.eu/art-17-gdpr/) — tombstone contract.
