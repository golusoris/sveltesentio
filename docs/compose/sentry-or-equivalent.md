# Error tracking — Sentry / GlitchTip / Highlight self-host trade-offs

[observability.md](observability.md) covers traces and metrics — the
"what is the system doing" signal. [opentelemetry-logs.md](opentelemetry-logs.md)
covers structured logs — the "what happened during this request"
signal. Error tracking is the third: a stateful per-error
**aggregation** with stack-trace symbolication, fingerprinting,
release-tracking, and user-impact metrics that turns "1,000 errors per
hour across 30 routes" into "we have 4 distinct issues, here's their
priority, here's the regression PR".

This recipe is the buy-vs-self-host decision matrix and the wire-up
pattern that keeps error tracking and OTel **complementary** instead of
duplicative — Sentry is not a span backend; OTel is not an
issue-aggregation tool. They cover different jobs and the integration
matters for both.

## Related

- [observability.md](observability.md) — traces + metrics; error
  tracking joins via `correlation.id`.
- [opentelemetry-logs.md](opentelemetry-logs.md) — `ERROR`-severity
  log records mirror what error tracker captures, but stop short of
  fingerprinting + grouping.
- [http-client.md](http-client.md) — RFC 9457 `ProblemError` is the
  canonical error shape; error tracker fingerprints on `type` URI.
- [ai-audit-hook.md](ai-audit-hook.md) — AI errors emit to **both** the
  audit sink (compliance) and the error tracker (operational); not
  either-or.
- [trusted-types.md](trusted-types.md) — CSP `report-to` violations
  flow into the error tracker as a separate issue type.
- [pwa.md](pwa.md) — service-worker errors require browser SDK
  integration with `executionContext: 'serviceworker'`.
- [cookies-authoritative.md](cookies-authoritative.md) — error tracker
  cookies (Sentry session-replay) follow the consent-banner contract.
- [principles.md §2.7](../principles.md) — observability tooling.

## When to add error tracking distinct from OTel

```text
You want grouped issues with regression detection                 → mandatory
You want session replay for UX bug repro                          → Sentry only (OTel has no equivalent)
You want client-side JS error capture with sourcemap symbolication → mandatory
Source-of-truth observability is OTel-native (Tempo + Loki)       → still want error tracker — different signal
Tiny side project with <100 errors/day                            → check OTel `ERROR`-severity logs first; defer
Compliance-sensitive (HIPAA / EU resident data only)              → self-host (GlitchTip / Sentry self-host / Highlight self-host)
Cost-sensitive solo / OSS project                                 → GlitchTip self-host; Sentry SaaS free tier capped
Multi-language stack (Go backend + SvelteKit frontend)            → Sentry SDK ubiquity wins; GlitchTip language coverage thinner
```

OTel's error story is "log records with `severityNumber: ERROR` +
spans with `recordException`". That's traceable; it is not
**aggregated**. Error tracking adds:

- **Fingerprinting** — group by stack + message + release into "issues".
- **First-seen / last-seen + regression** — tracker compares against
  prior release; "this issue regressed in v1.4.2".
- **User impact** — "30% of authenticated sessions" not "47 events".
- **Session replay** (Sentry, Highlight) — DOM mutation timeline at
  error time.

If you don't need any of those, OTel `ERROR`-severity logs may be
enough. Most production apps need at least the first three.

## Buy vs. self-host matrix

| Option | Hosting | Pricing model | Session replay | OTel ingest | Sourcemap UX | EU residency | Best for |
|---|---|---|---|---|---|---|---|
| **Sentry SaaS** | sentry.io | Per-event tiers + replay seats | ✅ industry-leading | ✅ (OTLP HTTP) | ✅ CLI + Vite plugin | EU region available | Default for non-compliance-blocked teams; deepest SDK + integration ecosystem |
| **Sentry self-host** | Docker compose, k8s | OSS license (BSL post v25) | ✅ | ✅ | ✅ | ✅ wherever you host | Compliance-blocked teams that want the full Sentry feature set; ops-heavy |
| **GlitchTip** | Docker / `pip install` | OSS (MIT) — free self-host | ❌ no replay | ⚠️ partial | ✅ Sentry-CLI compatible | ✅ wherever you host | Solo / OSS / cost-sensitive; uses Sentry SDK clients (drop-in) |
| **Highlight (self-host)** | Docker compose, k8s | OSS (Apache 2.0) | ✅ | ✅ first-class OTel | ✅ | ✅ | Teams that want session replay + OTel without Sentry licensing |
| **Bugsnag / Rollbar / Raygun** | SaaS | Per-event | varies | varies | ✅ | varies | Niche stacks; default to Sentry/Highlight unless org-wide commitment |

