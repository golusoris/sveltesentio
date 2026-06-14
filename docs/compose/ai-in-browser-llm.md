# In-browser LLMs — `@mlc-ai/web-llm` opt-in for >1B-param models

`@sveltesentio/ai/on-device` covers small-model inference (embeddings,
classification, ASR, translation) per
[ADR-0044](../adr/0044-huggingface-transformers-on-device.md) — see
[ai-on-device.md](ai-on-device.md). This recipe documents the
**WebLLM opt-in** for full LLM chat / completion (>1B parameters,
WebGPU-quantised) running entirely in the browser.

WebLLM (`@mlc-ai/web-llm`, Apache-2.0, MLC AI / CMU) compiles
production LLMs (Llama 3.1 8B, Phi-3, Mistral 7B, Qwen 2.5, Gemma 2)
to WebGPU shaders. Inference happens on the GPU; weights live in
IndexedDB; no server round-trip.

WebLLM is **not** a framework default. ADR-0044 holds it opt-in
because:

- Models are 0.5–4 GB downloaded; UX impact is non-negotiable.
- WebGPU only — no WASM fallback path that's actually usable for LLM
  workloads.
- Most apps don't need full LLM chat client-side; server-proxied
  Anthropic / Ollama (ADR-0043) is a smaller bundle + better quality.
- Battery / thermal cost on mobile is significant.

When the trade-off is right (offline-capable assistants, privacy-
critical chat, demo apps without API budget), WebLLM is the only
practical path. This recipe documents when, how, and the audit /
compliance contract.

Related: [ai-on-device.md](ai-on-device.md) (small-model sibling),
[ai-audit-hook.md](ai-audit-hook.md) (audit LLM inferences too),
[markdown.md](markdown.md) (sanitise LLM output before render),
`docs/compliance/eu-ai-act.md`.

## When to use WebLLM

| Need | Tool |
|---|---|
| Small classifier / embedder | [ai-on-device.md](ai-on-device.md) |
| Full LLM chat, online | Server-proxy ([ai-audit-hook.md](ai-audit-hook.md)) |
| Full LLM chat, offline-capable | **WebLLM (this recipe)** |
| Privacy-critical: prompt never leaves device | **WebLLM** |
| Frontier capability (Claude, GPT-4) | Server-proxy — frontier weights aren't public |
| Mobile-first app | ⚠️ WebLLM brutal on phone battery; prefer server |
| Bundle ≤ 200 KB target | ❌ WebLLM ~600 KB code + GBs of weights |

Default to server-proxy. Reach for WebLLM when offline + privacy
together justify the cost.

## Install

```bash
pnpm add @mlc-ai/web-llm
```

Single dep — model registry is built in. No CDN; weights download
from HF / MLC mirror direct to IndexedDB.

WebLLM at `^0.2.79` (2026-04). Pin majors; minor bumps are
generally compatible.

## Browser support

| Browser | WebLLM |
|---|---|
| Chrome / Edge ≥ 121 (desktop) | ✅ |
| Safari 17.4+ (desktop) | ✅ slower; smaller models only |
| Firefox 141+ (Windows) | ⚠️ partial; not recommended |
| Mobile Chrome (Android, recent) | ⚠️ thermal-throttle; ≤ 3B param |
| Mobile Safari (iOS 17.4+) | ⚠️ memory-capped; ≤ 1.5B param |
| WebGPU not supported | ❌ no fallback |

Detect first. Show a server-proxy fallback for unsupported users —
don't hide the feature, surface the choice.

```ts
async function webLLMSupported(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;
    const gb = (adapter.limits?.maxBufferSize ?? 0) / 1e9;
    return gb >= 2;                          // 2 GB minimum for 3B-param models
  } catch {
    return false;
  }
}
```

## Model selection + size budgets

WebLLM's built-in `prebuiltAppConfig` lists supported models. Pick
the smallest that meets your task:

| Model | Quantised size | Budget |
|---|---|---|
| `Phi-3.5-mini-instruct-q4f16_1-MLC` | ~2.0 GB | Mobile-friendly |
| `Llama-3.2-1B-Instruct-q4f16_1-MLC` | ~0.9 GB | Mobile / fastest |
| `Llama-3.2-3B-Instruct-q4f16_1-MLC` | ~1.9 GB | Desktop default |
| `Llama-3.1-8B-Instruct-q4f32_1-MLC` | ~4.4 GB | Desktop, 8 GB+ GPU |
| `Mistral-7B-Instruct-v0.3-q4f16_1-MLC` | ~4.0 GB | Desktop, multilingual |
| `Qwen2.5-7B-Instruct-q4f16_1-MLC` | ~4.4 GB | Desktop, code-aware |
| `gemma-2-2b-it-q4f16_1-MLC` | ~1.5 GB | Mobile / safety-tuned |

