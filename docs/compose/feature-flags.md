# Feature flags — OpenFeature SDK with cookie-pinned SSR + exposure events

Feature flags decouple **deploy** from **release**: code lands behind
a flag in `off` state, gradually rolls out to user cohorts, and the
flag is removed once stable. Done well, this lets a solo maintainer
ship every Friday without rolling back a botched release at 23:00; done
poorly, it's a config sprawl with stale flags, drifting cohorts, and
SSR/CSR hydration mismatches that look exactly like the bug the flag
was hiding.

This recipe is the SvelteKit-specific pattern: **OpenFeature** as the
vendor-neutral SDK seam, **cookie-pinned variant** so SSR and CSR see
the same value across the page lifecycle (no hydration flash),
**server-side evaluation** as the source of truth, and **exposure
events** flowing into the same OTel pipeline so cohort analysis joins
the rest of the observability stack.

## Related

- [observability.md](observability.md) — exposure events emit as OTel
  spans + counters with `flag.key` + `flag.variant` (both bounded).
- [opentelemetry-logs.md](opentelemetry-logs.md) — flag evaluation
  errors emit `WARN`-severity log records.
- [cookies-authoritative.md](cookies-authoritative.md) — flag-pin
  cookie follows the JS-readable `Lax`/`Secure` row in the matrix.
- [auth-oidc.md](auth-oidc.md) — user-targeted flags read identity
  from session; anonymous-targeted flags use cookie-bound bucket key.
- [theming-flash-free.md](theming-flash-free.md) — same SSR-cookie
  pattern; both must resolve before first paint.
- [server-state.md](server-state.md) — flag-gated UI variants must
  invalidate the right TanStack Query keys when flag flips.
- [permissions.md](permissions.md) — flags are NOT permissions; flags
  are deployment gates, permissions are access control. Don't conflate.
- [schemas.md](schemas.md) — Zod-validated flag-value contracts on
  read.
- [principles.md §2.7](../principles.md) — release management.

## When to reach for a flag (and when not to)

```text
Risky deploy: gradual rollout 1% → 10% → 50% → 100% with kill-switch  → flag (mandatory pattern)
A/B experiment with measurable success metric                          → flag with exposure events
Per-customer / per-tenant feature gating                               → flag with targeting rules
Long-lived "this premium customer gets X" toggle                       → entitlements system, not flag
Long-lived "this user has admin role"                                  → permissions.md, not flag
Day-1 dark launch (code shipped, not yet activated)                    → flag, deleted within 30 days
Configuration values (timeouts, URLs, limits)                          → env vars, not flags
"We can't decide which design is right" indecision                     → talk to a designer, not a flag library
```

Two rules: every flag has a **removal date** in its description, and
the codebase has a **kill plan** documented in the flag-management
tool. A flag without a removal date becomes permanent config debt.

## Build vs buy matrix

| Option | Hosting | OpenFeature provider | Per-user targeting | Free-tier ceiling | Self-host | Best for |
|---|---|---|---|---|---|---|
| **OpenFeature + custom in-process** | Your infra | Trivial (`InMemoryProvider`) | Manual rules | n/a | n/a (in-process) | Tiny apps; <10 flags total; no audit need |
| **GrowthBook** (OSS) | SaaS or self-host | `@openfeature/server-provider-growthbook` | ✅ | Generous SaaS / unlimited self-host | ✅ Docker | Default OSS choice; built around OpenFeature; low ops |
| **Unleash** (OSS) | SaaS or self-host | `@openfeature/server-provider-unleash` | ✅ | Generous SaaS / unlimited self-host | ✅ Docker | Mature OSS; org with multiple stacks (Java/Go/Node) |
| **Flagsmith** (OSS) | SaaS or self-host | `@openfeature/js-flagsmith-provider` | ✅ | Generous SaaS / unlimited self-host | ✅ Docker | OSS with multivariate + remote-config focus |
| **LaunchDarkly** | SaaS only | `@openfeature/server-provider-launchdarkly` | ✅ best-in-class | Limited (per-context-MAU pricing) | ❌ | Enterprise commit, deep targeting/experiment features |
| **PostHog feature flags** | SaaS or self-host | `@openfeature/server-provider-posthog` | ✅ | Generous SaaS / unlimited self-host | ✅ Docker | Already on PostHog for analytics; flags as bonus |
| **ConfigCat** | SaaS only | `@openfeature/js-configcat-provider` | ✅ | Generous free | ❌ | Simple SaaS, polling-based, low-ops |

