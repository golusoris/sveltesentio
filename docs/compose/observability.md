# Observability — OpenTelemetry SDK + RFC 9457 correlation

Sveltesentio's observability story is **OpenTelemetry as the wire
format**, **UUIDv7 as the join key**, and **RFC 9457 problems as the
error envelope** — three contracts that let traces, logs, metrics,
and frontend events reconstruct a single user action across the
stack.

This recipe documents:

- Server-side OTel SDK wiring inside SvelteKit `+server.ts` / hooks.
- Browser-side OTel SDK + the smaller-bundle alternatives.
- UUIDv7 correlation per [ADR-0023](../adr/0023-uuid-v7-default.md)
  threaded through traces / RFC 9457 / logs / metrics.
- Auto-instrumentation vs. manual spans.
- PII boundary controls.
- A reference Grafana / Tempo / Loki stack.

Related: [http-client.md](http-client.md) (RFC 9457 errors with
correlation IDs), [ai-audit-hook.md](ai-audit-hook.md) (OTel as one
audit sink), [colocated-ipc.md](colocated-ipc.md) (server-side
trace context propagation), [clock-injection.md](clock-injection.md)
(deterministic test timestamps).

## Three contracts

| Contract | What | Where |
|---|---|---|
| OpenTelemetry | Wire format for traces / metrics / logs | `@opentelemetry/*` |
| UUIDv7 | Join key across systems | `@sveltesentio/core/id` per ADR-0023 |
| RFC 9457 | Error envelope with `extensions.correlationId` | `@sveltesentio/core/errors` per [http-client.md](http-client.md) |

These are the **only** observability primitives sveltesentio
endorses. App-specific dashboards, alerting, log retention are
consumer policy.

## Install (server)

```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http
```

`@opentelemetry/api` is the only dependency app code should
import — never the SDK directly. SDK config lives in one bootstrap
file.

## Install (browser)

```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-trace-web \
  @opentelemetry/instrumentation-fetch \
  @opentelemetry/instrumentation-document-load \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/context-zone
```

Browser OTel adds ~30-60 KB. For bundle-sensitive apps, use the
manual-span subset (api + exporter only, ~12 KB) and skip
auto-instrumentation.

## Server bootstrap

```ts
// src/lib/otel.server.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { env } from '$env/dynamic/private';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'sveltesentio-app',
    [ATTR_SERVICE_VERSION]: env.APP_VERSION ?? 'dev',
    'deployment.environment': env.DEPLOY_ENV ?? 'dev',
  }),
  traceExporter: new OTLPTraceExporter({
    url: env.OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/traces',
    headers: { authorization: env.OTEL_AUTH ?? '' },
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: env.OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/metrics',
    }),
  }),
  instrumentations: [getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false },         // noisy
    '@opentelemetry/instrumentation-http': { enabled: true },
    '@opentelemetry/instrumentation-pg': { enabled: true },
  })],
});

sdk.start();

process.on('SIGTERM', () => { void sdk.shutdown(); });
```

Loaded via `--require ./otel-bootstrap.cjs` or the SvelteKit `hooks.server.ts`
top-level import — must execute **before** any instrumented module
is imported. Auto-instrumentation works by monkey-patching at
require/import time.

## Browser bootstrap

```ts
// src/lib/otel.client.ts
import { browser } from '$app/environment';
import { trace, context } from '@opentelemetry/api';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

if (browser) {
  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'sveltesentio-app-web',
      'browser.user_agent': navigator.userAgent,
    }),
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({
        url: '/api/otel/v1/traces',                                  // proxy to collector
      }), { maxExportBatchSize: 50, scheduledDelayMillis: 5000 }),
    ],
  });

  provider.register({ contextManager: new ZoneContextManager() });

  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: [/^\/api\//],
        clearTimingResources: true,
      }),
      new DocumentLoadInstrumentation(),
    ],
  });
}
```

Two browser-side invariants:

1. **Proxy collector traffic through your origin** (`/api/otel/...`).
   Direct browser → OTLP-HTTP exposes collector URL + (often) auth
   headers; same-origin proxy keeps both server-side.
2. **`propagateTraceHeaderCorsUrls`** must allow your API origin
   pattern. Otherwise the `traceparent` header isn't set, breaking
   front-to-back correlation.

## UUIDv7 correlation thread

```ts
// @sveltesentio/core/id
import { uuidv7 } from 'uuidv7';
export { uuidv7 };
```

Per ADR-0023, every cross-system join key is a UUIDv7 (time-sortable,
collision-resistant, opaque). Threading:

```ts
// src/hooks.server.ts
import { trace, context } from '@opentelemetry/api';
import { uuidv7 } from '@sveltesentio/core/id';

export const handle: Handle = async ({ event, resolve }) => {
  const correlationId = event.request.headers.get('x-correlation-id') ?? uuidv7();
  event.locals.correlationId = correlationId;

  const span = trace.getActiveSpan();
  span?.setAttribute('correlation.id', correlationId);

  const response = await resolve(event);
  response.headers.set('x-correlation-id', correlationId);
  return response;
};
```

