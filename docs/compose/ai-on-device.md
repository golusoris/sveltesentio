# On-device AI — `@huggingface/transformers` with WebGPU + WASM fallback

`@sveltesentio/ai/on-device` wraps `@huggingface/transformers@^4.1.0`
per [ADR-0044](../adr/0044-huggingface-transformers-on-device.md).
The package (formerly `@xenova/transformers`, frozen 2024, transferred
to Hugging Face) runs transformer inference in the browser via WebGPU
(default) or WASM (fallback).

This recipe covers when to run on-device vs. server-proxied AI, model
selection + size budgets, WebGPU capability detection + fallback,
runes-friendly async iterables, the xenova → huggingface migration,
and audit-hook integration for compliance.

Related: [ai-audit-hook.md](ai-audit-hook.md) (audit on-device
inferences too), [schemas.md](schemas.md) (Zod at inference
boundaries), `docs/compliance/eu-ai-act.md`.

## When to run on-device

| Consideration | On-device (this recipe) | Server-proxied (ADR-0043) |
|---|---|---|
| Latency-critical (< 50 ms) | ✅ | ❌ network RTT |
| Privacy-sensitive input | ✅ never leaves device | ⚠️ server sees prompt |
| Offline / flaky network | ✅ | ❌ |
| Large models (>1 GB) | ❌ download cost | ✅ |
| Frontier LLMs (Claude / GPT-4) | ❌ weights not public | ✅ |
| Cost per request | Free after download | $ per call |
| Battery / mobile CPU | ⚠️ WASM fallback drains | ✅ |

Rule of thumb: classification, embeddings, small translation, ASR,
OCR → on-device. Open-ended LLM chat → server. Ambiguous cases (<1B
parameter chat models, code completion) → prototype on-device first,
measure, migrate if budget breaks.

LLM-specific heavy-weight flows (>1B params, WebGPU quantised) go
through `docs/compose/ai-in-browser-llm.md` (WebLLM / mlc-llm) —
separate recipe, narrower use case.

## Install

```bash
pnpm add @huggingface/transformers
```

**Never install `@xenova/transformers`** — frozen 2024, not
maintained. The package transferred to Hugging Face and renamed.
See the migration section below.

`@sveltesentio/ai/on-device` re-exports the pipeline helpers with
runes-friendly wrappers.

## Model selection + size budget

Models load from the HF hub by default (`https://huggingface.co/<org>/<model>`).
Size is the first-order constraint: a 50 MB model downloads in
seconds on cable, tens of minutes on 3G.

| Task | Recommended model | Size (quantised) |
|---|---|---|
| Sentence embeddings | `Xenova/all-MiniLM-L6-v2` | ~25 MB |
| Multilingual embeddings | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | ~120 MB |
| Sentiment / classification | `Xenova/distilbert-base-uncased-finetuned-sst-2-english` | ~65 MB |
| Zero-shot classification | `Xenova/nli-deberta-v3-xsmall` | ~75 MB |
| Translation (small) | `Xenova/nllb-200-distilled-600M` | ~250 MB |
| ASR (speech → text) | `Xenova/whisper-tiny.en` | ~75 MB |
| Whisper multilingual | `Xenova/whisper-base` | ~145 MB |
| Token classification (NER) | `Xenova/bert-base-NER` | ~110 MB |
| Image classification | `Xenova/vit-base-patch16-224` | ~85 MB |

(HF mirrors the Xenova namespace — paths unchanged after transfer.)

**Budget rule:** one on-device model per page ≤ 100 MB quantised.
Multiple ≤ 250 MB total. Bigger → server, or WebLLM for LLM
quantised at 1-4 GB.

## `loadPipeline()` shape

```ts
// @sveltesentio/ai/on-device
import { pipeline, env } from '@huggingface/transformers';

env.allowRemoteModels = true;            // HF hub
env.allowLocalModels = true;             // `public/models/...` self-host
env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency ?? 4;

export async function loadPipeline<T extends PipelineTask>(
  task: T,
  model: string,
  options?: PipelineOptions,
): Promise<Pipeline<T>> {
  const device = await pickDevice();     // 'webgpu' | 'wasm'
  return pipeline(task, model, { device, ...options });
}
```

Pipelines are lazy — construct once, reuse across inferences. Don't
rebuild per call; downloads redo otherwise.

## WebGPU detection + WASM fallback