Three rules from the matrix:

- **Always use OpenFeature SDK as the seam** — vendor-specific SDKs
  lock you in; `@openfeature/server-sdk` lets you swap providers
  without rewriting evaluation sites.
- **Self-host the OSS option you pick** until you outgrow it — pricing
  for SaaS flag tools scales painfully with MAU.
- **Don't multi-vendor** — pick one; flags duplicated across providers
  are a "which is canonical?" debugging nightmare.

## Install

```bash
pnpm -F @sveltesentio/observability add \
  @openfeature/server-sdk@^1.18 \
  @openfeature/web-sdk@^1.5
# Pick one provider:
pnpm -F @sveltesentio/observability add \
  @openfeature/server-provider-growthbook@^0.4
pnpm -F @sveltesentio/observability add \
  @openfeature/web-provider-growthbook@^0.4
```

Server SDK and web SDK are distinct packages because their async
contracts differ (server `evaluate*` returns `Promise`; web caches
synchronously after init). OpenFeature 1.x is the stable line as of
2026-04.

## Server-side bootstrap

```ts
// src/lib/flags/server.ts
import { OpenFeature } from '@openfeature/server-sdk';
import { GrowthBookProvider } from '@openfeature/server-provider-growthbook';
import { env } from '$env/dynamic/private';

export const flagsReady = OpenFeature.setProviderAndWait(
  new GrowthBookProvider({
    apiHost: env.GROWTHBOOK_API_HOST,
    clientKey: env.GROWTHBOOK_CLIENT_KEY,
  }),
);

export const serverFlagClient = OpenFeature.getClient('server');
```

```ts
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { flagsReady, serverFlagClient } from '$lib/flags/server';

await flagsReady;

export const handle = sequence(async ({ event, resolve }) => {
  const session = event.locals.session;
  const bucketKey = session?.userId ?? event.cookies.get('flag-bucket') ?? mintBucket(event.cookies);

  event.locals.flags = serverFlagClient.bind({
    targetingKey: bucketKey,
    userId: session?.userId,
    tier: session?.tier ?? 'anonymous',
    locale: event.locals.locale,
    deploymentEnv: env.DEPLOYMENT_ENV,
  });
  return resolve(event);
});
```

Five server-bootstrap rules:

- **`setProviderAndWait`** at module load — flags must be available
  before the first request; lazy-init causes 5xx for first-N requests
  while provider connects.
- **One bucket key per user** — anonymous gets a UUIDv7 cookie minted
  on first request; authenticated overrides with `userId`. Switching
  bucket keys mid-session causes "experiment leak" (user sees variant
  A then B).
- **`event.locals.flags = client.bind(context)`** per request —
  evaluation context (tier, locale, env) lives on the request; binding
  per-request makes downstream `event.locals.flags.getBoolean(...)`
  call-sites concise.
- **Targeting context is bounded cardinality** — `tier`, `locale`,
  `deploymentEnv` enums yes; `email` no (use hashed `userId` for
  per-user targeting).
- **Provider-init failure is log + fall-through to defaults** —
  flag-service outage cannot 5xx your app; default-value evaluation
  must work offline.

## Client-side bootstrap