Three properties:

- **Inbound trust:** if upstream provides `x-correlation-id`, reuse it
  (multi-hop trace). Otherwise mint.
- **Span attribute:** `correlation.id` joins the OTel trace to RFC 9457
  problems + audit logs + frontend telemetry.
- **Echo on response:** browser sees the ID and includes it in
  problem-error displays + bug reports.

## RFC 9457 problem-extension

Per [http-client.md](http-client.md), problem responses carry
`extensions.correlationId`:

```ts
// @sveltesentio/core/errors
export function problem(opts: {
  type: string; title: string; status: number;
  detail?: string; correlationId: string;
}): Response {
  return new Response(JSON.stringify({
    type: opts.type, title: opts.title, status: opts.status,
    detail: opts.detail,
    extensions: { correlationId: opts.correlationId },
  }), {
    status: opts.status,
    headers: {
      'Content-Type': 'application/problem+json',
      'X-Correlation-Id': opts.correlationId,
    },
  });
}
```

Client error display surfaces the ID — users paste it into bug
reports; ops greps Tempo / Jaeger by it; audit log filters by it.
**One ID, four systems, zero ambiguity.**

## Manual spans

Auto-instrumentation covers the obvious cases (HTTP, fetch, postgres,
document load). Hand-write spans for business operations:

```ts
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('orders');

export async function placeOrder(input: OrderInput, correlationId: string) {
  return tracer.startActiveSpan('orders.place', async (span) => {
    span.setAttribute('order.amount_cents', input.amountCents);
    span.setAttribute('correlation.id', correlationId);

    try {
      const order = await db.transaction(async (tx) => { /* … */ });
      span.setStatus({ code: SpanStatusCode.OK });
      return order;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

Three rules:

- **Use semantic-convention attributes** (`http.*`, `db.*`, `messaging.*`)
  — not free-form keys. Backends index by convention.
- **Always `span.end()` in `finally`.** Forgotten ends pile up in
  the BatchSpanProcessor queue.
- **`recordException` + `setStatus`** so error spans stand out in
  the UI.

## Metrics

```ts
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('orders');
const orderCounter = meter.createCounter('orders.placed', {
  description: 'Successfully placed orders',
  unit: '1',
});
const orderLatency = meter.createHistogram('orders.place.duration', {
  description: 'Time to place an order',
  unit: 'ms',
});

const t0 = performance.now();
await placeOrder(input, cid);
orderCounter.add(1, { tier: input.tier });
orderLatency.record(performance.now() - t0, { tier: input.tier });
```

Cardinality discipline: **never put user IDs / request IDs / free-form
strings into attribute values.** Attributes become metric dimensions;
high cardinality blows up the backend cost. Use bounded enums (tier,
region, status code).

## Logs (server)

OTel logs are stable but adoption is mid. Pragmatic stack today:

```ts
// structured JSON to stdout; promtail / vector forwards to Loki / OTel collector
import { uuidv7 } from '@sveltesentio/core/id';

export function log(event: string, attrs: Record<string, unknown>) {
  const span = trace.getActiveSpan();
  console.log(JSON.stringify({
    event,
    ts: new Date().toISOString(),
    correlationId: attrs.correlationId,
    traceId: span?.spanContext().traceId,
    spanId: span?.spanContext().spanId,
    ...attrs,
  }));
}
```

Loki / Vector / Fluent Bit reads stdout JSON; the trace IDs link
log → trace in Grafana. When `@opentelemetry/api-logs` is stable
on Node ≥22 LTS, migrate.

`console.warn` / `console.error` only per CLAUDE.md "Don't" list —
this `log()` helper is the structured path.

## SvelteKit-specific patterns

### `+server.ts` route span

```ts
// +server.ts
import { trace } from '@opentelemetry/api';

export const POST: RequestHandler = async ({ request, locals }) => {
  const tracer = trace.getTracer('api');
  return tracer.startActiveSpan('POST /api/feed', async (span) => {
    span.setAttribute('correlation.id', locals.correlationId);
    try {
      const body = await request.json();
      const out = await createFeedItem(body, locals.correlationId);
      return new Response(JSON.stringify(out), { status: 201 });
    } finally {
      span.end();
    }
  });
};
```

Auto-instrumentation covers the wrapping HTTP server span; this
adds the **business** span underneath.

### `load` function instrumentation

```ts
// +page.server.ts
export const load: PageServerLoad = async (event) => {
  return trace.getTracer('load').startActiveSpan('load /(app)/feed', async (span) => {
    span.setAttribute('correlation.id', event.locals.correlationId);
    try {
      return { items: await db.feed.list() };
    } finally {
      span.end();
    }
  });
};
```

`load` running both server-side (SSR) and client-side (navigation)
means spans appear in **both** trace contexts. Browser navigation is
the most common N+1 bug source.

### Client-side custom event

```ts
import { trace } from '@opentelemetry/api';

export function track(event: string, attrs: Record<string, string | number | boolean>) {
  const tracer = trace.getTracer('ui');
  const span = tracer.startSpan(`ui.${event}`, { attributes: attrs });
  span.end();
}