Three rules from the matrix:

- **GlitchTip uses Sentry SDK clients** — install `@sentry/svelte` per
  Sentry, point DSN at GlitchTip; you can swap providers later without
  client-side code changes.
- **Sentry's BSL license (v25+) is non-issue for self-host** — you
  cannot resell hosted Sentry as a service; using it for your own app
  is unrestricted. Read the license once and move on.
- **Highlight is the only self-host with strong OTel-native ingest** —
  if your org is OTel-first and you want session replay, Highlight is
  the answer. Sentry's OTel support is good but Sentry-flavoured
  (events become Sentry issues, spans become Sentry transactions).

## Install — Sentry SDK (also works for GlitchTip)

```bash
pnpm -F @sveltesentio/observability add @sentry/svelte@^9 @sentry/sveltekit@^9
pnpm -F @sveltesentio/observability add -D @sentry/cli@^2
```

Pin major version; `@sentry/sveltekit` follows SvelteKit-major
compatibility (currently SvelteKit 2.x).

## Server-side bootstrap

```ts
// src/hooks.server.ts
import * as Sentry from '@sentry/sveltekit';
import { sequence } from '@sveltejs/kit/hooks';
import { env } from '$env/dynamic/private';

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.DEPLOYMENT_ENV,
  release: env.SENTRY_RELEASE,
  tracesSampleRate: 0,
  profilesSampleRate: 0,
  beforeSend(event, hint) {
    return scrubPii(event);
  },
});

export const handle = sequence(
  Sentry.sentryHandle(),
  yourOtherHandle,
);

export const handleError = Sentry.handleErrorWithSentry();
```

Five server invariants:

- **`tracesSampleRate: 0` + `profilesSampleRate: 0`** — OTel owns
  tracing per [observability.md](observability.md). Letting Sentry
  sample 10% of traces creates two non-correlated tracing systems with
  different sampling decisions. Explicit zero.
- **`beforeSend` PII scrub** — Sentry client SDK auto-captures
  `request.cookies`, `request.headers`, `user.email`; the scrubber is
  the second wall after server-side `safeAttrs` from [observability.md](observability.md).
- **`release: env.SENTRY_RELEASE`** — set in CI to the release-please
  tag from [monorepo-releases.md](monorepo-releases.md); regression
  detection requires it.
- **`environment` enum** — `production` / `staging` / `preview-{n}` /
  `development`; never free-form strings.
- **`Sentry.sentryHandle()` first in `sequence`** — captures errors
  thrown by downstream handlers; placing it last misses upstream errors.

## Client-side bootstrap

```ts
// src/hooks.client.ts
import * as Sentry from '@sentry/sveltekit';
import { env as publicEnv } from '$env/dynamic/public';

Sentry.init({
  dsn: publicEnv.PUBLIC_SENTRY_DSN,
  environment: publicEnv.PUBLIC_DEPLOYMENT_ENV,
  release: publicEnv.PUBLIC_SENTRY_RELEASE,
  tracesSampleRate: 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0.1,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
      networkDetailAllowUrls: [],
    }),
  ],
  beforeSend(event) {
    return clientScrubPii(event);
  },
});

export const handleError = Sentry.handleErrorWithSentry();
```

Five client invariants:

- **`PUBLIC_SENTRY_DSN`** — DSN is bearer-equivalent for sending
  events to your project; rotate on suspected leak. The DSN does **not**
  grant read access (unlike a Sentry API token), but it does allow
  event spam.
