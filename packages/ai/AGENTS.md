# @sveltesentio/ai — AGENTS.md

> Server-proxy-only LLM client, on-device transformers seam, EU AI Act audit hook. Phase 12 per [.workingdir/PLAN.md](../../.workingdir/PLAN.md). Status: v0.2.0 — first functional release.

## Scope

v0.2.0 ships three framework-agnostic sub-exports (plain `.ts`, unit-tested):

| Sub-export | Contents | Runtime | ADR |
|---|---|---|---|
| `./audit` | `aiAuditRecordSchema` (Zod v4) + `createAuditLog({ sink, redact?, clock?, idFactory? })` → `{ record }`; `AiAuditValidationError` | Either | [ADR-0045](../../docs/adr/0045-ai-audit-hook-zod-schema.md) |
| `./proxy` | `createLlmProxy({ endpoint, fetch?, headers? })` → `{ chat, complete }`; throws `@sveltesentio/core` `ProblemError` (RFC 9457) on non-2xx | Either (points at YOUR `+server.ts`) | [ADR-0043](../../docs/adr/0043-ai-server-proxy-only.md) |
| `./edge` | `loadEdgePipeline(task, { factory?, model?, pipelineOptions? })` — dynamic-import seam over the OPTIONAL `@huggingface/transformers` peer | Browser + SSR | [ADR-0044](../../docs/adr/0044-huggingface-transformers-on-device.md) |

**Planned (not in this release):** a Node-only `./server` surface wrapping `@anthropic-ai/sdk` / `ollama-js` behind the proxy endpoint, and `./client` Svelte runes (`useLLMChat`, `<ChatStream>`) streaming via `@sveltesentio/realtime` SSE.

## Strict invariant — SDK boundary

**`@anthropic-ai/sdk` and `ollama-js` MUST NOT appear in any bundle that ships to the browser** ([ADR-0043](../../docs/adr/0043-ai-server-proxy-only.md)). `createLlmProxy` enforces this by construction: it only ever POSTs to the app's own `+server.ts` endpoint and never imports a provider SDK. When the Node-only `./server` surface lands, the SDK imports stay behind it, gated by `no-restricted-imports` + a bundle-name CI check.

The direct-browser pattern (CORS-open Ollama, browser-visible Anthropic key) is banned.

## Edge AI — `@huggingface/transformers@^4.1`

Per [ADR-0044](../../docs/adr/0044-huggingface-transformers-on-device.md):

- **`@xenova/transformers` is deprecated.** Migrate imports to `@huggingface/transformers`.
- `loadEdgePipeline(task, opts)` resolves the module through `opts.factory` (defaulting to a dynamic `import('@huggingface/transformers')`), so the heavy OPTIONAL peer stays out of any bundle that never calls it. Tests inject a stub factory.
- Lazy-loaded per pipeline — WebGPU first, WASM fallback (configured via `pipelineOptions`, e.g. `{ device: 'webgpu' }`).
- `EdgeTask` covers: `feature-extraction`, `text-classification`, `token-classification`, `zero-shot-classification`, `translation`, `summarization`, `automatic-speech-recognition`.
- Full in-browser LLM (WebLLM / mlc-llm) stays in `docs/compose/ai-in-browser-llm.md` — not a framework lock.

## Ollama — server-proxy-only

- Direct browser → Ollama calls are banned ([ADR-0043](../../docs/adr/0043-ai-server-proxy-only.md)). Ollama has no CORS / auth by default — browser access means anyone-with-the-URL access.
- Server-side proxy wraps Ollama HTTP API + adds auth + rate-limit + audit-event emission.

## EU AI Act audit hook

Per [ADR-0045](../../docs/adr/0045-ai-audit-hook-zod-schema.md):

- `createAuditLog({ sink, redact?, clock?, idFactory? })` → `{ record(entry) }`. The consumer supplies the `sink` — **no built-in sink**; the framework refuses to invent a retention policy.
- `record(entry)` redacts (optional), stamps `id` (via `idFactory`, default `crypto.randomUUID`) + `timestamp` (via injected `clock.now()` — [ADR-0052](../../docs/adr/0052-clock-injection-hybrid.md)), validates against `aiAuditRecordSchema`, then writes to the sink. Invalid records throw `AiAuditValidationError`; the sink is not called.
- `aiAuditRecordSchema` (Zod v4) covers Article 12 requirements: `id`, `timestamp`, `model`, `prompt`/`promptHash`, `output`/`outputHash`, `userId?` (pseudonymous), `purpose`, `humanOverride`, `latencyMs?`, plus EU-AI-Act fields `riskTier?` (`minimal | limited | high | unacceptable`) and `disclosureShown?` (Art. 50). Redaction keeps the hash fields while dropping raw `prompt`/`output`.
- Canonical shape lives in [docs/compliance/ai-audit-log.md](../../docs/compliance/ai-audit-log.md) (TBD).

## Invariants

- **No API keys in client bundles.** `createLlmProxy` never imports a provider SDK; when `./server` lands, a CI gate pattern-matches `sk-ant-` / `ANTHROPIC_API_KEY` in client bundle output and fails the build.
- **Streaming via `@sveltesentio/realtime` SSE** — no parallel streaming transport ([ADR-0037](../../docs/adr/0037-sse-native-useSSE.md), D131 locked). Wired when `./client` lands.
- **Audit emission is the server's job.** The `./audit` log is the seam; the planned `./server` surface emits an audit record on every inference. The seam itself is consumer-driven and unopinionated about retention.

## Test policy

- `./audit` + `./proxy` + `./edge` logic is plain `.ts` and **unit-tested** (Vitest, injected clock/fetch/factory). 23 tests, no network and no real model download.
- The proxy is driven by an injected `fetch`; the edge seam by an injected transformers factory — the heavy/optional peer is never imported in tests.
- When `./server` SDK calls land, mock at the network layer (`msw`) — never mock the SDK itself.
- Edge AI integration (real WebGPU pipeline) runs under Playwright when the `./client` runes land.
- Audit-schema evolution: breaking the Zod schema is a breaking framework release.

## Common tasks

| Task | Command |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/ai typecheck` |
| Lint | `pnpm --filter @sveltesentio/ai lint` |
| Unit tests | `pnpm --filter @sveltesentio/ai test` |

## Related ADRs

- [ADR-0043](../../docs/adr/0043-ai-server-proxy-only.md) — server-proxy-only.
- [ADR-0044](../../docs/adr/0044-huggingface-transformers-on-device.md) — `@huggingface/transformers@^4.1` (not `@xenova/transformers`).
- [ADR-0045](../../docs/adr/0045-ai-audit-hook-zod-schema.md) — audit hook + Zod schema.
- [ADR-0037](../../docs/adr/0037-sse-native-useSSE.md) — streaming reuses realtime SSE.
