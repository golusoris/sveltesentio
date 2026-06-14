# Feature-flag rollout patterns — percentage, targeting, kill-switch, gradual rollback

> Progressive-delivery mechanics on top of the OpenFeature provider
> established in [feature-flags.md](feature-flags.md) — percentage
> rollouts, targeting rules, cohort pinning, kill-switches, and
> staged rollback under SLO breach. Governed by the same privacy +
> audit posture as the flag catalog itself
> ([audit-log.md](audit-log.md),
> [observability.md](observability.md)).

Flag rollouts are **release engineering**, not product toggles. A
rollout plan exists **before** the flag ships: stages (e.g.
1 %/5 %/25 %/100 %), SLO guards, rollback trigger, audit trail. The
plan is a document in the PR, not lore. Cohort-pinning, kill-switch
discipline, and gradual rollback are the three patterns that separate
"feature flag" from "pager-incident-waiting-to-happen".

## Related

- [feature-flags.md](feature-flags.md) — provider + cookie-pinned SSR
  contract
- [onboarding.md](onboarding.md) — cohort-pinned variant example
- [audit-log.md](audit-log.md) — flag-change audit trail
- [observability.md](observability.md) — exposure events + SLO link
- [sentry-or-equivalent.md](sentry-or-equivalent.md) — error-rate
  trigger source
- [caching.md](caching.md) — CDN/SSR cache invalidation on flag flip
- [ADR-0019](../adr/0019-openapi-fetch-rfc9457.md) — server boundary
- [ADR-0023](../adr/0023-uuidv7-default.md) — UUIDv7 exposure IDs

## When to use what — decision tree

```text
Temporary gate for in-progress feature                → short-lived flag
Permanent configuration (locale, region)              → config, NOT a flag
A/B experiment (with metric comparison)               → experiment flag + exposure events
Kill switch for an integration                        → ops flag (never expires)
Gradual rollout with SLO guard                        → percentage rollout + SLO alert
Cohort-pinned onboarding                              → targeting by user.created_at
Emergency disable                                     → kill-switch (separate flag from rollout)
```

## Three rollout rules

1. **Every flag has a rollout plan in its PR** — stages, success
   metric, rollback trigger, owner.
2. **Kill-switch is a separate flag from the rollout flag.** Never
   overload one flag for both "who sees the feature" and "is the
   feature even alive".
3. **Cohorts pin once.** A user in the 10 % rollout stays in the 10 %
   when you bump to 25 %; don't re-sample per evaluation.

## Shape — rollout plan schema

```ts
// src/lib/flags/rollout.ts
import { z } from 'zod';

export const RolloutStage = z.object({
  name: z.enum(['dark', 'internal', 'beta', 'canary', 'gradual', 'ga']),
  percent: z.number().min(0).max(100),
  minDurationHours: z.number().int().min(1).max(720),
  sloGuards: z.array(z.string()).min(1),   // metric ids
});

export const RolloutPlan = z.object({
  flagKey: z.string().regex(/^[a-z0-9-]+$/),
  owner: z.string().min(2),
  stages: z.array(RolloutStage).min(2),
  killSwitchKey: z.string().regex(/^[a-z0-9-]+$/),
  rollbackTrigger: z.object({
    sloBreachMinutes: z.number().int().min(5).max(60),
    errorRateThresholdPct: z.number().min(0.5).max(20),
  }),
  expiresAt: z.string().datetime(),         // flag MUST expire
});
export type RolloutPlan = z.infer<typeof RolloutPlan>;
```

Six plan rules:

1. **`stages` has at least two** — "0 → 100" is not a rollout, it's a
   deploy.
2. **`minDurationHours` per stage** — promotes only after soak, never
   same-day 1 %→100 %.
3. **`sloGuards` names are bounded** and reference existing metrics
   (error rate, p95 latency, INP, CLS).
4. **`killSwitchKey` is a different string** — enforce via lint.
5. **`expiresAt` is mandatory** — flags that outlive their rollout
   become technical debt; see "flag hygiene" below.
6. **Owner is a GitHub handle**, not a team — ownership of a flag is
   individual; teams dilute accountability.

## Five canonical stages