- **Session-replay defaults are aggressive** — `maskAllText: true` +
  `blockAllMedia: true` + empty `networkDetailAllowUrls` is the
  privacy-first baseline. Allow-listing must be deliberate per
  [principles.md §2.2](../principles.md).
- **`replaysOnErrorSampleRate: 0.1`** — capture replay for 10% of
  sessions that hit an error; full replay sampling (`replaysSessionSampleRate
  > 0`) explodes storage cost.
- **`replaysSessionSampleRate: 0` for cookie-banner respect** — opt-in
  flow turns it on after consent per
  [cookies-authoritative.md](cookies-authoritative.md) consent column.
- **`tracesSampleRate: 0`** on client too — same OTel-owns-tracing
  rule.

## Vite plugin — sourcemap upload

```ts
// vite.config.ts
import { sentrySvelteKit } from '@sentry/sveltekit/vite';

export default defineConfig({
  plugins: [
    sentrySvelteKit({
      sourceMapsUploadOptions: {
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        telemetry: false,
      },
      autoInstrument: false,
    }),
    sveltekit(),
  ],
});
```

Three sourcemap rules:

- **`autoInstrument: false`** — Sentry's auto-instrumentation conflicts
  with OTel; disable.
- **`telemetry: false`** — opt out of Sentry's own product telemetry on
  your CI run.
- **CI-only `SENTRY_AUTH_TOKEN`** — the upload-only token (not the
  full org token); scoped to project + sourcemap-write only. Never
  commit; never expose to client bundles.

## Manual capture pattern

```ts
// src/lib/errors/capture.ts
import * as Sentry from '@sentry/sveltekit';
import type { ProblemError } from '$lib/errors/problem';

export function captureProblem(err: ProblemError, correlationId: string): void {
  Sentry.captureException(err, {
    tags: {
      'problem.type': err.type,
      'problem.status': String(err.status),
    },
    contexts: {
      problem: {
        type: err.type,
        title: err.title,
        status: err.status,
      },
    },
    extra: {
      correlationId,
    },
    fingerprint: ['{{ default }}', err.type],
  });
}
```

Four capture rules:

- **`tags` are bounded cardinality, indexed for filter** — `problem.type`
  enum yes, `userId` no.
- **`contexts.problem` for structured detail** — Sentry UI renders
  contexts as collapsible sections.
- **`extra.correlationId`** — UUIDv7 from
  [observability.md](observability.md); join key for cross-tool
  navigation.
- **`fingerprint: ['{{ default }}', err.type]`** — augments default
  stack-based grouping with the `problem.type` URI; "404 not found from
  /api/orders" stays distinct from "404 not found from /api/customers"
  even if stack converges.

## Cross-tool join — `correlation.id`

```ts
// inside a span context
import * as Sentry from '@sentry/sveltekit';
import { trace } from '@opentelemetry/api';

const span = trace.getActiveSpan();
const ctx = span?.spanContext();

Sentry.setContext('otel', {
  trace_id: ctx?.traceId,
  span_id: ctx?.spanId,
  correlation_id: locals.correlationId,
});
```

Set OTel trace IDs on the Sentry event so the issue page deep-links
into Tempo/Grafana. The reverse direction (clicking from a Tempo span
to a Sentry issue) requires emitting `sentry.event.id` as a span
attribute — opt-in, not default; only set on errors.

## Source-of-truth roles

```text
What broke?                       → Sentry/GlitchTip/Highlight (issue with stack + count + impact)
When did it start?                → Error tracker (first-seen, regression vs prior release)
What was the user doing?          → Error tracker (breadcrumbs, session replay)
What was the system doing?        → OTel traces (full request span tree)
What does the system normally do? → OTel metrics (RED/USE dashboards)
What did this specific request do? → OTel logs joined by correlation.id
Did the AI tool-call mis-execute? → AI audit sink per ai-audit-hook.md
```

The error tracker is **never** the compliance store and **never** the
metrics store. Don't push business-event counts to Sentry as tags;
don't query Sentry for "how many requests at p99". Right tool, right
job.

## Self-host operations (GlitchTip example)