```ts
// @sveltesentio/ai/on-device/device
export async function pickDevice(): Promise<'webgpu' | 'wasm'> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return 'wasm';
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return 'wasm';
    // Optional: sniff limits to reject tiny integrated GPUs
    if ((adapter.limits?.maxBufferSize ?? 0) < 256 * 1024 * 1024) return 'wasm';
    return 'webgpu';
  } catch {
    return 'wasm';
  }
}
```

Browser support matrix (2026-04):

| Browser | WebGPU | Fallback |
|---|---|---|
| Chrome/Edge ≥ 113 | ✅ | WASM |
| Safari 17+ | ✅ | WASM |
| Firefox 141+ | ⚠️ partial (Windows only stable) | WASM |
| Mobile Chrome ≥ 121 | ✅ | WASM |
| Mobile Safari 17.4+ | ✅ | WASM |
| Older / no WebGPU | ❌ | WASM only |

WASM is ~3-10× slower than WebGPU for transformer workloads — budget
accordingly. Very large models may exceed mobile RAM in WASM; gate by
`navigator.deviceMemory` when known.

## Component pattern — runes + progress

```svelte
<!-- src/lib/ai/Classifier.svelte -->
<script lang="ts">
  import { loadPipeline } from '@sveltesentio/ai/on-device';
  import { onAudit } from '$lib/ai/audit';

  let { initialText = '' }: { initialText?: string } = $props();
  let text = $state(initialText);
  let result = $state<null | { label: string; score: number }>(null);
  let status = $state<'idle' | 'loading' | 'ready' | 'inferring' | 'error'>('idle');
  let progress = $state(0);

  let classifier: Awaited<ReturnType<typeof loadPipeline>> | null = null;

  async function warm() {
    status = 'loading';
    try {
      classifier = await loadPipeline('text-classification',
        'Xenova/distilbert-base-uncased-finetuned-sst-2-english', {
        progress_callback: (p: { progress?: number }) => {
          if (typeof p.progress === 'number') progress = p.progress;
        },
      });
      status = 'ready';
    } catch (err) {
      status = 'error';
      console.error('[ai.on-device] load failed', err);
    }
  }

  async function classify() {
    if (!classifier) return;
    status = 'inferring';
    const correlationId = crypto.randomUUID();
    onAudit({ kind: 'prompt', correlationId, model: 'distilbert-sst2',
              provider: 'on-device', timestamp: new Date().toISOString() });
    try {
      const [out] = await classifier(text) as Array<{ label: string; score: number }>;
      result = out;
      onAudit({ kind: 'response', correlationId, model: 'distilbert-sst2',
                provider: 'on-device', timestamp: new Date().toISOString() });
      status = 'ready';
    } catch (err) {
      onAudit({ kind: 'error', correlationId, model: 'distilbert-sst2',
                provider: 'on-device', timestamp: new Date().toISOString(),
                metadata: { message: String(err) } });
      status = 'error';
    }
  }
</script>

<div>
  {#if status === 'idle'}
    <button onclick={warm}>Load model (~65 MB)</button>
  {:else if status === 'loading'}
    <progress value={progress} max="1" aria-label="Loading model" />
    <span role="status">Downloading model: {Math.round(progress * 100)}%</span>
  {:else}
    <textarea bind:value={text} rows="3"></textarea>
    <button onclick={classify} disabled={status === 'inferring'}>Classify</button>
    {#if result}
      <output aria-live="polite">
        {result.label} ({(result.score * 100).toFixed(1)}%)
      </output>
    {/if}
  {/if}
</div>
```

Four invariants:

1. **Explicit `warm()` button.** Never auto-download on mount — user
   must consent to tens-of-MB transfer. Especially on mobile.
2. **`progress_callback` drives `<progress>` + `role="status"`.** SR
   users hear the percentage; sighted users see the bar.
3. **Pipeline constructed once.** Reuse across `classify()` calls.
4. **Audit hook wraps every inference.** On-device is still AI; EU AI
   Act Art. 12 logging applies regardless of where inference runs.

## Async iterables for streaming

Whisper ASR and streaming translation pipelines can yield chunk-wise.
Expose as async iterables — natural fit with `await … of` + runes:

```ts
// @sveltesentio/ai/on-device/stream
export async function* transcribeStream(
  audio: ArrayBuffer | Float32Array,
  model = 'Xenova/whisper-tiny.en',
): AsyncIterable<{ text: string; done: boolean }> {
  const asr = await loadPipeline('automatic-speech-recognition', model);
  const chunks = chunk(audio, { seconds: 10 });
  for (const [i, c] of chunks.entries()) {
    const out = await asr(c);
    yield { text: (out as { text: string }).text, done: i === chunks.length - 1 };
  }
}
```

Consumer:

```svelte
<script lang="ts">
  import { transcribeStream } from '@sveltesentio/ai/on-device/stream';

  let transcript = $state('');

  async function run(audio: ArrayBuffer) {
    for await (const { text, done } of transcribeStream(audio)) {
      transcript += text + (done ? '' : ' ');
    }
  }
</script>

<output role="log" aria-live="polite">{transcript}</output>
```

`role="log" aria-live="polite"` — same SR contract as
[sse.md](sse.md). Never `role="alert"` on streaming transcripts.

## Self-hosting models

HF hub is fine for prototyping. Production should self-host — avoids
CDN outages affecting your app, avoids HF rate limits, avoids leaking
user IPs to a third party.

```ts
import { env } from '@huggingface/transformers';

env.allowRemoteModels = false;
env.localModelPath = '/models/';       // served from your origin
```

Mirror the HF repo structure: `/models/Xenova/<model>/<files>`. A
nightly job syncs from HF; `git-lfs` or `s5cmd` to a bucket fronted by
your CDN. **Pin model hashes** — silent upstream changes produce
silent behavior shifts.

## Schema-validate at the inference boundary

Raw model outputs are `unknown` shapes — wrap with Zod before consuming
(see [schemas.md](schemas.md)):

```ts
import { z } from 'zod';

const ClassificationResult = z.object({
  label: z.string(),
  score: z.number().min(0).max(1),
});

const [raw] = await classifier(text) as unknown[];
const parsed = ClassificationResult.parse(raw);
```

Zod catches upstream-version breakage — `transformers` minor bumps
can change output shape (e.g. tuple → object). Boundary validation
makes the break loud instead of silent.

## Memory + cache management

Models live in browser cache (IndexedDB via `transformers.js`
internal cache). Hundreds of MB accumulate across tabs / sites.

```ts
import { env } from '@huggingface/transformers';

env.useBrowserCache = true;            // default; IndexedDB-backed
env.useFSCache = false;                // Node-only; no-op in browser
env.cacheDir = undefined;              // default
```

Eviction controls:

```ts
export async function purgeModels() {
  if (!('storage' in navigator)) return;
  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    if (db.name?.startsWith('transformers-cache')) {
      indexedDB.deleteDatabase(db.name);
    }
  }
}
```

Expose in settings: "Clear AI model cache (300 MB)". Users will ask
when storage fills.

Request persistent storage so cached models survive eviction:

```ts
if ('storage' in navigator && 'persist' in navigator.storage) {
  await navigator.storage.persist();
}
```

Mirrors the pattern in [collab-persistence.md](collab-persistence.md).

## Audit-hook integration

On-device inference is not exempt from compliance logging. Wire the
same `onAudit` from [ai-audit-hook.md](ai-audit-hook.md):

```ts
import { emit } from '@sveltesentio/ai/audit';

const correlationId = crypto.randomUUID();
await emit({
  timestamp: new Date().toISOString(),
  kind: 'prompt',
  provider: 'on-device',                       // distinguishes from anthropic/ollama
  model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
  correlationId,
  userId: session?.user.id,
}, onAudit);
```

Client-side `onAudit` ships to your server-proxy — or buffers + flushes
periodically. Don't skip audit on-device: EU AI Act Art. 12 is about
the system behaviour, not the runtime location.

## SSR guards

Transformers.js is browser-only — ONNX Runtime Web assumes `window` +
WebAssembly. Gate every import:

```ts
import { browser } from '$app/environment';

if (browser) {
  const { loadPipeline } = await import('@sveltesentio/ai/on-device');
  classifier = await loadPipeline('text-classification', 'Xenova/…');
}
```

Or use SvelteKit dynamic import in `+page.ts` with `ssr: false`:

```ts
// +page.ts
export const ssr = false;
```

For pages that are genuinely AI-only, disabling SSR is cleaner than
guarding every import.

## Migration from `@xenova/transformers`