Quantisation suffixes:

- `q4f16_1` — 4-bit weights, 16-bit activations. Default; best
  quality/size trade-off.
- `q4f32_1` — 4-bit weights, 32-bit activations. Slightly better
  quality, ~50% larger weights buffer in VRAM.

**Budget rule:** mobile ≤ 1.5 GB, desktop default ≤ 3 GB,
power-user opt-in for 4 GB+. Larger means longer download + risk
of OOM on integrated GPUs.

## `loadEngine()` shape

```ts
// @sveltesentio/ai/llm-browser
import { CreateMLCEngine, MLCEngine } from '@mlc-ai/web-llm';

export interface LoadOptions {
  model: string;                             // model_id from prebuiltAppConfig
  onProgress?: (info: { progress: number; text: string }) => void;
}

export async function loadEngine(opts: LoadOptions): Promise<MLCEngine> {
  return CreateMLCEngine(opts.model, {
    initProgressCallback: opts.onProgress,
  });
}
```

Engine construction triggers download (if not cached) + WebGPU
shader compile (~5-30 s first run). Cache the engine module-level —
reconstruction means re-download check + recompile.

## Component pattern — chat with progress + audit

```svelte
<!-- src/lib/ai/Chat.svelte -->
<script lang="ts">
  import { loadEngine, webLLMSupported } from '@sveltesentio/ai/llm-browser';
  import { sanitizeMarkdown } from '@sveltesentio/ui/markdown';
  import { onAudit } from '$lib/ai/audit';
  import type { MLCEngine } from '@mlc-ai/web-llm';

  type Msg = { role: 'user' | 'assistant'; content: string };

  let messages = $state<Msg[]>([]);
  let input = $state('');
  let status = $state<'unsupported' | 'idle' | 'loading' | 'ready' | 'streaming' | 'error'>('idle');
  let progress = $state(0);
  let progressText = $state('');
  let engine: MLCEngine | null = null;

  const MODEL = 'Llama-3.2-3B-Instruct-q4f16_1-MLC';

  $effect(() => {
    void webLLMSupported().then((ok) => {
      if (!ok) status = 'unsupported';
    });
  });

  async function warm() {
    status = 'loading';
    try {
      engine = await loadEngine({
        model: MODEL,
        onProgress: ({ progress: p, text }) => {
          progress = p;
          progressText = text;
        },
      });
      status = 'ready';
    } catch (err) {
      status = 'error';
      console.error('[ai.llm-browser] engine load failed', err);
    }
  }

  async function send() {
    if (!engine || !input.trim()) return;
    const userMsg: Msg = { role: 'user', content: input };
    messages.push(userMsg);
    input = '';
    status = 'streaming';

    const correlationId = crypto.randomUUID();
    onAudit({
      kind: 'prompt', correlationId, model: MODEL, provider: 'webllm',
      timestamp: new Date().toISOString(),
    });

    const assistantMsg: Msg = { role: 'assistant', content: '' };
    messages.push(assistantMsg);
    const idx = messages.length - 1;

    try {
      const stream = await engine.chat.completions.create({
        messages: messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) messages[idx].content += delta;
      }

      onAudit({
        kind: 'response', correlationId, model: MODEL, provider: 'webllm',
        timestamp: new Date().toISOString(),
      });
      status = 'ready';
    } catch (err) {
      onAudit({
        kind: 'error', correlationId, model: MODEL, provider: 'webllm',
        timestamp: new Date().toISOString(),
        metadata: { message: String(err) },
      });
      status = 'error';
    }
  }
</script>

{#if status === 'unsupported'}
  <p>This browser doesn't support on-device LLM. <a href="/chat-cloud">Use cloud chat instead.</a></p>
{:else if status === 'idle'}
  <button onclick={warm}>Load model (~1.9 GB · one-time download)</button>
{:else if status === 'loading'}
  <progress value={progress} max="1" aria-label="Loading model"></progress>
  <span role="status">{progressText} ({Math.round(progress * 100)}%)</span>
{:else}
  <ol role="log" aria-live="polite" aria-relevant="additions">
    {#each messages as msg, i (i)}
      <li class={msg.role}>
        {#if msg.role === 'assistant'}
          {@html sanitizeMarkdown(msg.content)}
        {:else}
          {msg.content}
        {/if}
      </li>
    {/each}
  </ol>

  <form onsubmit={(e) => { e.preventDefault(); send(); }}>
    <input bind:value={input} disabled={status === 'streaming'} />
    <button type="submit" disabled={status === 'streaming'}>Send</button>
  </form>
{/if}
```

