# @sveltesentio/ai

> Server-proxy-only LLM client, on-device transformers seam, and EU AI Act audit hook

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

v0.4.0 — provides `./audit`, `./proxy`, and `./edge` (below) plus the `./server`
SDK seam (`createLLMProxy()` with Anthropic/Ollama adapters) and `./client` runes
(`useLLMChat()` and the `ChatStream` component) that shipped after the first
functional release:

- **`@sveltesentio/ai/audit`** — Zod v4 schema for an AI audit record plus
  `createAuditLog()` ([ADR-0045](../../docs/adr/0045-ai-audit-hook-zod-schema.md),
  EU AI Act Art. 12 logging). Validates, optionally redacts PII, stamps time via
  an injectable clock, and writes to a consumer-supplied sink. No default sink.
- **`@sveltesentio/ai/proxy`** — `createLlmProxy()`, a server-proxy-only LLM
  client ([ADR-0043](../../docs/adr/0043-ai-server-proxy-only.md)). It POSTs to
  the app's own `+server.ts` endpoint — never a provider URL — and throws an
  RFC 9457 `ProblemError` (from `@sveltesentio/core`) on non-2xx. Provider SDKs
  and API keys NEVER reach the browser.
- **`@sveltesentio/ai/edge`** — `loadEdgePipeline()`, a thin on-device seam
  ([ADR-0044](../../docs/adr/0044-huggingface-transformers-on-device.md)) that
  dynamically imports the OPTIONAL `@huggingface/transformers` peer so the heavy
  models stay out of any bundle that never calls it. `@xenova/transformers` is
  deprecated.

## Installation

```bash
pnpm add @sveltesentio/ai
# on-device inference is optional:
pnpm add @huggingface/transformers
```

## Usage

```ts
// Audit hook — validate + redact + sink (ADR-0045)
import { createAuditLog } from '@sveltesentio/ai/audit';

const audit = createAuditLog({
  sink: (record) => myDatabase.insert(record),
  redact: ({ prompt: _p, output: _o, ...rest }) => rest, // keep only hashes
});
await audit.record({
  model: 'claude-sonnet-4',
  promptHash: 'sha256:…',
  outputHash: 'sha256:…',
  purpose: 'support-triage',
  humanOverride: false,
  riskTier: 'limited',
  disclosureShown: true,
});
```

```ts
// Server-proxy-only LLM client (ADR-0043) — talks to YOUR /api endpoint, not a provider
import { createLlmProxy } from '@sveltesentio/ai/proxy';

const llm = createLlmProxy({ endpoint: '/api/ai/chat' });
const reply = await llm.chat({ messages: [{ role: 'user', content: 'hi' }] });
```

```ts
// On-device inference (ADR-0044) — optional @huggingface/transformers peer
import { loadEdgePipeline } from '@sveltesentio/ai/edge';

const classifier = await loadEdgePipeline('text-classification', {
  model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
});
const result = await classifier.run('great product');
```

See the [monorepo README](../../README.md) and [`docs/`](../../docs/) for design principles.

## License

MIT © lusoris