```ts
// src/lib/flags/client.ts
import { OpenFeature } from '@openfeature/web-sdk';
import { GrowthBookWebProvider } from '@openfeature/web-provider-growthbook';
import { env as publicEnv } from '$env/dynamic/public';

export async function initClientFlags(initialContext: Record<string, unknown>): Promise<void> {
  await OpenFeature.setContext(initialContext);
  await OpenFeature.setProviderAndWait(
    new GrowthBookWebProvider({
      apiHost: publicEnv.PUBLIC_GROWTHBOOK_API_HOST,
      clientKey: publicEnv.PUBLIC_GROWTHBOOK_CLIENT_KEY,
    }),
  );
}

export const clientFlagClient = OpenFeature.getClient('web');
```

```ts
// src/routes/+layout.ts
import { browser } from '$app/environment';
import { initClientFlags } from '$lib/flags/client';

export async function load({ data }) {
  if (browser) {
    await initClientFlags(data.flagContext);
  }
  return data;
}
```

Three client-bootstrap rules:

- **Same context as server** — `data.flagContext` carries the bucket
  key + tier + locale from `+layout.server.ts`. Server and client
  evaluating with different contexts produces hydration mismatches.
- **Web SDK init is async; first paint must not wait** — server-side
  evaluation result rides through `data` and renders SSR; client
  evaluation runs after hydration to enable client-side toggles. The
  initial render uses the SSR value.
- **Public-env DSN** — `PUBLIC_GROWTHBOOK_*` for client; server uses
  `$env/dynamic/private`. Bucket-key minting happens server-side.

## Use site

```svelte
<!-- src/routes/checkout/+page.svelte -->
<script lang="ts">
  import { page } from '$app/state';

  const newCheckoutEnabled = $derived(page.data.flags.newCheckout);
</script>

{#if newCheckoutEnabled}
  <NewCheckout />
{:else}
  <LegacyCheckout />
{/if}
```

```ts
// src/routes/checkout/+page.server.ts
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const newCheckout = await locals.flags.getBooleanValue('checkout-v2', false, {
    track: { context: 'page-load', route: 'checkout' },
  });
  return { flags: { newCheckout } };
};
```

Three use-site rules:

- **Evaluate in `+page.server.ts` `load`, render in `+page.svelte`** —
  server is the source of truth; client just reads the resolved value
  from `data`. Eliminates hydration mismatches.
- **Default value is the call's second argument** — every evaluation
  declares its safe default; provider outage falls through transparently.
- **`track` context** — exposure events tie variant assignments to
  user actions; sample 100% of exposures (counts are bounded by
  page views).

## Cookie-pinned variant — preventing flicker

```ts
// src/lib/flags/cookie-pin.ts
import type { Cookies } from '@sveltejs/kit';
import { uuidv7 } from '$lib/ids';

const PIN_COOKIE = 'flag-bucket';

export function mintBucket(cookies: Cookies): string {
  const bucketKey = uuidv7();
  cookies.set(PIN_COOKIE, bucketKey, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    priority: 'medium',
  });
  return bucketKey;
}
```

Per [cookies-authoritative.md](cookies-authoritative.md): bucket-pin
cookie is `HttpOnly` because the bucket key is the targeting input —
client-side mutation would let users self-assign variants. Cookie
follows the same emit pattern as the session cookie except for
`Path=/` + `priority: 'medium'` (eviction-safe but lower than session).

Two pin rules:

- **Bucket key is sticky for the cookie lifetime** — flag flips
  re-bucket the user only if targeting rules change; the bucket key
  itself is stable for a year. This makes "I saw variant A, now I see
  B" investigations tractable.
- **Authenticated `userId` overrides anonymous bucket on login** — the
  pre-login bucket cookie is replaced with the userId-derived bucket;
  this can flip variants at login (acceptable trade-off; alternative
  is dual-bucket with merge logic, which is its own can of worms).

## Exposure events