| Stage | Audience | Min duration | SLO guard example |
|---|---|---|---|
| `dark` | No users; logs + metrics only | 24 h | No new errors vs baseline |
| `internal` | Company employees | 48 h | Error rate < 0.5 % |
| `beta` | Opt-in beta cohort | 72 h | P95 latency within 10 % of baseline |
| `canary` | 1 % of eligible prod | 24 h | Error rate < 1 %, INP within 10 % |
| `gradual` | 5 % → 25 % → 50 % | 12 h per step | Error + latency + business KPI |
| `ga` | 100 % | — | Stable for ≥ 7 days before flag removal |

Five stage-discipline rules:

1. **Dark launch first** for anything with a server-side code path —
   catch null-pointer surprises without user impact.
2. **Employees are not prod canaries** — internal usage patterns
   differ. A clean internal stage is a prerequisite, not sufficient.
3. **Never skip stages under schedule pressure** — the pressure is
   usually what caused the bug you'll uncover at canary.
4. **`gradual` splits are 5 → 25 → 50 → 100** typical — doubling is
   fine; 5 →100 is not gradual.
5. **At GA, flip the default and schedule removal** — do not leave
   the flag in the codebase.

## Consistent bucketing

```ts
// src/lib/flags/bucketing.ts
import { createHash } from 'node:crypto';

export function isUserInPercent(
  flagKey: string,
  userId: string,
  percent: number,
): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const hash = createHash('sha256').update(`${flagKey}:${userId}`).digest();
  const bucket = hash.readUInt32BE(0) % 10000;
  return bucket < percent * 100; // 0..9999 for sub-percent precision
}
```

Six bucketing rules:

1. **Hash `flagKey + userId`** so different flags have independent
   samples — shared bucketing correlates rollouts and distorts metrics.
2. **Stable across evaluations** — same user + flag always maps to
   the same bucket.
3. **Bumping percent is monotonic inclusion** — a user in 5 % is in
   10 %, 25 %, etc. No "oscillation" between stages.
4. **Sub-percent precision via mod-10000** — allows 0.1 % canary.
5. **Bucket key is user-level by default**, session-level for
   anonymous flags (use `session.id` fallback).
6. **Tenant-aware flags** hash `flagKey + tenantId` so all tenants'
   users share the rollout scope — a 10 % tenant rollout is 10 % of
   tenants, not of users.

## Cohort pinning

Five cohort rules:

1. **Pin on first exposure** — write cohort (`variant: 'treatment'` or
   `'control'`) to `user.flag_cohorts[flagKey]` once.
2. **Re-evaluate only on plan change** — if the stage / percent
   changes, recompute; don't re-roll on every request.
3. **Pinning survives logout** via user DB column; anonymous pins
   survive via signed cookie with short TTL.
4. **Expose cohort as OTel attribute** (bounded enum) — join to
   business metrics without leaking user id.
5. **Pin-at-signup** for onboarding-lifecycle flags (see
   [onboarding.md](onboarding.md)) — a user starts with flow X and
   completes with flow X, even if you flip the default mid-flow.

## Targeting rules

```ts
// src/lib/flags/targeting.ts
import { z } from 'zod';

export const TargetingRule = z.object({
  attribute: z.enum([
    'user.role',
    'user.plan',
    'tenant.id',
    'tenant.tier',
    'user.country',
    'session.device_class',
  ]),
  op: z.enum(['in', 'eq', 'regex_match', 'before', 'after']),
  values: z.array(z.string()).min(1),
  priority: z.number().int().min(0).max(100),
});
```

Six targeting rules:

1. **Attributes are bounded** — free-form attribute names explode
   evaluation cost and make audit-log noisy.
2. **Priority is explicit** — when two rules match, the highest
   priority wins; no "first-match" ambiguity.
3. **Never target on email** (PII) — use pseudonymous role/plan/tenant.
4. **Country targeting is opt-in** — requires a geo-resolver with its
   own consent posture; do not fingerprint.
5. **Internal-employee targeting** uses `user.role == 'staff'`, not
   an email regex.
6. **Combine with percent**: "50 % of pro plan + 100 % of staff" is
   two rules with explicit priorities.

## Kill-switch discipline

```ts
// src/lib/flags/kill-switch.ts
export async function evaluateWithKillSwitch(
  flagKey: string,
  killKey: string,
  ctx: EvalContext,
): Promise<boolean> {
  const killed = await flags.getBooleanValue(killKey, false, ctx);
  if (killed) return false;
  return flags.getBooleanValue(flagKey, false, ctx);
}
```

Seven kill-switch rules:

1. **Kill-switch is its own flag key** — one rollout flag + one kill
   flag per feature.