| Before | After |
|---|---|
| `pnpm add @xenova/transformers` | `pnpm add @huggingface/transformers` |
| `import { pipeline } from '@xenova/transformers'` | `import { pipeline } from '@huggingface/transformers'` |
| `env` API | Unchanged |
| Model paths (`Xenova/…`) | Unchanged (HF mirrored the namespace) |
| Peer dep: ONNX Runtime Web 1.17 | Bumped to 1.19+ (WebGPU mature) |

Codemod:

```bash
# in repo root
rg -l '@xenova/transformers' --type ts --type svelte \
  | xargs sed -i 's|@xenova/transformers|@huggingface/transformers|g'
pnpm remove @xenova/transformers
pnpm add @huggingface/transformers
```

Validate: `pnpm typecheck && pnpm test`. Output shapes are
compatible; any drift surfaces through Zod at the boundary.

## Performance notes

- **First inference is slow** — ONNX graph compile, ~1-3 s. Warm the
  pipeline on idle (requestIdleCallback) after page interactive.
- **Batch where possible.** Classifying 100 sentences in one call is
  ~10× faster than 100 calls.
- **Quantisation matters.** The `*-quantized.onnx` weights are half
  the size and 1.5× faster at ~1% accuracy cost. Default on HF
  repos is quantised; only override with `quantized: false` when
  accuracy is critical.
- **WebGPU warm-up cost is real.** First WebGPU call spins up adapter
  + shaders (~200 ms). Budget it into UX.

## Testing

Unit tests run in Node via the WASM backend (no WebGPU in jsdom):

```ts
import { pipeline } from '@huggingface/transformers';

test('classifier returns a label', async () => {
  const classifier = await pipeline('text-classification',
    'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    { device: 'wasm', quantized: true });
  const [out] = await classifier('I love this!');
  expect(out).toMatchObject({ label: 'POSITIVE', score: expect.any(Number) });
}, 60_000); // model download + warm-up
```

Mark model-loading tests as long-running; CI should cache the
transformers IndexedDB/FS cache across runs to avoid re-downloading
every time. Use a Playwright integration test for WebGPU paths (real
browser), not jsdom.

## Anti-patterns

- **Auto-download on mount.** Ships tens of MB without user consent.
  Gate behind an explicit button or fully-loaded-page idle trigger.
- **Rebuilding the pipeline per call.** Pipelines are expensive to
  construct; reuse. Consider a module-scoped cache.
- **`@xenova/transformers`.** Frozen 2024; no security patches; not
  receiving bug fixes. Migrate.
- **No progress UI.** SR users can't see a spinner and sighted users
  see nothing for 30 s. Always expose `progress_callback`.
- **Skipping WebGPU detection.** Firefox ≤ 140 crashes on `requestAdapter`
  in some configs — always `try/catch` + fall back to WASM.
- **HF hub in production.** Third-party dependency in the critical
  path. Self-host + pin hashes.
- **No audit-hook wiring.** On-device feels "just JS in the browser"
  but EU AI Act Art. 12 still applies. Correlation-log every
  inference.
- **`{@html output}` without sanitisation.** Model outputs are
  external data. DOMPurify per [markdown.md](markdown.md) before
  HTML insertion.
- **Swallowing `ERR_QUOTA_EXCEEDED` from cache.** User's storage
  quota filled — show a settings-links error, don't silently retry.
- **Shipping WebLLM weights as on-device-AI.** WebLLM LLM weights
  are 1-4 GB — wrong tool. Use `docs/compose/ai-in-browser-llm.md`
  (pending) for LLM-specific flows.
- **Trusting client-reported model outputs server-side.** If the
  server makes decisions based on the model result, re-run
  server-side. On-device is UX, not trust anchor.

## References

- ADR-0044 — `@huggingface/transformers@^4.1` on-device AI.
- ADR-0045 — AI audit hook + Zod schema.
- ADR-0043 — AI server-proxy posture (complement).
- ADR-0023 — UUIDv7 correlation IDs.
- [ai-audit-hook.md](ai-audit-hook.md) — audit every inference.
- [schemas.md](schemas.md) — Zod at boundaries.
- [sse.md](sse.md) — `role="log"` streaming SR contract.
- [collab-persistence.md](collab-persistence.md) — persistent-storage
  pattern mirror.
- Transformers.js docs: <https://huggingface.co/docs/transformers.js>.
- WebGPU MDN: <https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API>.
- `docs/compliance/eu-ai-act.md` — Art. 12 applies on-device too.