```ts
// src/lib/flags/expose.ts
import { trace, metrics } from '@opentelemetry/api';

const tracer = trace.getTracer('flags');
const meter = metrics.getMeter('flags');
const exposureCounter = meter.createCounter('flag.exposure', {
  description: 'Flag-variant exposure count',
});

export function recordExposure(key: string, variant: string, ctx: { route: string; bucketKey: string }): void {
  exposureCounter.add(1, {
    'flag.key': key,
    'flag.variant': variant,
    route: ctx.route,
  });
  tracer.startSpan('flag.exposure', {
    attributes: {
      'flag.key': key,
      'flag.variant': variant,
      'flag.bucket': ctx.bucketKey,
      route: ctx.route,
    },
  }).end();
}
```

Per [observability.md](observability.md):

- **`flag.key` enum** — bounded cardinality (you should know your flag
  count); safe metric label.
- **`flag.variant` enum per flag** — `on`/`off` for booleans;
  `control`/`treatment-a`/`treatment-b` for experiments.
- **`flag.bucket` is per-user** — span attribute ok; metric label
  **never** (cardinality explosion).
- **Counter, not log** — exposure rate is a metric (rate question),
  not a per-event audit (log question).

For experiment analysis (variant impact on conversion), the exposure
metric joins with conversion metrics by `flag.key` + `flag.variant`
in your metrics backend; flag-vendor-side experiment dashboards
(GrowthBook, Unleash) are an alternative if you want the analysis
"in-tool".

## Flag definition contract

```text
Every flag in the management tool has:
  description       — what does it do, who owns it
  removal_date      — ISO date; 30/60/90 days from creation
  default_value     — matches the in-code default
  kill_switch_owner — who flips this if prod is on fire
  rollout_plan      — 1% → 10% → 50% → 100% (with dates) OR experiment design
  cleanup_pr        — link to the PR that will delete the flag once 100% rolled
```

Without these fields, flags accumulate. Enforce via flag-tool linter
or PR template.

## Targeting rules

```ts
// flag definition (e.g. GrowthBook UI):
// Rule 1: tier == 'enterprise' → on
// Rule 2: locale in ['de', 'en-US'] AND deploymentEnv == 'production' → 50% on (bucketKey-based)
// Default: off
```

Three targeting rules:

- **Rules evaluated in order, first match wins** — explicit ordering
  beats implicit precedence.
- **Bucket-based percentage rollout, not random** — random sampling
  re-rolls per evaluation; bucket-based is sticky per user.
- **`deploymentEnv` is always a top-level rule** — staging/preview
  never accidentally evaluates production rules.

## Stale-flag detection

```ts
// scripts/detect-stale-flags.ts (run in CI weekly)
import { readdir, readFile } from 'node:fs/promises';
import { OpenFeature } from '@openfeature/server-sdk';

const codeFlagKeys = await grepFlagKeysFromSource('src');
const definedFlagKeys = await fetchFlagKeysFromProvider();

const orphaned = codeFlagKeys.filter((k) => !definedFlagKeys.includes(k));
const unused = definedFlagKeys.filter((k) => !codeFlagKeys.includes(k));

if (orphaned.length || unused.length) {
  console.error({ orphaned, unused });
  process.exit(1);
}
```

Two cleanup rules:

- **Orphaned (in code, not in tool)** — code references a flag that
  no longer exists; provider returns default forever, no rollout
  control. Delete the dead branch.
- **Unused (in tool, not in code)** — flag exists in management tool
  but no code reads it; consuming MAU quota for nothing. Archive in
  the tool.

## Testing

```ts
import { describe, it, expect } from 'vitest';
import { OpenFeature, InMemoryProvider } from '@openfeature/server-sdk';

describe('checkout flag', () => {
  it('renders new checkout when flag on', async () => {
    await OpenFeature.setProviderAndWait(new InMemoryProvider({
      'checkout-v2': { variants: { on: true, off: false }, defaultVariant: 'on', disabled: false },
    }));
    const value = await OpenFeature.getClient().getBooleanValue('checkout-v2', false);
    expect(value).toBe(true);
  });

  it('falls through to default on provider outage', async () => {
    await OpenFeature.setProviderAndWait(new BrokenProvider());
    const value = await OpenFeature.getClient().getBooleanValue('checkout-v2', false);
    expect(value).toBe(false);
  });
});
```

