# `multi-region-deployment.md` — multi-region active-active recipe for sveltesentio

When a single-region deployment can no longer meet RTO/RPO for the
business, latency targets for global users, or data-residency law
(GDPR, Australian Privacy Act, CCPA, India DPDP, China PIPL), you
graduate to **multi-region**. This recipe covers active-active web
tier, eventual-consistency primary-with-replica patterns,
geo-routing via DNS or anycast, regional data-residency partitioning,
failover playbooks, and the asymmetric latency invariants that
distinguish "marketing-multi-region" from "actually-multi-region",
per [ADR-0019](../adr/0019-server-runtime-contract.md) +
[ADR-0023](../adr/0023-compliance-observability.md).

Multi-region is **expensive** (3-5× single-region cost), **hard**
(distributed-systems failure modes you can't simulate locally), and
**rarely necessary** (most apps don't have global SLOs). Only adopt
when single-region demonstrably can't meet the requirement.

## Related

- [kubernetes-deployment.md](kubernetes-deployment.md) — single-region
  baseline that this extends across regions
- [data-migrations.md](data-migrations.md) — schema changes are
  region-aware (apply expand-globally, contract-globally)
- [backup-recovery.md](backup-recovery.md) — cross-region replication
  + failover drills
- [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md) —
  region-staggered rollouts
- [rate-limiting.md](rate-limiting.md) — global vs per-region quotas
- [observability.md](observability.md) — region-tagged spans + traces
  cross regions
- [ADR-0019](../adr/0019-server-runtime-contract.md)
- [ADR-0023](../adr/0023-compliance-observability.md)

## When to use what — decision tree

```text
Single region + 99.9% SLO + <100ms p99 globally    → single-region (skip this recipe)
Multi-region read SLO + acceptable write latency   → primary + read replicas
Multi-region read+write SLO + eventual consistency → active-active per region (this recipe)
Strict consistency across regions                   → don't (CAP theorem); pin write region per tenant
Data-residency law (GDPR EU-only, etc.)            → tenant-pinned region + per-region database
Disaster recovery only (warm standby)              → 1 active region + 1 hot-standby + failover
Geo-distributed reads only (CDN edge)              → caching.md (CDN is enough)
```

## Architecture — the three patterns

```text
1. PRIMARY-REPLICA (read scale-out, single-region writes)

   ┌───────────┐ writes ┌────────────┐
   │ EU users  │ ────── ▶ │ EU primary │ ─── async ▶ US replica + APAC replica
   │ US users  │ reads from nearest replica
   │ APAC users│
   └───────────┘

2. ACTIVE-ACTIVE (multi-write, eventual-consistency)

   ┌─ EU users ─┐ ─── EU cluster ◀── async multi-master ──▶ US cluster ─── US users
                                          ▲
                                          │ async multi-master
                                          ▼
                                       APAC cluster ─── APAC users

3. TENANT-PINNED (data-residency / sharded)

   tenant_id 1-10000 → EU region (writes + reads)
   tenant_id 10001-20000 → US region (writes + reads)
   geo-routing maps user → tenant → region; cross-tenant queries forbidden
```

Pattern 1 is the safe default for most apps. Pattern 2 introduces
write conflicts that your application code must resolve (CRDTs, LWW,
Lamport clocks). Pattern 3 is the compliance-driven choice for SaaS
with strict residency requirements.

## Shape — bounded Zod contracts

```ts
// packages/region/src/schema.ts
import { z } from 'zod';

export const Region = z.enum([
  'eu-west-1',
  'us-east-1',
  'ap-southeast-2',
]);
export type Region = z.infer<typeof Region>;

export const ResidencyPolicy = z.enum([
  'eu-only',       // GDPR Art.44+
  'us-only',       // FedRAMP / state law
  'apac-only',     // PIPL / DPDP
  'global',        // no constraint
]);
export type ResidencyPolicy = z.infer<typeof ResidencyPolicy>;

export const TenantRegion = z.object({
  tenantId: z.string().uuid(),
  homeRegion: Region,
  residencyPolicy: ResidencyPolicy,
  createdAt: z.string().datetime(),
  pinnedAt: z.string().datetime(),
});
export type TenantRegion = z.infer<typeof TenantRegion>;

export const RegionHealth = z.object({
  region: Region,
  status: z.enum(['healthy', 'degraded', 'failed']),
  rtt_ms: z.number().nonnegative(),
  replicationLag_ms: z.number().nonnegative(),
  lastChecked: z.string().datetime(),
});
export type RegionHealth = z.infer<typeof RegionHealth>;

export const RESIDENCY_TO_REGIONS: Record<ResidencyPolicy, Region[]> = {
  'eu-only':   ['eu-west-1'],
  'us-only':   ['us-east-1'],
  'apac-only': ['ap-southeast-2'],
  'global':    ['eu-west-1', 'us-east-1', 'ap-southeast-2'],
};
```

## Reference — geo-routing + tenant-region pinning

```ts
// src/hooks.server.ts
import { Region, type ResidencyPolicy } from '@sveltesentio/region/schema';
import { redirect } from '@sveltejs/kit';
import { tenantRepo } from '$lib/server/repos';

const LOCAL_REGION = Region.parse(process.env.REGION); // injected per pod

export const handle = async ({ event, resolve }) => {
  const tenantSlug = event.params.tenant ?? event.locals.tenantSlug;
  if (!tenantSlug) return resolve(event);

  const tenant = await tenantRepo.findBySlug(tenantSlug);
  if (!tenant) return resolve(event);

  // Cross-region request → redirect to tenant's home region.
  // This avoids cross-region writes which would either fail or
  // create eventual-consistency anomalies.
  if (tenant.homeRegion !== LOCAL_REGION && isWriteIntent(event)) {
    const target = regionToHost(tenant.homeRegion);
    throw redirect(307, `https://${target}${event.url.pathname}${event.url.search}`);
  }

  // Reads can serve from local region if tenant's residency allows
  // (else also redirect).
  const allowed = RESIDENCY_TO_REGIONS[tenant.residencyPolicy];
  if (!allowed.includes(LOCAL_REGION)) {
    const target = regionToHost(tenant.homeRegion);
    throw redirect(307, `https://${target}${event.url.pathname}${event.url.search}`);
  }

  event.locals.region = LOCAL_REGION;
  event.locals.tenant = tenant;
  return resolve(event);
};

