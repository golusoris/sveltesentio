# OpenTelemetry Logs — structured-log emission with trace correlation

[observability.md](observability.md) covers traces and metrics via the
stable `@opentelemetry/api` surface. Logs sat behind a development
gate until late 2025 because the Node Logs API (`@opentelemetry/api-logs`)
landed Stability: 2 only after Node 22 LTS hardening; until then the
recipe used a structured-JSON `log()` helper threading `traceId` +
`spanId` + `correlationId` manually.

This recipe documents the upgrade path from that interim helper to the
native OTel Logs API once your Node target is ≥22.11 — when to migrate,
how to wire the Logs SDK alongside traces and metrics, the
SeverityNumber + body-vs-attribute split that distinguishes logs from
events, and the bounded-attribute discipline that carries over from
spans.

## Related

- [observability.md](observability.md) — traces + metrics + correlation
  ID; this recipe extends with the Logs signal.
- [http-client.md](http-client.md) — RFC 9457 `ProblemError` mapping to
  log records via `severity_text: 'ERROR'`.
- [ai-audit-hook.md](ai-audit-hook.md) — AI audit emits to its own
  schema-typed sink; logs are the operational signal, not the
  compliance signal.
- [schemas.md](schemas.md) — Zod boundary on log-attribute shape (when
  attributes derived from external input).
- [clock-injection.md](clock-injection.md) — `clock.now()` for
  `observed_timestamp` so tests can assert deterministic emission
  order.
- [trusted-types.md](trusted-types.md) — CSP `report-to` violations
  flow through this recipe (browser → server → log emit).
- [principles.md §2.7](../principles.md) — observability tooling.
- [ADR-0023](../adr/0023-uuidv7-default.md) — UUIDv7 correlation IDs
  thread into the `correlation.id` log attribute.

## When to migrate from structured `log()` to OTel Logs API

```text
Node target ≥ 22.11 LTS, OTel collector ≥ 0.110, devops owns retention → migrate (recommended)
Node target < 22.11                                                     → keep structured-JSON helper from observability.md
Browser logs (Web Vitals, console errors)                               → keep custom helper (Logs API browser SDK still experimental)
AI audit, security audit, compliance retention                          → keep separate sink per ai-audit-hook.md (logs are not the compliance store)
Apps already on Pino/Winston with no migration appetite                 → bridge via @opentelemetry/instrumentation-pino (no rewrite required)
```

The native API is worth the migration when the operational story shifts
from "grep logs in Loki" to "correlate logs with spans in Tempo without
manual `traceId` lookups". Stay on the helper if you're not yet
operating on traces — logs without spans is the same observability
posture either way.

## Install

```bash
pnpm -F @sveltesentio/observability add \
  @opentelemetry/api@^1.9 \
  @opentelemetry/api-logs@^0.55 \
  @opentelemetry/sdk-logs@^0.55 \
  @opentelemetry/exporter-logs-otlp-http@^0.55 \
  @opentelemetry/instrumentation-pino@^0.45
```

The Logs SDK version pins to the same `0.55+` pre-1.0 line as the
metrics SDK; expect a 1.0 cut in 2026 once the Logs Bridge API
stabilises.

## Bootstrap — Node server SDK

```ts
// src/lib/observability/logs.ts
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { env } from '$env/dynamic/private';

const provider = new LoggerProvider({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME ?? 'sveltesentio-app',
    [ATTR_SERVICE_VERSION]: env.OTEL_SERVICE_VERSION ?? '0.0.0',
    'deployment.environment': env.DEPLOYMENT_ENV ?? 'development',
  }),
  processors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ?? 'http://localhost:4318/v1/logs',
      }),
      {
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 5000,
      },
    ),
  ],
});

logs.setGlobalLoggerProvider(provider);

export const logger = logs.getLogger('sveltesentio', '0.1.0');
```

Three bootstrap rules:

- **Single `LoggerProvider` per process** — `logs.setGlobalLoggerProvider`
  is idempotent-but-overwrites; calling it twice replaces the previous
  provider and orphans queued records.
- **`BatchLogRecordProcessor` not `SimpleLogRecordProcessor`** — Simple
  emits per-record (zero batching, kills throughput on Node servers);
  Simple is for tests only.
- **Bootstrap once at module-load, not per-request** — instantiating
  the provider in `hooks.server.ts` body re-creates it on every HMR; put
  it in a top-level module side-effect import.

## Emission shape

```ts
// src/routes/api/orders/+server.ts
import { logger } from '$lib/observability/logs';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { trace } from '@opentelemetry/api';

export const POST: RequestHandler = async ({ request, locals }) => {
  const correlationId = locals.correlationId;
  const tier = locals.session?.tier ?? 'anonymous';

  logger.emit({
    severityNumber: SeverityNumber.INFO,
    severityText: 'INFO',
    body: 'order placed',
    attributes: {
      'correlation.id': correlationId,
      'order.tier': tier,
      'order.payment_method': order.paymentMethod,
    },
  });

  return json({ ok: true });
};
```

Five emission rules:

- **`severityNumber` over `severityText`** — `SeverityNumber.INFO` is
  the machine-readable signal; `severityText` is a free-form string for
  humans. Always emit both; backends index on number.
- **`body` is the human-readable message** — keep it stable across
  emissions ("order placed" not "order 1234 placed for $99 by user
  alice"). Variable values go in `attributes`. Backends group log
  records by `body` for "top messages" dashboards.
- **`attributes` are bounded cardinality** — same rule as
  [observability.md](observability.md) span attributes: `tier` enum yes,
  `userId` no, raw URL no, `route.template` yes.
- **Active-span auto-correlation** — when an active span is on the
  context, `traceId` + `spanId` are auto-attached to the log record;
  no manual threading needed (this is the headline win over the
  structured helper).
- **Never log secrets, tokens, raw bodies, free-form prompts** —
  inherits the PII boundary from
  [observability.md](observability.md) `safeAttrs`.

## Severity guidance

```text
SeverityNumber.TRACE  (1)  → per-iteration loop noise — almost never; turn off in prod
SeverityNumber.DEBUG  (5)  → request lifecycle in dev, gated by env DEBUG flag in prod
SeverityNumber.INFO   (9)  → state transitions worth retaining (auth events, orders placed)
SeverityNumber.WARN   (13) → recoverable failures (retry succeeded, fallback engaged)
SeverityNumber.ERROR  (17) → unrecoverable for the request (RFC 9457 ProblemError emit)
SeverityNumber.FATAL  (21) → process-terminating (db pool exhausted, OOM imminent) — pages oncall
```

Two-bucket grouping for retention: TRACE/DEBUG ephemeral (24h); INFO+
durable (30d minimum, 1y for auth/billing routes per
[principles.md §2.2](../principles.md)).

## Pino bridge — incremental migration

```ts
// src/lib/observability/instrumentation.ts
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';

registerInstrumentations({
  instrumentations: [
    new PinoInstrumentation({
      logHook: (_span, record) => {
        record['service.name'] = 'sveltesentio-app';
      },
      disableLogSending: false,
    }),
  ],
});
```

For codebases already on Pino, the bridge auto-emits Pino records
through the OTel Logs SDK while preserving the Pino API at every call
site. Three rules: (a) `disableLogSending: false` to actually export
(default is `true` — instrumentation only injects `traceId` otherwise),
(b) keep emitting Pino in old code, OTel `logger.emit` in new code; the
bridge merges both into the same exporter, (c) audit `logHook` for any
attribute that re-introduces high cardinality from Pino's child-logger
context.

## RFC 9457 ProblemError emission

```ts
// src/lib/observability/errors.ts
import { logger } from './logs';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { ProblemError } from '$lib/errors/problem';
import { trace, SpanStatusCode } from '@opentelemetry/api';

export function logProblem(err: ProblemError, correlationId: string): void {
  const span = trace.getActiveSpan();
  span?.setStatus({ code: SpanStatusCode.ERROR, message: err.title });
  span?.recordException(err);

  logger.emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: 'ERROR',
    body: err.title,
    attributes: {
      'correlation.id': correlationId,
      'problem.type': err.type,
      'problem.status': err.status,
      'http.route': span?.spanContext().traceId ? undefined : 'unknown',
    },
  });
}
```

The log record carries the problem `type` URI for grep/dashboard
filters; the span carries the exception for trace UIs. Both reference
the same `correlation.id`.

## CSP report-to ingestion

```ts
// src/routes/api/csp-report/+server.ts
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { logger } from '$lib/observability/logs';
import { SeverityNumber } from '@opentelemetry/api-logs';

const Report = z.object({
  age: z.number().optional(),
  type: z.string(),
  url: z.string(),
  body: z.object({
    documentURL: z.string().optional(),
    referrer: z.string().optional(),
    blockedURL: z.string().optional(),
    effectiveDirective: z.string().optional(),
    originalPolicy: z.string().optional(),
    sourceFile: z.string().optional(),
    sample: z.string().optional(),
    disposition: z.enum(['report', 'enforce']).optional(),
    statusCode: z.number().optional(),
  }),
});

export const POST: RequestHandler = async ({ request, locals }) => {
  const reports = z.array(Report).safeParse(await request.json());
  if (!reports.success) return json({ ignored: true });

  for (const r of reports.data) {
    logger.emit({
      severityNumber: SeverityNumber.WARN,
      severityText: 'WARN',
      body: 'csp violation',
      attributes: {
        'correlation.id': locals.correlationId,
        'csp.directive': r.body.effectiveDirective ?? 'unknown',
        'csp.disposition': r.body.disposition ?? 'enforce',
        'csp.blocked_url_host': hostnameOnly(r.body.blockedURL),
      },
    });
  }
  return json({ ok: true });
};
```

Per [trusted-types.md](trusted-types.md): CSP report endpoint zod-parses
browser-supplied reports (untrusted boundary), strips `blockedURL` to
hostname-only (full URL leaks user context), emits as `WARN` (not
`ERROR` — Report-Only ramps generate noise that would page oncall).

## Sampling + retention

Logs SDK does not have a built-in sampler the way traces do; volume
control is via:

- **Severity gates** — `LoggerProvider` accepts a custom processor
  filtering by `SeverityNumber`; gate TRACE/DEBUG below env-configured
  threshold before they enter the export queue.
- **Tail-sampling at the collector** — drop INFO records whose
  associated trace was sampled out; keep ERROR + FATAL unconditionally.
- **Per-route rate limits** — wrap `logger.emit` in a per-route token
  bucket for hot loops (e.g. middleware emitting per-request DEBUG);
  bucket capacity 100/s is a safe default.

## Testing

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { LoggerProvider, InMemoryLogRecordExporter, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';

let exporter: InMemoryLogRecordExporter;

beforeEach(() => {
  exporter = new InMemoryLogRecordExporter();
  const provider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor(exporter)],
  });
  logs.setGlobalLoggerProvider(provider);
});