Six invariants:

1. **WebGPU detection before render.** `unsupported` state surfaces
   a server-proxy fallback link — don't hide.
2. **Explicit `warm()` button with byte estimate.** GBs download
   without consent is hostile.
3. **Streaming via `chat.completions.create({ stream: true })`** —
   OpenAI-shaped API; no special wrapping needed.
4. **Audit hook on every prompt + response + error.** EU AI Act
   Art. 12 applies regardless of where inference runs (mirrors
   [ai-on-device.md](ai-on-device.md)).
5. **`{@html sanitizeMarkdown(content)}` not raw.** LLM output is
   external data per [markdown.md](markdown.md). DOMPurify or
   plaintext only.
6. **`role="log" aria-live="polite"`** — same SR contract as
   streaming feeds. Never `role="alert"`.

## Caching + persistence

WebLLM stores model artifacts in IndexedDB (`webllm/cache-mlc-llm`).
Survives tab close. Request persistence so eviction can't wipe a
4 GB download:

```ts
if ('storage' in navigator && 'persist' in navigator.storage) {
  await navigator.storage.persist();
}

const usage = await navigator.storage.estimate();
console.log(`Used ${usage.usage} of ${usage.quota} bytes`);
```

Mirrors the pattern in
[collab-persistence.md](collab-persistence.md) and
[ai-on-device.md](ai-on-device.md).

Eviction control:

```ts
export async function purgeWebLLMCache() {
  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    if (db.name?.startsWith('webllm/')) {
      indexedDB.deleteDatabase(db.name);
    }
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('webllm/')).map((k) => caches.delete(k)));
  }
}
```

Surface in settings: "Clear AI model cache (1.9 GB)". Required for
shared devices (mirrors [uploads.md](uploads.md) per-user purge).

## Service worker offload

WebLLM ships an optional service-worker variant
(`MLCEngineServiceWorker`) that runs the engine off the main thread:

```ts
import { CreateServiceWorkerMLCEngine } from '@mlc-ai/web-llm';

const engine = await CreateServiceWorkerMLCEngine(MODEL, {
  initProgressCallback: ({ progress }) => { /* … */ },
});
```

Pros: main thread stays responsive during inference (large models
peg the GPU thread for seconds).
Cons: SW lifecycle adds debugging surface; install / update / scope
gotchas. Default to in-page `MLCEngine`; switch to SW when main-
thread jank shows up.

## Performance notes

- **First load is the painful one.** 5-30 s WebGPU shader compile
  even after weights cached. Subsequent loads ~2-5 s.
- **Token-per-second varies hugely.** Llama-3.2-3B on M2 Pro
  ~30 tok/s; same model on integrated Intel ~5 tok/s. Profile per
  target.
- **Battery + thermal.** Sustained inference will throttle laptops
  and burn phone battery. Don't auto-warm; let user opt in.
- **Context window matters.** Longer prompts = quadratic memory.
  Cap user input length; use sliding-window summary for long chats.
- **Generation params.** `temperature`, `top_p`, `max_tokens` are
  passed through OpenAI-shape; defaults are reasonable but tune
  for your task.

## Audit-hook integration

Same as [ai-on-device.md](ai-on-device.md) — emit `AiAuditEvent`
per inference with `provider: 'webllm'` and a UUIDv7 correlation
ID per ADR-0023:

```ts
import { emit } from '@sveltesentio/ai/audit';

const correlationId = crypto.randomUUID();
await emit({
  timestamp: new Date().toISOString(),
  kind: 'prompt',
  provider: 'webllm',
  model: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
  correlationId,
  userId: session?.user.id,
}, onAudit);
```

EU AI Act Art. 12 logging is about system behaviour, not runtime
location. Browser inference still logs.

For client-side audit shipped to a server sink, batch + flush
periodically — don't ship per-token (network thrash).

## Output safety

LLM output is external data. Two boundaries:

1. **Schema-validate structured output.** If you ask the model for
   JSON, parse with Zod per [schemas.md](schemas.md). Models
   hallucinate JSON shapes routinely.