```yaml
# docker-compose.yml
services:
  glitchtip-web:
    image: glitchtip/glitchtip:latest
    environment:
      DATABASE_URL: postgres://glitchtip:secret@postgres/glitchtip
      SECRET_KEY: ${GLITCHTIP_SECRET_KEY}
      DEFAULT_FROM_EMAIL: errors@example.com
      EMAIL_URL: smtp://smtp.example.com:587
    ports: ['8000:8000']
  glitchtip-worker:
    image: glitchtip/glitchtip:latest
    command: ./bin/run-celery-with-beat.sh
    environment: { /* same as web */ }
```

Three self-host rules:

- **Postgres + Redis + S3-compatible blob store** are the dependency
  set for any Sentry-family tracker; budget the ops accordingly.
- **Retention on the DB** — 30/60/90 days per issue impact; without
  cleanup, the DB grows unboundedly.
- **DSN points at your domain** — `https://abc@errors.example.com/1`
  style; avoid same-origin as the app (cookie-scope leakage) but keep
  it on a controlled subdomain (CSP `connect-src` allowance for the
  client SDK).

## Anti-patterns

- **Letting Sentry sample traces** (`tracesSampleRate > 0`) when OTel
  is the trace source-of-truth — two non-correlated tracing systems.
- **No `release` set** — regression detection silently disabled; every
  error looks like a "new issue" forever.
- **No `beforeSend` PII scrub** — Sentry auto-captures cookies, query
  params, request bodies; defaults leak.
- **Auto-instrumentation on** alongside OTel auto-instrumentation —
  duplicate spans, conflicting trace contexts.
- **Session replay sampling 100%** — storage cost explodes; 10% on
  errors is the sustainable default.
- **`maskAllText: false`** without explicit privacy review — replay
  captures every keystroke, every form value, every OTP.
- **Same DSN across environments** — production noise drowns staging
  signal; different DSNs / projects per env.
- **Committing `SENTRY_AUTH_TOKEN` in `.env.example`** — token grants
  sourcemap-write; rotate immediately on leak.
- **Querying Sentry for product metrics** — wrong tool; query OTel
  metrics or a real BI store.
- **Ignoring AI audit and only sending to Sentry** — operational
  signal yes, compliance signal no; AI events go to both.
- **Sentry as the on-call pager** — Sentry can page, but SLO breaches
  belong on metrics (OTel) not error counts; use both with distinct
  routing.
- **`captureException(new Error(string))` for non-error events** —
  pollutes the error tracker with non-actionable noise; use breadcrumbs
  or a metric.
- **Capturing the same error in both `handleError` and a `try/catch`**
  — duplicate issues with the same fingerprint pollute counts.
- **Breadcrumbs containing PII** — breadcrumbs are visible on every
  issue; raw fetch URLs with query params, raw body content, full
  user-agent strings all leak.
- **Filtering errors with `beforeSend` returning `null` based on user
  ID** — silently drops errors for "internal users" and you stop seeing
  bugs that only happen for them.
- **No fingerprint customisation for RFC 9457 problems** — distinct
  `problem.type` URIs collapse into one issue when stacks converge.
- **Trying to use Sentry replay as user analytics** — replay is for
  bug repro; analytics is a separate tool.
- **Self-host without retention policy** — DB grows unboundedly;
  query performance degrades; cleanup is operational not optional.
- **Self-host on the same Postgres as the app** — error-tracker
  workload poisons app DB during error storms.

## References

- [Sentry — SvelteKit SDK](https://docs.sentry.io/platforms/javascript/guides/sveltekit/)
- [GlitchTip docs](https://glitchtip.com/documentation)
- [Highlight — Self-host guide](https://www.highlight.io/docs/general/company/open-source/self-host-hobby)
- [Sentry — `beforeSend`](https://docs.sentry.io/platforms/javascript/configuration/filtering/#using-beforesend)
- [Sentry — Session Replay privacy](https://docs.sentry.io/platforms/javascript/session-replay/privacy/)
- [Sentry BSL 1.1 license](https://github.com/getsentry/sentry/blob/master/LICENSE.md)
- [OpenTelemetry — Tracing model](https://opentelemetry.io/docs/concepts/signals/traces/)