describe('order log emission', () => {
  it('emits INFO with bounded attributes', async () => {
    await placeOrder({ tier: 'pro', paymentMethod: 'card' });
    const records = exporter.getFinishedLogRecords();
    expect(records).toHaveLength(1);
    expect(records[0].severityNumber).toBe(SeverityNumber.INFO);
    expect(records[0].attributes).toMatchObject({
      'order.tier': 'pro',
      'order.payment_method': 'card',
    });
    expect(records[0].attributes).not.toHaveProperty('user.email');
  });
});
```

`SimpleLogRecordProcessor` + `InMemoryLogRecordExporter` is the test
seam (mirrors `InMemorySpanExporter` from [observability.md](observability.md));
production stays on `BatchLogRecordProcessor`.

## Migration recipe — structured helper → Logs API

```ts
// before — observability.md interim helper
log({ level: 'info', message: 'order placed', traceId, spanId, correlationId, tier });

// after — native Logs API
logger.emit({
  severityNumber: SeverityNumber.INFO,
  body: 'order placed',
  attributes: { 'correlation.id': correlationId, 'order.tier': tier },
});
```

Two-PR migration: PR1 wires `LoggerProvider` + adds OTel `logger.emit`
alongside the existing helper (both emit to the same backend, no
behavioural change); PR2 deletes the helper after a sprint of
co-existence + dashboard validation. Don't try to migrate every
call-site in one PR — the trace-correlation behavioural change is
worth observing in isolation.

## Anti-patterns

- **`SimpleLogRecordProcessor` in production** — kills throughput; tests
  only.
- **Multiple `LoggerProvider` instances** — second `setGlobalLoggerProvider`
  overwrites the first; orphans queued records and silently drops them.
- **High-cardinality attributes** (`user.id`, raw `url`, free-form
  prompts) — explodes backend index; same rule as span attributes.
- **`body` containing variable values** — defeats backend grouping;
  variables go in attributes, body stays stable.
- **Logging secrets, tokens, raw request bodies** — inherits PII
  boundary from [observability.md](observability.md).
- **Manual `traceId` threading after migration** — the SDK auto-attaches
  from active span context; manual attach drifts from span when
  detached spans escape the request scope.
- **Browser-side OTel Logs SDK in production** — Web Logs SDK is still
  experimental as of 2026-04; keep browser logs on the structured
  console helper from [observability.md](observability.md) until 1.0.
- **Logs as compliance sink** — AI audit, security audit, billing audit
  go through their schema-typed sinks per [ai-audit-hook.md](ai-audit-hook.md);
  logs are operational, not compliance.
- **Pino + OTel both emitting same record** — bridge is exclusive: when
  bridge is on, Pino records flow through OTel exporter; don't
  double-export by also configuring Pino to write to file/stdout that
  another agent ships separately.
- **Emitting from synchronous hot loops without rate limit** —
  `BatchLogRecordProcessor` queues, but a hot loop can fill the queue
  before next flush; rate-limit per-route.
- **Severity inflation** (everything `ERROR` "to be safe") — defeats
  alerting; use ERROR only for unrecoverable, WARN for fallback-engaged.
- **`severityText` without `severityNumber`** — backends index on
  number; text-only emissions lose ordering.
- **Disabling `disableLogSending: false` on Pino bridge** — bridge
  silently injects traceId without exporting; logs disappear.
- **Logging RFC 9457 problem `detail` verbatim** — `detail` may include
  user-supplied input (e.g. validation error echoing request); strip
  before emit.

## References

- [OpenTelemetry — Logs API JS](https://opentelemetry.io/docs/languages/js/instrumentation/#logs)
- [OTel Logs Bridge API spec](https://opentelemetry.io/docs/specs/otel/logs/bridge-api/)
- [`@opentelemetry/api-logs` README](https://www.npmjs.com/package/@opentelemetry/api-logs)
- [`@opentelemetry/instrumentation-pino`](https://www.npmjs.com/package/@opentelemetry/instrumentation-pino)
- [OTel Severity Number spec](https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber)
- [Reporting API (CSP report-to)](https://www.w3.org/TR/reporting-1/)