2. **Sanitise text-as-HTML.** Never `{@html llmOutput}`. Always run
   through `DOMPurify` per [markdown.md](markdown.md), or render as
   plaintext.

```ts
const Plan = z.object({
  steps: z.array(z.string()).min(1).max(20),
  estimateMinutes: z.number().int().positive(),
});

const completion = await engine.chat.completions.create({
  messages: [{ role: 'user', content: 'Output JSON: a 5-step weekend trip plan…' }],
  response_format: { type: 'json_object' },
});

const parsed = Plan.safeParse(JSON.parse(completion.choices[0].message.content));
if (!parsed.success) toast.error('Model returned invalid plan');
```

## SSR guards

Client-only — `webllm` imports `WebGPU` and crashes during SSR.
Either:

```ts
import { browser } from '$app/environment';

if (browser) {
  const { loadEngine } = await import('@sveltesentio/ai/llm-browser');
  engine = await loadEngine({ model: MODEL });
}
```

Or `+page.ts` `export const ssr = false;` for fully-AI pages.

## CSP

WebLLM downloads weights from `https://huggingface.co` and
`https://raw.githubusercontent.com` (MLC config). Allowlist:

```text
connect-src 'self' https://huggingface.co https://raw.githubusercontent.com;
worker-src 'self' blob:;                 # service-worker variant
```

For self-hosting (recommended for production), mirror the model
repo and replace `appConfig.model_list[].model` with your origin.

## Testing

WebLLM doesn't run in jsdom (no WebGPU). Real-browser only:

```ts
// playwright.test.ts
import { test, expect } from '@playwright/test';

test('llm chat completes', async ({ page }) => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'WebGPU stable on Chromium');
  await page.goto('/chat-local');
  await page.click('button:has-text("Load model")');
  await expect(page.getByRole('status')).toContainText('100%', { timeout: 120_000 });
  await page.fill('input', 'Reply with the word ready');
  await page.click('button:has-text("Send")');
  await expect(page.locator('[role=log] li.assistant').last()).toContainText(/ready/i, { timeout: 30_000 });
});
```

CI cost: model download is multi-GB. Cache the IndexedDB across
runs or run gated nightly. Don't run on every PR.

## Anti-patterns

- **Auto-warm on mount.** GBs download without consent. Always
  explicit user gesture.
- **No WebGPU-supported fallback.** Users without WebGPU see a
  blank screen. Surface server-proxy alternative.
- **`{@html llmOutput}` without sanitisation.** Model output is
  external data. DOMPurify per [markdown.md](markdown.md).
- **No audit hook.** EU AI Act Art. 12 applies; correlation log
  every inference.
- **Trusting client-rendered LLM output server-side.** Anyone can
  send any string to any endpoint. Server validates anew.
- **Skipping `safeParse` on JSON-mode output.** Models hallucinate
  shapes. Zod at the boundary.
- **Default to 7B+ on mobile.** OOM / thermal-throttle. ≤ 3B on
  mobile.
- **No persisted-storage request.** Browser eviction wipes 4 GB
  download silently. `navigator.storage.persist()`.
- **No purge UI for shared devices.** Settings must expose
  "clear AI cache" — same contract as
  [ai-on-device.md](ai-on-device.md).
- **Bundling WebLLM on every route.** ~600 KB JS + indirect
  shader compile cost. Lazy-load with dynamic import.
- **Promoting WebLLM to framework default.** ADR-0044 holds it
  opt-in. Server-proxy is the default; this is the escape hatch.

## References

- ADR-0044 — `@huggingface/transformers` on-device + WebLLM held
  opt-in.
- ADR-0045 — AI audit hook + Zod schema.
- ADR-0043 — AI server-proxy posture (preferred default).
- ADR-0023 — UUIDv7 correlation IDs.
- [ai-on-device.md](ai-on-device.md) — small-model sibling recipe.
- [ai-audit-hook.md](ai-audit-hook.md) — audit every inference.
- [markdown.md](markdown.md) — sanitise LLM output before render.
- [schemas.md](schemas.md) — Zod at boundaries.
- [collab-persistence.md](collab-persistence.md) — persistent-storage
  pattern mirror.
- WebLLM docs: <https://webllm.mlc.ai/>.
- MLC LLM project: <https://llm.mlc.ai/>.
- `docs/compliance/eu-ai-act.md` — Art. 12 applies on-device too.