2. **Default `false`** — kill-switch is "kill if true"; default-false
   is fail-safe.
3. **Fast-path cached locally** on the edge — kill-switch evaluation
   must not add 50 ms on every request.
4. **Ops ownership** — SRE/on-call owns the kill-switch, product
   owns the rollout flag. Separation of duties.
5. **Killing publishes an audit event** with reason + actor.
6. **Kill-switch never expires** — it outlives the feature for 90
   days post-GA in case of regression.
7. **Kill-switch wins** — targeted rules and cohort pins are
   overridden by kill-switch.

## Gradual rollback

Six rollback rules:

1. **Rollback is a stage reversal**, not a kill-switch (unless
   kill-switch is proportionate).
2. **Halving-then-zero**: 50 % → 25 % → 5 % → 0 % with 10-min soak —
   lets you spot whether the issue was exposure-linked.
3. **SLO-driven auto-rollback** — a linked alert flips the stage to
   the previous one. Requires a paved-road integration with your
   alerting.
4. **Announce the rollback** in the same channel the rollout was
   announced; stakeholders see status changes.
5. **Post-mortem on any rollback past `canary`** — a canary fail is
   the system working; a `gradual`-stage rollback is a missed
   canary signal.
6. **Flag-hygiene cleanup** — a rolled-back flag stays put while the
   fix is shipped; expiry is extended.

## SLO guards

```ts
// src/lib/flags/slo-guard.ts
export type SloGuard = {
  metric: 'error_rate' | 'p95_latency_ms' | 'inp_ms' | 'cls';
  baselineWindowMin: number;
  deltaPct: number;        // e.g. 10 = alert at 10% worse than baseline
  minSamples: number;      // avoid tripping on tiny windows
};

export async function evaluateGuard(
  guard: SloGuard,
  flagKey: string,
): Promise<'ok' | 'warn' | 'breach'> {
  const baseline = await queryMetric(guard.metric, guard.baselineWindowMin, {
    flag: flagKey,
    variant: 'control',
  });
  const treatment = await queryMetric(guard.metric, guard.baselineWindowMin, {
    flag: flagKey,
    variant: 'treatment',
  });
  if (treatment.n < guard.minSamples) return 'ok';
  const ratio = treatment.value / baseline.value;
  if (ratio > 1 + guard.deltaPct / 100) return 'breach';
  if (ratio > 1 + guard.deltaPct / 200) return 'warn';
  return 'ok';
}
```

Five SLO-guard rules:

1. **Compare treatment to control within the same flag** — not to
   historical baseline. Time-of-day shifts confuse historical compare.
2. **Minimum sample size** — a 1 % stage with 200 requests is not a
   verdict.
3. **Two thresholds**: warn (slack ping) and breach (auto-rollback).
4. **Guards run per-stage**, not continuously — soaking a stage is
   the point; a noisy guard during stage transition is expected.
5. **Business-metric guards optional** — revenue-per-session or
   conversion-rate guards belong to A/B experimentation tooling, not
   rollout discipline.

## A/B experimentation vs rollout

Five distinction rules:

1. **Rollout = ship the feature; A/B = decide between variants**.
2. **A/B requires a randomized control** persisted per cohort; a
   rollout does not.
3. **A/B needs pre-registered hypothesis + sample size calc**;
   rollouts do not.
4. **Multi-armed bandits are A/B territory**, not rollout — never
   use bandit for risky deploys.
5. **Both emit exposure events**, but A/B links them to a conversion
   table; rollouts link them to SLO metrics.

## Exposure events

```ts
// src/lib/flags/expose.ts
export async function expose(
  flagKey: string,
  variant: string,
  ctx: EvalContext,
): Promise<void> {
  await analytics.track('flag_exposed', {
    flag: flagKey,
    variant,
    stage: ctx.stage,
    tenant_tier: ctx.tenant.tier,
    session_id: ctx.sessionId,
  });
}
```

Five exposure-event rules:

1. **Fire once per session per flag** — dedupe via in-memory set.
2. **`session_id` is pseudonymous** — never user email/name.
3. **Bounded attribute values** only; no free-form strings.
4. **Ship to the same analytics sink** as the rest of the funnel so
   joins work natively.
5. **Server-side-eval = server-side emit**; client-side-eval =
   client-side emit. Don't mix.

## Flag hygiene

Six hygiene rules:

