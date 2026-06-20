# ADR-0045: AI audit hook with shipped Zod schema; EU AI Act readiness scaffolding

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D134 in `.workingdir/research/decisions-needed.md`

## Context

The EU AI Act (provisions phased through 2026+) requires logging + transparency for AI-system interactions in certain categories. Sveltesentio cannot know each consumer's compliance classification, but it can ship the scaffolding: a typed audit event emitted at every AI call site and a consumer-provided `onAudit` callback. The framework does not persist; compliance persistence is the consumer's job.

## Decision

`@sveltesentio/ai` ships:

- A Zod schema `AiAuditEvent`:
  - `timestamp` (ISO 8601)
  - `kind` (`'prompt' | 'response' | 'error'`)
  - `provider` (`'anthropic' | 'ollama' | 'huggingface' | string`)
  - `model` (string)
  - `correlationId` (UUIDv7, per ADR-0023)
  - `userId?` (consumer-supplied; optional for anonymous flows)
  - `input?` (redacted by default; consumer opts in to retention)
  - `output?` (same redaction policy)
  - `metadata?` (free-form, Zod `z.record`)
- Consumer hook: `onAudit(event: AiAuditEvent): void | Promise<void>`. Called synchronously on client, async-fire-and-log on server.
- `docs/compliance/ai-audit-log.md` documents the event shape + EU AI Act mapping.
- No default sink. Framework refuses to invent a retention policy.

## Alternatives considered

- **No audit hook** — pushes every consumer to instrument every call site manually.
- **Default sink (file / OTEL)** — invents a retention policy that might violate consumer compliance (locality, right-to-erasure).
- **Framework-owned audit DB** — out of scope; persistence is app/infra concern.

## Consequences

**Positive**:

- Consumers can drop in a compliant audit pipeline without touching call sites.
- Event shape is Zod-typed — schema evolution is tractable.
- Correlation IDs tie AI events to traces (ADR-0023).

**Negative / trade-offs**:

- Consumers must write the sink; framework is explicitly unopinionated.
- Schema evolution ripples into downstream sinks; bumps via ADR amendment with migration notes.

**Documentation obligations**:

- `docs/compliance/ai-audit-log.md` — event shape, EU AI Act Art. 12 mapping, example sinks (OTEL, ClickHouse, PostgreSQL).
- `@sveltesentio/ai` AGENTS.md — audit contract.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:106` — D134 pick.
- EU AI Act Article 12 — logging obligations for high-risk systems.
- ADR-0023 — UUIDv7 correlation IDs.
