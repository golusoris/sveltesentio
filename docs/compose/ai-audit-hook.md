# AI audit hook — `onAudit` + `AiAuditEvent` Zod schema

`@sveltesentio/ai` ships a typed audit scaffold per
[ADR-0045](../adr/0045-ai-audit-hook-zod-schema.md). The framework emits
a structured `AiAuditEvent` at every prompt / response / error boundary;
consumers supply an `onAudit(event)` callback that decides retention.
**No default sink.** Sveltesentio refuses to invent a retention policy
because compliance classification is per-consumer (EU AI Act Art. 12,
high-risk system logging).

This recipe documents the event shape, the hook contract, how to wire
it into the server + client call sites, and three reference sinks
(OTel / ClickHouse / Postgres).

Related: [schemas.md](schemas.md) (Zod v4), [http-client.md](http-client.md)
(RFC 9457 error propagation), `docs/compliance/eu-ai-act.md`.

## Event shape

```ts
// @sveltesentio/ai/audit
import { z } from 'zod';

export const AiAuditEvent = z.object({
  timestamp: z.iso.datetime(),                // ISO 8601
  kind: z.enum(['prompt', 'response', 'error']),
  provider: z.string(),                       // 'anthropic' | 'ollama' | 'huggingface' | custom
  model: z.string(),                          // 'claude-opus-4-7' | 'llama-3.2-3b' | …
  correlationId: z.uuid(),                    // UUIDv7 per ADR-0023
  userId: z.string().optional(),              // consumer-supplied; optional for anon flows
  input: z.string().optional(),               // redacted by default
  output: z.string().optional(),              // redacted by default
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AiAuditEvent = z.infer<typeof AiAuditEvent>;
```

Three invariants:

1. **`correlationId` is the join key.** Trace-id across prompt →
   response → error. UUIDv7 means the key is time-sortable.
2. **Redaction is default.** `input` / `output` are `undefined` unless
   the consumer opts in. Compliance (right-to-erasure, PII minimization)
   demands this.
3. **No PII in `metadata` without Zod-typed fields.** Free-form record
   encourages drift; require a per-app Zod extension for anything
   sensitive.

## Wiring the hook

```ts
// src/app.d.ts
declare global {
  namespace App {
    interface Locals {
      ai: AiClient;
    }
  }
}

// src/hooks.server.ts
import { createAiClient } from '@sveltesentio/ai';
import { sequence } from '@sveltejs/kit/hooks';

const aiHandle = ({ event, resolve }) => {
  event.locals.ai = createAiClient({
    provider: 'anthropic',
    apiKey: env.ANTHROPIC_API_KEY,
    onAudit: async (e) => {
      // consumer sink — see below
      await auditSink.insert(e);
    },
  });
  return resolve(event);
};

export const handle = sequence(aiHandle, /* … */);
```

Client-side:

```ts
// src/lib/ai.client.ts
import { createAiClient } from '@sveltesentio/ai/client';

export const aiClient = createAiClient({
  endpoint: '/api/ai',         // server-proxied per ADR-0043
  onAudit: (e) => {
    // Client-side sinks must be cautious:
    // - don't ship input/output over the wire if server already logs
    // - keep metadata local (telemetry, not compliance)
    track('ai.event', { kind: e.kind, model: e.model, correlationId: e.correlationId });
  },
});
```

Server-side is authoritative. Client-side audit is for UX telemetry
(who used AI, when, how often), not compliance logging.

## `onAudit` contract

| Signature | `(event: AiAuditEvent) => void | Promise<void>` |
|---|---|
| Called | After each prompt / response / error |
| Sync on client | Fire-and-forget (non-blocking UI) |
| Async on server | `await`-able (blocking until sink confirms) |
| Errors in sink | Logged to stderr, don't throw — sink failure must not break user flow |
| Ordering | Best-effort; use `correlationId` to reconstruct sequence |

Implementation shape:

```ts
// @sveltesentio/ai/audit
export async function emit(event: AiAuditEvent, onAudit?: OnAudit) {
  if (!onAudit) return;
  try {
    const parsed = AiAuditEvent.parse(event);
    await onAudit(parsed);
  } catch (err) {
    console.error('[ai-audit] sink failed', { correlationId: event.correlationId, err });
  }
}
```

The Zod parse inside the emitter is deliberate — schema-invalid
events caught here (before reaching the sink). Consumer sinks trust
the schema.

## Redaction controls

Opt-in retention via `retain`:

```ts
const result = await event.locals.ai.complete({
  model: 'claude-opus-4-7',
  messages: [{ role: 'user', content: userMessage }],
  retain: {
    input: 'hash',             // 'none' | 'hash' | 'full'
    output: 'hash',
    reason: 'EU AI Act Art. 12 — high-risk system',
  },
});
```

| `retain` value | What the audit sees |
|---|---|
| `'none'` (default) | No `input` / `output` fields |
| `'hash'` | SHA-256 hex of the text — join key, no content |
| `'full'` | Raw text — requires documented lawful basis |

`reason` is required when `retain !== 'none'` — forces consumers to
document why. Sinks can alert on absence.

## Reference sinks

### OpenTelemetry

```ts
import { metrics, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('ai');
const counter = metrics.getMeter('ai').createCounter('ai.events');

export const otelSink: OnAudit = (event) => {
  counter.add(1, { kind: event.kind, provider: event.provider, model: event.model });

  if (event.kind === 'error') {
    tracer.startActiveSpan(`ai.${event.kind}`, (span) => {
      span.setAttribute('correlation.id', event.correlationId);
      span.setAttribute('ai.provider', event.provider);
      span.setAttribute('ai.model', event.model);
      span.setStatus({ code: 2 });
      span.end();
    });
  }
};
```

Good default for observability. Skips `input` / `output` — OTel spans
are not intended for compliance-grade retention.

### ClickHouse (compliance-grade)

```ts
import { createClient } from '@clickhouse/client';

const ch = createClient({ url: env.CLICKHOUSE_URL, database: 'compliance' });

export const clickhouseSink: OnAudit = async (event) => {
  await ch.insert({
    table: 'ai_audit_events',
    values: [{
      timestamp: event.timestamp,
      kind: event.kind,
      provider: event.provider,
      model: event.model,
      correlation_id: event.correlationId,
      user_id: event.userId ?? null,
      input_hash: event.input ?? null,     // store hashes, not plaintext
      output_hash: event.output ?? null,
      metadata: JSON.stringify(event.metadata ?? {}),
    }],
    format: 'JSONEachRow',
  });
};
```

Schema (ClickHouse):

```sql
CREATE TABLE ai_audit_events (
  timestamp       DateTime64(3),
  kind            Enum8('prompt'=1,'response'=2,'error'=3),
  provider        LowCardinality(String),
  model           LowCardinality(String),
  correlation_id  UUID,
  user_id         Nullable(String),
  input_hash      Nullable(String),
  output_hash     Nullable(String),
  metadata        String
) ENGINE = MergeTree
  PARTITION BY toYYYYMM(timestamp)
  ORDER BY (timestamp, correlation_id)
  TTL timestamp + INTERVAL 7 YEAR;
```

TTL is compliance-driven — EU AI Act suggests 6-month minimum; 7
years aligns with broader financial / audit retention. Adjust per
classification.

### PostgreSQL (low-volume / shared stack)

```ts
import { sql } from '$lib/db';

export const pgSink: OnAudit = async (event) => {
  await sql`
    insert into ai_audit_events
      (timestamp, kind, provider, model, correlation_id, user_id, input_hash, output_hash, metadata)
    values
      (${event.timestamp}, ${event.kind}, ${event.provider}, ${event.model},
       ${event.correlationId}, ${event.userId ?? null},
       ${event.input ?? null}, ${event.output ?? null}, ${event.metadata ?? {}})
  `;
};
```

Good for <100 events/s. Above that, ClickHouse / columnar store
amortizes better.

## Correlation across trace

The `correlationId` is the join key for:

- OTel traces (span attribute `correlation.id`).
- RFC 9457 problem responses (see [http-client.md](http-client.md)
  — `problem.extensions.correlationId`).
- Application logs (structured log field).
- Frontend telemetry (track event metadata).

This lets compliance auditors reconstruct: *"On 2026-04-17 14:23Z,
user X's prompt to claude-opus-4-7 produced error Y, visible in
trace Z."*

## Schema evolution

Breaking schema changes ripple into every sink. Process:

1. Add the new field as **optional** in the next minor.
2. Consumers update sinks.
3. Mark as required in the next minor (with 1-minor deprecation
   warning).
4. ADR amendment + migration note in `docs/migrations/`.

Never rename fields in-place. Add new + deprecate old.

## Handling sink failure

```ts
export const resilientSink: OnAudit = async (event) => {
  try {
    await clickhouseSink(event);
  } catch (err) {
    // Fall back to local disk queue; drain later.
    await appendToSpoolFile(event);
    metrics.ai_audit_spooled.inc();
  }
};
```

Spool-to-disk is a compliance safety net — events may never reach
the primary sink (network partition). A background worker drains
spool → primary. Document the SLA ("events spooled ≤24h reach sink
≥99.9%").

## Testing

```ts
import { emit, AiAuditEvent } from '@sveltesentio/ai/audit';

test('sink receives valid event', async () => {
  const sink = vi.fn();
  await emit({
    timestamp: new Date().toISOString(),
    kind: 'prompt',
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    correlationId: crypto.randomUUID(),
  }, sink);
  expect(sink).toHaveBeenCalledOnce();
  expect(sink.mock.calls[0][0].kind).toBe('prompt');
});

test('schema-invalid event does not reach sink', async () => {
  const sink = vi.fn();
  await emit({ kind: 'invalid' } as any, sink);
  expect(sink).not.toHaveBeenCalled();
});
```

Integration test against a real sink (ClickHouse in a container) is
worth the CI budget — sink quirks surface in staging otherwise.

## Privacy by design

- **No PII in `metadata`.** If you need to log a user email, hash
  it with a per-tenant salt and document the salt rotation.
- **Right-to-erasure.** Sink must support deletion by `userId`.
  Design the table so `delete from … where user_id = ?` is
  bounded-cost.
- **Jurisdiction.** Store EU-origin events in EU region. Data
  residency is a first-class compliance obligation.
- **Retention.** EU AI Act Art. 12: automatic log recording for
  high-risk systems; minimum 6 months; align TTL to
  classification.
- **Access control.** Sink table ACL distinct from product tables;
  audit the auditors.

## Anti-patterns

- **Logging raw prompts without `retain: 'full'` declaration.**
  Violates default minimization. Forces consumer audit trail.
- **No `correlationId`.** Events uncorrelatable with traces /
  logs — useless for incident forensics.
- **Default sink (file / OTel / anything).** Sveltesentio explicitly
  refuses. Consumer must wire.
- **Sink throws propagate to user flow.** UX fails because sink
  can't connect. Catch + spool + alert.
- **Free-form `metadata` with PII.** Drift-prone; require per-app
  Zod extension.
- **No retention TTL.** Compliance-grade storage with unbounded
  retention is its own liability.
- **Client-side `retain: 'full'`.** Ships user prompts from browser
  to client-telemetry sink — violates privacy posture. Keep
  compliance logging server-side per ADR-0043.
- **Trusting client-supplied `userId`.** Server must assign from
  authenticated session (see [auth-oidc.md](auth-oidc.md)).

## References

- ADR-0045 — AI audit hook + Zod schema.
- ADR-0043 — AI server-proxy-only posture.
- ADR-0023 — UUIDv7 correlation IDs.
- [schemas.md](schemas.md) — Zod v4 patterns.
- [http-client.md](http-client.md) — RFC 9457 correlation.
- `docs/compliance/eu-ai-act.md` — Art. 12 mapping.
- EU AI Act: <https://artificialintelligenceact.eu/>.
