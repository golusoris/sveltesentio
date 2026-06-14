# @sveltesentio/ai — AGENTS.md

> LLM chat streaming, edge AI, semantic search, EU AI Act audit hook. Phase 12 per [.workingdir/PLAN.md](../../.workingdir/PLAN.md).

## Scope

**Server-proxy-only for provider SDKs.** Two sub-exports with strict boundary enforcement:

| Sub-export | Contents | Runtime | ADR |
|---|---|---|---|
| `./server` | `@anthropic-ai/sdk` client, `ollama-js` client, SSE stream adapter, audit-event builder | Node only | [ADR-0043](../../docs/adr/0043-ai-server-proxy-only.md) |
| `./client` | `useLLMChat` rune (SSE → `$state`), `<ChatStream>`, `createEdgeAI()` for on-device | Browser + SSR | [ADR-0043](../../docs/adr/0043-ai-server-proxy-only.md) + [ADR-0044](../../docs/adr/0044-huggingface-transformers-on-device.md) |
| `./audit` | `onAudit(event)` hook + shipped Zod schema for `AiAuditEvent` | Either | [ADR-0045](../../docs/adr/0045-ai-audit-hook-zod-schema.md) |

## Strict invariant — SDK boundary

**`@anthropic-ai/sdk` and `ollama-js` MUST NOT appear in any bundle that ships to the browser.** Enforced by:

1. `exports` map refuses `./client` from importing `./server`.
2. ESLint `no-restricted-imports` in `src/client/**` blocks the SDKs by name.
3. Rollup-plugin-visualizer CI gate asserts the client bundle doesn't contain their package names.

The direct-browser pattern (CORS-open Ollama, browser-visible Anthropic key) is banned.

## Edge AI — `@huggingface/transformers@^4.1`

Per [ADR-0044](../../docs/adr/0044-huggingface-transformers-on-device.md):

- **`@xenova/transformers` is deprecated.** Migrate imports to `@huggingface/transformers`.
- Lazy-loaded per pipeline — WebGPU first, WASM fallback.
- Supported pipelines: `embeddings`, `feature-extraction`, `text-classification`, `token-classification`, `zero-shot-classification`.
- Full in-browser LLM (WebLLM / mlc-llm) stays in `docs/compose/ai-in-browser-llm.md` — not a framework lock.

## Ollama — server-proxy-only

- Direct browser → Ollama calls are banned ([ADR-0043](../../docs/adr/0043-ai-server-proxy-only.md)). Ollama has no CORS / auth by default — browser access means anyone-with-the-URL access.
- Server-side proxy wraps Ollama HTTP API + adds auth + rate-limit + audit-event emission.

## EU AI Act audit hook

Per [ADR-0045](../../docs/adr/0045-ai-audit-hook-zod-schema.md):

- `onAudit(event: AiAuditEvent)` consumer callback — **not** a built-in sink.
- Zod schema for `AiAuditEvent` shipped — consumers validate their own downstream pipeline.
- Event shape covers Article 12 requirements: model ID, input hash (not raw input), output hash, decision metadata, timestamp (via injected clock — [ADR-0052](../../docs/adr/0052-clock-injection-hybrid.md)), user identifier (pseudonymous).
- Canonical shape lives in [docs/compliance/ai-audit-log.md](../../docs/compliance/ai-audit-log.md) (TBD).

## Invariants

- **No API keys in client bundles.** CI gate verifies. Pattern-match `sk-ant-` / `ANTHROPIC_API_KEY` in client bundle output fails the build.
- **Streaming via `@sveltesentio/realtime` SSE** — no parallel streaming transport ([ADR-0037](../../docs/adr/0037-sse-native-useSSE.md), D131 locked).
- **Audit events emit on every inference** — server-side default, not opt-in. Consumers can filter via `onAudit`, but the emission is mandatory.

## Test policy

- Server SDK calls mocked at the network layer (`msw`) — never mock the SDK itself.
- Edge AI tests run under Playwright with a real WebGPU-enabled browser.
- Audit-schema evolution: breaking the Zod schema is a breaking framework release.

## Common tasks

| Task | Command |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/ai typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/ai test` |
| Bundle boundary check | `pnpm --filter @sveltesentio/ai check:bundle` |

## Related ADRs

- [ADR-0043](../../docs/adr/0043-ai-server-proxy-only.md) — server-proxy-only.
- [ADR-0044](../../docs/adr/0044-huggingface-transformers-on-device.md) — `@huggingface/transformers@^4.1` (not `@xenova/transformers`).
- [ADR-0045](../../docs/adr/0045-ai-audit-hook-zod-schema.md) — audit hook + Zod schema.
- [ADR-0037](../../docs/adr/0037-sse-native-useSSE.md) — streaming reuses realtime SSE.