`InMemoryProvider` is the canonical test seam — same `getBooleanValue`
API as production; no provider mock needed.

## Migration recipe — env vars to flags

```ts
// before
const enabled = env.NEW_CHECKOUT === 'true';

// after — server side
const enabled = await locals.flags.getBooleanValue('checkout-v2', false);
```

Three migration rules:

- **Don't migrate every env var** — config (URLs, timeouts, limits)
  stays in env; only **gradual-rollout** or **per-user/tenant** toggles
  go through flags.
- **Default value matches old env-var default** — flag-provider outage
  must produce the same behaviour as the env var.
- **Migration PR closes the env var** — leaving both reads (env OR
  flag) is a debugging trap.

## Anti-patterns

- **Hard-coding flag values in source for "clarity"** — defeats the
  whole point; the flag-tool decides, code reads.
- **Reading flag values in `+page.svelte` directly** (not via `data`)
  — async eval inside reactive code triggers loading flicker;
  evaluate in `+page.server.ts` `load` and pass through `data`.
- **Different evaluation contexts on server vs client** — hydration
  mismatch; same context object SSR + CSR.
- **No default value** — provider outage 5xx; second arg of every
  `getBooleanValue` is the offline fallback.
- **Per-evaluation provider init** — connects on every call; init
  once at boot.
- **Bucket key derived from `userAgent` or IP** — bucket flips on
  device change or network move; user re-bucketed mid-session.
- **Mid-session bucket-key change without intent** — re-buckets user
  through experiment; one observed exception: anonymous→authenticated
  transition (acceptable) and explicit user opt-out (acceptable).
- **Flag-tool as permission system** — flags decide deployment;
  permissions decide access. Flags target by tier; permissions enforce
  by role.
- **Flags without removal date** — config debt accumulates;
  enforce via flag-tool field + PR template.
- **Removing flag from tool but leaving code reference** — code
  evaluates against default forever; orphan-detection script in CI.
- **Removing flag from code but leaving tool definition** — MAU quota
  burn; weekly cleanup audit.
- **Sampling exposure events** — dilutes statistical power;
  exposures are bounded by page views, sample 100%.
- **`flag.bucket` as a metric label** — cardinality explosion;
  bucket is a span attribute (per-event ok), not a metric label
  (must be bounded).
- **Anonymous bucket cookie not `HttpOnly`** — client mutation lets
  users self-assign variants; bucket key targets rules, must be
  authoritative.
- **Provider-vendor SDK directly without OpenFeature** — vendor lock-in;
  next year's "we should switch from X to Y" PR rewrites every
  evaluation site.
- **Mixing two providers in one app** — "is the flag on?" depends on
  which provider you ask; pick one.
- **Flag-evaluation on the cold-start path of every Lambda invocation**
  — pre-warm or use static-fallback file shipped with the bundle.
- **Logging flag values for every request** — exposure metric covers
  the rate question; logs are for debug-mode only.
- **Skipping `kill_switch_owner` field** — when prod is on fire at
  03:00, who flips the flag is a mandatory answer; don't make oncall
  guess.

## References

- [OpenFeature spec](https://openfeature.dev/specification/)
- [OpenFeature JS SDK](https://openfeature.dev/docs/reference/technologies/server/javascript/)
- [GrowthBook docs](https://docs.growthbook.io/)
- [Unleash architecture](https://docs.getunleash.io/understanding-unleash/the-anatomy-of-unleash)
- [LaunchDarkly — Bucket key best practices](https://docs.launchdarkly.com/sdk/concepts/user-keys)
- [Martin Fowler — Feature Toggles](https://martinfowler.com/articles/feature-toggles.html)