function isWriteIntent(event: { request: Request }) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.request.method);
}

function regionToHost(r: Region): string {
  return {
    'eu-west-1':       'eu.app.example.com',
    'us-east-1':       'us.app.example.com',
    'ap-southeast-2':  'apac.app.example.com',
  }[r];
}
```

`307 Temporary Redirect` (not `301`) preserves the HTTP method on the
redirected request. `308` would also work but `307` is the most
compatible across HTTP/1.1 stacks.

## DNS-based geo-routing — Route 53 / Cloudflare GeoSteering

```yaml
# Route 53: latency-based routing record
- name: app.example.com
  type: A
  setIdentifier: eu-west-1
  region: eu-west-1
  alias: { dnsName: eu.app.example.com, evaluateTargetHealth: true }
- name: app.example.com
  type: A
  setIdentifier: us-east-1
  region: us-east-1
  alias: { dnsName: us.app.example.com, evaluateTargetHealth: true }
- name: app.example.com
  type: A
  setIdentifier: ap-southeast-2
  region: ap-southeast-2
  alias: { dnsName: apac.app.example.com, evaluateTargetHealth: true }
```

`evaluateTargetHealth: true` — Route 53 stops returning a region's
record if its health check fails, automatically draining traffic.
Health-check endpoint: `/healthz/region` (per-region readiness
including replication-lag check).

## Database — primary-replica with logical replication

```sql
-- on EU primary
CREATE PUBLICATION app_replication FOR ALL TABLES;

-- on US replica
CREATE SUBSCRIPTION app_replication
  CONNECTION 'host=eu-primary.internal port=5432 dbname=app user=replicator'
  PUBLICATION app_replication
  WITH (copy_data = true, create_slot = true);
```

Logical replication is **eventually consistent** — replication lag is
typically <1s but can spike to minutes under load. Read-after-write
queries on the primary remain authoritative; cross-region reads must
tolerate stale data.

## Active-active conflict resolution — LWW + CRDT escape

```ts
// packages/region/src/conflict.ts
import type { Region } from './schema';