1. **Every flag has `expiresAt`** — CI fails if a flag in code lacks
   a corresponding plan entry with a future date.
2. **Post-GA removal PR is scheduled** at the `expiresAt` date — a
   Dependabot-like bot opens it.
3. **Dead flags** (not evaluated in 30 days) are auto-archived and
   the code path removed in a cleanup sprint.
4. **Max 50 live flags per service** — beyond that, evaluation cost
   and cognitive load outweigh benefit.
5. **Flag registry is code** — the SDK loads from a versioned
   manifest, not a dashboard-only store.
6. **Audit every flag create/archive/delete** via
   [audit-log.md](audit-log.md) with actor + reason.

## Observability

Bounded attributes:

- `flag.key` — bounded enum (registry)
- `flag.variant` — `control|treatment|<variant-name>`
- `flag.stage` — `dark|internal|beta|canary|gradual|ga`
- `flag.rollout_bucket` — bucketed percent `0-1|1-5|5-25|25-50|50-100`
- `flag.kill_switched` — `true|false`

Gauges:

- `flag.exposure_rate_per_stage` — should track the stage's percent
- `flag.error_rate_diff_pct` — treatment vs control
- `flag.count_live` — total live flags per service

Alerts:

- Exposure rate deviates from planned percent by >2 × (cohort-pin
  regression)
- Kill-switch flipped → page on-call
- SLO guard = `breach` → auto-rollback + page
- Flag past `expiresAt` → weekly digest to owner

## Testing

Four test lanes:

1. **Unit** — bucketing is stable across calls; monotonic in percent.
2. **Cohort persistence** — a pinned user stays in treatment through
   a stage change.
3. **Kill-switch** — flipping `killKey` returns `false` regardless of
   rollout stage or targeting.
4. **SLO-guard simulation** — feed synthetic metrics, assert
   `ok`/`warn`/`breach` boundaries.

## Anti-patterns

1. **No rollout plan in the PR** — ships straight to 100 %.
2. **Overloading rollout flag as kill-switch** — flipping to pause
   also reverses the rollout; no clean separation.
3. **Re-bucketing on every eval** — users oscillate in/out of
   treatment; metrics become noise.
4. **Skipping stages** — 1 % → 100 % under schedule pressure.
5. **Employee-as-canary** — internal usage never trips prod edge
   cases.
6. **Targeting on email regex** — brittle and PII-risky.
7. **Percent without sample size** — 1 % of 300 requests is not a
   signal.
8. **Flags without owner** — nobody cleans them up.
9. **Flags without `expiresAt`** — permanent tech debt.
10. **Dashboard-only flag writes without audit** — post-incident
    forensics impossible.
11. **Flipping in prod while on-call is asleep** — coordinate
    rollouts with on-call; prefer business hours.
12. **No cohort pinning for onboarding flags** — users bounce between
    onboarding flows mid-session.
13. **Free-form `flag.key` labels** — cardinality bomb in metrics.
14. **Kill-switch default `true`** — fail-open is the opposite of
    fail-safe for operational levers.
15. **Coupling experiment arms to rollout stages** — conflates
    statistical significance with deploy safety.
16. **Using feature flags for feature pricing** (plan entitlements)
    — that's configuration, not a flag.
17. **Not removing flag after GA** — code rots around it.
18. **Auto-rollback without audit** — can't answer "who rolled back
    when".
19. **SLO guards comparing to historical baselines** — time-of-day
    shifts false-positive.
20. **Tenant-override targeting without expiry** — turns into
    permanent per-tenant forks, undoing the point of one codebase.

## References

- [ADR-0019 — openapi-fetch + RFC 9457](../adr/0019-openapi-fetch-rfc9457.md)
- [ADR-0023 — UUIDv7 default](../adr/0023-uuidv7-default.md)
- [OpenFeature specification](https://openfeature.dev/specification/)
- [Progressive Delivery — Fowler/Humble](https://martinfowler.com/articles/progressive-delivery.html)
- [LaunchDarkly Guardian experimentation](https://launchdarkly.com/blog/guardian/) (vendor reference, conceptual)
- [Accelerate — DORA](https://dora.dev/) (deploy-frequency & change-fail-rate)
- [feature-flags.md](feature-flags.md) / [onboarding.md](onboarding.md) / [audit-log.md](audit-log.md) / [observability.md](observability.md) / [caching.md](caching.md) / [sentry-or-equivalent.md](sentry-or-equivalent.md)