// usage
track('cta.cta_signup_click', { variant: 'A' });
```

Frontend events as zero-duration spans is a budget-friendly
alternative to a parallel analytics pipeline. Same correlation
ID, same trace tree.

## PII boundary

OTel attributes ship to a third party (collector → backend). PII
budget per attribute set:

| Allowed | Banned |
|---|---|
| User tier (enum) | Email |
| Request method | Raw request body |
| Status code | API tokens / cookies |
| Correlation ID (opaque) | User name |
| Hashed user ID (per-tenant salt) | IP address (unless legal basis documented) |
| Span event name | Free-form prompts (use [ai-audit-hook.md](ai-audit-hook.md)) |

Sanitiser:

```ts
function safeAttrs(raw: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (BANNED_KEYS.has(k)) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}
```

ESLint rule (custom) can flag `span.setAttribute('email', ...)` at
build time. Worth the investment if your codebase has >5 OTel call
sites.

## Sampling

Don't ship 100% of traces in production. Default OTel head sampling:

```ts
import { TraceIdRatioBasedSampler, ParentBasedSampler } from '@opentelemetry/sdk-trace-base';

new NodeSDK({
  // …
  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(0.1),     // 10% of new traces
  }),
});
```

`ParentBasedSampler` ensures child spans inherit the parent's
decision — partial traces (some spans dropped) make Tempo /
Jaeger views misleading.

For error traces, add a tail-sampling collector tier that keeps 100%
of traces with status != OK. Head sampling alone loses the bugs.

## Reference stack

| Component | Tool | Why |
|---|---|---|
| Trace backend | Tempo | OSS, Grafana-native, scales to billions of spans |
| Metrics backend | Prometheus / Mimir | OTLP receiver supported; OSS |
| Logs backend | Loki | Same query language family; ID-joins to traces |
| UI | Grafana | Single pane; explore / dashboards / alerting |
| Collector | OpenTelemetry Collector | Tail-sampling, redaction, batching |

Self-host or hosted (Grafana Cloud / Honeycomb / Lightstep / Datadog).
Don't use a vendor-lock SDK; OTel keeps you portable.

## Testing

Unit tests:

```ts
import { trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
trace.setGlobalTracerProvider(provider);

test('placeOrder emits a span with correlation id', async () => {
  await placeOrder(validInput, 'cid-1');
  const spans = exporter.getFinishedSpans();
  const order = spans.find((s) => s.name === 'orders.place');
  expect(order?.attributes['correlation.id']).toBe('cid-1');
  expect(order?.status.code).toBe(SpanStatusCode.OK);
});
```

Pair with [clock-injection.md](clock-injection.md) for deterministic
span timestamps.

## Anti-patterns

- **Free-form attribute keys.** Use semantic conventions — backends
  index by them.
- **High-cardinality attributes** (user IDs, request IDs as metric
  dimensions). Blows up backend cost. Bounded enums only.
- **PII in spans.** Collector ships to a third party. Hash, drop,
  or use [ai-audit-hook.md](ai-audit-hook.md)'s redaction pipeline.
- **No `span.end()` in `finally`.** Spans leak; queue grows; OOM in
  long-running processes.
- **Direct browser → OTLP collector.** Auth headers / collector URL
  exposed. Proxy through `/api/otel/*`.
- **No correlation ID on `+server.ts`.** Errors arrive in support
  inbox without a join key. Mint per request.
- **100% sampling in production.** Eats backend quota. Head-sample +
  tail-keep errors.
- **Auto-instrumentation in browser without `propagateTraceHeaderCorsUrls`.**
  Front-to-back trace breaks silently.
- **`@opentelemetry/sdk-*` imported in app code.** Only the bootstrap
  file imports the SDK; everything else uses `@opentelemetry/api`.
- **Logging via `console.log`.** Per CLAUDE.md, only `console.warn` /
  `console.error`. Use the structured `log()` helper.
- **OTel as the audit sink for compliance.** Per
  [ai-audit-hook.md](ai-audit-hook.md), OTel spans are not retention-
  grade. Use ClickHouse / Postgres for compliance.
- **Skipping the trace context in error responses.** RFC 9457 with
  `extensions.correlationId` is mandatory; otherwise users can't link
  bug reports to traces.

## References

- ADR-0023 — UUIDv7 correlation IDs default.
- [http-client.md](http-client.md) — RFC 9457 with
  `extensions.correlationId`.
- [ai-audit-hook.md](ai-audit-hook.md) — OTel as one of three audit
  sinks (observability, not compliance).
- [colocated-ipc.md](colocated-ipc.md) — server-side trace context.
- [clock-injection.md](clock-injection.md) — deterministic
  timestamps in tests.
- OpenTelemetry JS docs: <https://opentelemetry.io/docs/instrumentation/js/>.
- Semantic Conventions: <https://opentelemetry.io/docs/specs/semconv/>.
- RFC 9457: <https://datatracker.ietf.org/doc/html/rfc9457>.