// Last-Write-Wins (LWW) — simple, but risks lost updates.
// Use only when fields are independently editable (e.g., user prefs).
export function lwwMerge<T extends { updatedAt: string; region: Region }>(
  local: T, remote: T,
): T {
  return new Date(remote.updatedAt) > new Date(local.updatedAt) ? remote : local;
}

// For collaborative shared state (documents, lists), use Yjs CRDTs
// per collab.md. CRDTs guarantee convergence without coordination.
```

LWW is "good enough" for user-scoped settings and similar
single-actor data. For multi-actor data (shared documents,
collaborative lists, shopping carts) use Yjs CRDT semantics — this
recipe defers to [collab.md](collab.md) for that pattern.

## Cross-region failover — the playbook

```ts
// scripts/failover.ts — run by oncall when a region degrades
import { Region, RegionHealth } from '@sveltesentio/region/schema';
import { route53Client, dbClient } from './aws';
import { auditLog } from '$lib/server/audit';

async function failover(failedRegion: Region, takeoverRegion: Region) {
  // Step 1: confirm failed region is actually down (not just slow).
  const healthChecks = await Promise.all([
    pingRegion(failedRegion),
    pingRegion(takeoverRegion),
  ]);
  if (healthChecks[0].status !== 'failed') {
    throw new Error(`failover aborted: ${failedRegion} not failed (status=${healthChecks[0].status})`);
  }

  await auditLog('region.failover.initiated', { from: failedRegion, to: takeoverRegion });

  // Step 2: promote takeover region's replica to primary (PostgreSQL).
  // This is point-of-no-return — the failed region's primary must NOT be
  // restarted before reseeding from the new primary, or you get split-brain.
  await dbClient.promote(takeoverRegion);

  // Step 3: update Route 53 weights to drain failed region to 0.
  await route53Client.updateRecord({
    name: 'app.example.com',
    setIdentifier: failedRegion,
    weight: 0,
  });

  // Step 4: update tenant-region mappings for tenants pinned to failed region.
  await dbClient.query(`
    UPDATE tenant_regions SET home_region = $1
    WHERE home_region = $2 AND residency_policy = 'global'
  `, [takeoverRegion, failedRegion]);

  await auditLog('region.failover.completed', { from: failedRegion, to: takeoverRegion });
}
```

Failover is **manual by default** (or semi-auto with human approval),
because automatic failover under partial-failure conditions
(network blip, DNS propagation lag) often makes things worse via
flap-failures.

## Replication lag observability

```ts
// src/routes/healthz/region/+server.ts
import { json } from '@sveltejs/kit';
import { RegionHealth, Region } from '@sveltesentio/region/schema';
import { db } from '$lib/server/db';

export const GET = async () => {
  const region = Region.parse(process.env.REGION);
  const lag = await replicationLag();
  const status = lag > 60_000 ? 'degraded' : lag > 300_000 ? 'failed' : 'healthy';
  const health = RegionHealth.parse({
    region,
    status,
    rtt_ms: 0,
    replicationLag_ms: lag,
    lastChecked: new Date().toISOString(),
  });
  return json(health, {
    status: status === 'healthy' ? 200 : 503,
  });
};

