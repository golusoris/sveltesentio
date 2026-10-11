# @sveltesentio/ai — AGENTS.md

> Server-proxy-only LLM client, on-device transformers seam, EU AI Act audit hook. Phase 12 per `.workingdir/PLAN.md`. Status: v0.4.0.

## Scope

v0.4.0 ships framework-agnostic sub-exports (plain `.ts`, unit-tested):

| Sub-export | Contents                                                                                                                                  | Runtime                              | ADR                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| `./audit`  | `aiAuditRecordSchema` (Zod v4) + `createAuditLog({ sink, redact?, clock?, idFactory? })` → `{ record }`; `AiAuditValidationError`         | Either                               | [ADR-0045](../../docs/adr/0045-ai-audit-hook-zod-schema.md)           |
| `./proxy`  | `createLlmProxy({ endpoint, fetch?, headers? })` → `{ chat, complete }`; throws `@sveltesentio/core` `ProblemError` (RFC 9457) on non-2xx | Either (points at YOUR `+server.ts`) | [ADR-0043](../../docs/adr/0043-ai-server-proxy-only.md)               |
| `./edge`   | `loadEdgePipeline(task, { factory?, model?, pipelineOptions? })` — dynamic-import seam over the OPTIONAL `@huggingface/transformers` peer | Browser + SSR                        | [ADR-0044](../../docs/adr/0044-huggingface-transformers-on-device.md) |

**Landed in v0.4.0:**
Node-only `./server` surface wraps `@anthropic-ai/sdk` / `ollama-js` behind proxy endpoint.
`./client` Svelte runes (`useLLMChat`, `<ChatStream>` via `./client/component`) stream via `@sveltesentio/realtime` SSE.

## Strict invariant — SDK boundary

**`@anthropic-ai/sdk` and `ollama-js` MUST NOT appear in any bundle that ships to the browser** ([ADR-0043](../../docs/adr/0043-ai-server-proxy-only.md)).
`createLlmProxy` enforces by construction:
POSTs only to app own `+server.ts` endpoint; never imports provider SDK.
Node-only `./server` surface keeps SDK imports behind it.
Gated by `no-restricted-imports` + bundle-name CI check.

Direct-browser pattern (CORS-open Ollama, browser-visible Anthropic key) banned.

## Edge AI — `@huggingface/transformers@^4.1`

Per [ADR-0044](../../docs/adr/0044-huggingface-transformers-on-device.md):

- **`@xenova/transformers` deprecated.** Migrate imports to `@huggingface/transformers`.
- `loadEdgePipeline(task, opts)` resolves module through `opts.factory` (defaults to dynamic `import('@huggingface/transformers')`).
- Heavy OPTIONAL peer stays out of bundle never calling it. Tests inject stub factory.
- Lazy-loaded per pipeline — WebGPU first, WASM fallback (configured via `pipelineOptions`, e.g. `{ device: 'webgpu' }`).
- `EdgeTask` covers: `feature-extraction`, `text-classification`, `token-classification`, `zero-shot-classification`, `translation`, `summarization`, `automatic-speech-recognition`.
- Full in-browser LLM (WebLLM / mlc-llm) stays in `docs/compose/ai-in-browser-llm.md` — not framework lock.

## Ollama — server-proxy-only

- Direct browser → Ollama calls banned ([ADR-0043](../../docs/adr/0043-ai-server-proxy-only.md)).
- Reason: Ollama has no CORS / auth by default — browser access means anyone-with-the-URL access.
- Server-side proxy wraps Ollama HTTP API + adds auth + rate-limit + audit-event emission.

## EU AI Act audit hook

Per [ADR-0045](../../docs/adr/0045-ai-audit-hook-zod-schema.md):

- `createAuditLog({ sink, redact?, clock?, idFactory? })` → `{ record(entry) }`.
- Consumer supplies `sink` — **no built-in sink**; framework refuses to invent retention policy.
- `record(entry)` redacts (optional), stamps `id` (via `idFactory`, default `crypto.randomUUID`) + `timestamp` (via injected `clock.now()` — [ADR-0052](../../docs/adr/0052-clock-injection-hybrid.md)), validates against `aiAuditRecordSchema`, then writes to sink.
- Invalid records throw `AiAuditValidationError`; sink not called.
- `aiAuditRecordSchema` (Zod v4) covers Article 12 requirements: `id`, `timestamp`, `model`, `prompt`/`promptHash`, `output`/`outputHash`, `userId?` (pseudonymous), `purpose`, `humanOverride`, `latencyMs?`.
- Covers EU-AI-Act fields: `riskTier?` (`minimal | limited | high | unacceptable`), `disclosureShown?` (Art. 50).
- Redaction keeps hash fields while dropping raw `prompt`/`output`.
- Canonical shape lives in [docs/compliance/ai-audit-log.md](../../docs/compliance/ai-audit-log.md) (TBD).

## Invariants

- **No API keys in client bundles.** `createLlmProxy` never imports provider SDK. With `./server` shipped, CI gate pattern-matches `sk-ant-` / `ANTHROPIC_API_KEY` in client bundle output -> fails build.
- **Streaming via `@sveltesentio/realtime` SSE** — no parallel streaming transport ([ADR-0037](../../docs/adr/0037-sse-native-useSSE.md), D131 locked). Wired through `./client`.
- **Audit emission = server job.** `./audit` log = seam; `./server` surface emits audit record on every inference. Seam consumer-driven, unopinionated about retention.

## Test policy

- `./audit` + `./proxy` + `./edge` + `./server` + `./client` logic **unit-tested** (Vitest, injected clock/fetch/factory).
- 57 tests, no network, no real model download.
- Proxy driven by injected `fetch`; edge seam driven by injected transformers factory -> heavy/optional peer never imported in tests.
- For `./server` SDK calls: mock at network layer (`msw`) — never mock SDK directly.
- Edge AI integration (real WebGPU pipeline) runs under Playwright against `./client` runes.
- Audit-schema evolution: breaking Zod schema = breaking framework release.

## Common tasks

| Task       | Command                                    |
| ---------- | ------------------------------------------ |
| Typecheck  | `pnpm --filter @sveltesentio/ai typecheck` |
| Lint       | `pnpm --filter @sveltesentio/ai lint`      |
| Unit tests | `pnpm --filter @sveltesentio/ai test`      |

## Related ADRs

- [ADR-0043](../../docs/adr/0043-ai-server-proxy-only.md) — server-proxy-only.
- [ADR-0044](../../docs/adr/0044-huggingface-transformers-on-device.md) — `@huggingface/transformers@^4.1` (not `@xenova/transformers`).
- [ADR-0045](../../docs/adr/0045-ai-audit-hook-zod-schema.md) — audit hook + Zod schema.
- [ADR-0037](../../docs/adr/0037-sse-native-useSSE.md) — streaming reuses realtime SSE.