async function replicationLag(): Promise<number> {
  const r = await db.query<{ lag: string }>(
    `SELECT EXTRACT(EPOCH FROM (NOW() - pg_last_xact_replay_timestamp())) * 1000 AS lag`,
  );
  return Number(r.rows[0].lag);
}
```

`/healthz/region` returns 503 when replication lag exceeds 60s — DNS
health-check failure → traffic drains automatically.

## Cost — what you're actually paying for

```text
Component               | Single-region | 3-region active-active
─────────────────────────|───────────────|────────────────────────
Compute (web + workers) | 1.0×          | 3.0×
Database (primary + r)  | 1.0×          | 3.0× (each region has primary)
Cross-region egress     | $0            | $$$$ (often >50% of bill)
Replication infra       | $0            | dedicated bandwidth + slots
Operational complexity  | 1.0×          | 5-10× (split-brain, drift, drift-monitoring)
On-call burden          | 1 region      | 3-region rotation
```

Cross-region egress is the silent killer — assume 5-10× single-region
data-transfer cost. Profile + optimize before going active-active.

## Anti-patterns (24)

1. **"Multi-region" by deploying to multiple regions but using a
   single primary database** — that's still single-region for writes,
   with worse latency for distant users. Be honest about the
   architecture.
2. **Active-active without conflict resolution** — concurrent edits
   silently overwrite each other (LWW without thinking).
3. **Auto-failover with low timeout** — flap-failures during
   transient network blips. Manual or semi-auto with cooling-off.
4. **Promoting old primary back online without reseeding** — split-
   brain. The old primary thinks it's still primary; writes diverge.
5. **Cross-region synchronous writes** — adds 50-200ms per
   transaction; users feel it on every interaction.
6. **No replication-lag monitoring** — you discover lag in production
   when read-after-write fails. Alert on lag > 5s.
7. **Tenant-pinned data accessed from wrong region** — GDPR
   violation. Hard-fail (not warn) on cross-region reads of pinned
   tenants.
8. **Region encoded only in DNS, not in app** — local cache /
   debugging assumes single region. Always inject `REGION` env;
   include in every log + span.
9. **Same database username across regions** — credential leak in one
   region compromises all. Per-region credentials with regional KMS.
10. **Redis (cache) shared across regions** — cross-region latency
    on every cache lookup nullifies caching benefit. Per-region
    Redis with stale-on-error fallback.
11. **Session store in single region** — cross-region requests fail
    auth lookups. Replicate sessions per-region or use stateless
    JWTs.
12. **No "drain-and-stop" playbook** — when you actually need to
    decommission a region you have no procedure. Document + drill.
13. **301 redirect for cross-region routing** — browser caches
    permanently; tenant moves region → user stuck on old region.
    Use 307 + short cache TTL.
14. **Ignoring CAP** — wanting strong consistency + multi-region
    writes + partition tolerance simultaneously. Pick two.
15. **No region tag in observability** — cross-region issues invisible
    in dashboards. Tag every span/metric/log with `region`.
16. **Egress cost surprise** — $50K bill arrives. Cross-region traffic
    is metered; cost-attribute it monthly.
17. **No drift monitoring** — schemas diverge across regions because
    one region's migration failed silently. Compare schemas weekly.
18. **Backups stored only in source region** — region-failure =
    backup loss. Cross-region backup replication per
    [backup-recovery.md](backup-recovery.md).
19. **Failover drill never executed** — first real failover is the
    drill. Quarterly drills with audited RTO/RPO.
20. **Region-pinned tenants not declared at signup** — you discover
    half your EU tenants are on US infrastructure. Capture residency
    at signup; enforce at provisioning time per
    [tenant-provisioning.md](tenant-provisioning.md).
21. **Geo-routing by IP geolocation alone** — VPN users get wrong
    region. Combine IP with explicit user preference + tenant pin.
22. **No anycast / split-DNS for internal traffic** — cross-region
    internal calls take public-internet path. Use VPC peering / cloud
    private backbone.
23. **Time skew between regions** — chrony / ntpd misconfigured →
    LWW conflict resolution picks wrong winner. NTP from authoritative
    region-local source.
24. **Treating "multi-region" and "multi-cloud" as the same** —
    multi-region (within one cloud) is hard; multi-cloud is harder
    by an order of magnitude. Don't conflate them in design docs.

## References

- ADRs: [0019](../adr/0019-server-runtime-contract.md),
  [0023](../adr/0023-compliance-observability.md),
  [0034](../adr/0034-cookies-auth-boundary.md)
- Sibling recipes:
  [kubernetes-deployment.md](kubernetes-deployment.md),
  [data-migrations.md](data-migrations.md),
  [backup-recovery.md](backup-recovery.md),
  [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md),
  [observability.md](observability.md),
  [tenant-provisioning.md](tenant-provisioning.md),
  [collab.md](collab.md)
- Upstream:
  CAP Theorem `en.wikipedia.org/wiki/CAP_theorem`,
  PostgreSQL Logical Replication
  `www.postgresql.org/docs/current/logical-replication.html`,
  AWS Route 53 routing policies
  `docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy.html`,
  Yjs CRDTs `docs.yjs.dev/`,
  GDPR Art. 44–50 (international transfers)
  `gdpr-info.eu/chapter-5/`.
