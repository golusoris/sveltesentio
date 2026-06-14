# Vercel AI SDK — opt-in for tool-calling + provider abstraction

[ADR-0043](../adr/0043-ai-server-proxy-only.md) explicitly evaluates
Vercel AI SDK and holds it **opt-in**, not framework default. The
SDK overlaps with our realtime + query layers
([sse.md](sse.md), [server-state.md](server-state.md)), so the
default path uses raw provider SDKs +
[ai-streaming.md](ai-streaming.md). When tool-calling /
provider abstraction / structured-output schema-first dev is the
critical path, Vercel AI SDK is worth the bundle.

This recipe documents when to reach for it, the
`+server.ts` integration pattern that satisfies the ADR-0043
server-only rule, the `useChat()` / `useCompletion()` runes wrappers,
and the boundary contract that keeps audit + correlation intact.

Related: [ai-streaming.md](ai-streaming.md) (default path — provider
SDK direct), [ai-audit-hook.md](ai-audit-hook.md) (mandatory audit
emit), [ai-on-device.md](ai-on-device.md) +
[ai-in-browser-llm.md](ai-in-browser-llm.md) (no-server siblings),
[schemas.md](schemas.md) (Zod for structured output),
[observability.md](observability.md) (correlation IDs).

## When Vercel AI SDK earns its bundle

| Need | Default ([ai-streaming.md](ai-streaming.md)) | Vercel AI SDK |
|---|---|---|
| Single provider (Anthropic OR Ollama) | ✅ smaller | overkill |
| Multi-provider with runtime selection | ⚠️ glue code | ✅ unified |
| Tool / function calling | ⚠️ hand-roll | ✅ first-class |
| Structured output (JSON-schema-typed) | ⚠️ Zod manual | ✅ `streamObject` |
| Multi-step agent loops | ⚠️ hand-roll | ✅ `maxSteps` |
| Resumable / multi-tab streams | ⚠️ build it | ✅ `experimental_resume` |
| Bundle-size critical | ✅ ~30 KB | ❌ ~120 KB ai/core + provider |

Default to the raw-SDK path. Reach for AI SDK when **two or more**
of: multi-provider, tool-calling, structured output, agent loops.

## Install

```bash
pnpm add ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/ollama
# UI bindings (optional — runes wrappers below avoid the React lineage)
pnpm add @ai-sdk/svelte
```

`ai` is the core package. Provider packages (`@ai-sdk/anthropic`,
`@ai-sdk/openai`, `@ai-sdk/ollama`, `@ai-sdk/google`) are
swappable — pin only what you use.

`@ai-sdk/svelte` ships `useChat` / `useCompletion` for Svelte 5;
verify the version supports runes (≥ 4.x at time of writing).

## ESLint guard — server-only

Per [ai-streaming.md](ai-streaming.md), provider SDKs and the AI
SDK provider modules must not import in client code:

```js
// eslint.config.js (excerpt)
{
  files: ['src/lib/**/*.{ts,svelte}', 'src/routes/**/*.svelte'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        '@ai-sdk/anthropic', '@ai-sdk/openai', '@ai-sdk/ollama',
        '@ai-sdk/google', '@ai-sdk/mistral',
      ],
      paths: [
        { name: 'ai', importNames: ['generateText', 'streamText', 'generateObject', 'streamObject'],
          message: 'Server-only per ADR-0043. Move generation/streaming to +server.ts.' },
      ],
    }],
  },
}
```

`@ai-sdk/svelte` is **client-safe** — `useChat` only hits your own
`+server.ts` endpoint, never a provider directly.

## `+server.ts` — `streamText` pattern

```ts
// src/routes/api/ai/chat/+server.ts
import type { RequestHandler } from './$types';
import { streamText, convertToCoreMessages } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { uuidv7 } from '@sveltesentio/core/id';
import { emit } from '@sveltesentio/ai/audit';

const ChatRequest = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().min(1).max(10_000),
  })).min(1).max(50),
});

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = locals.session;
  if (!session) return new Response('Unauthorized', { status: 401 });

  const parsed = ChatRequest.safeParse(await request.json());
  if (!parsed.success) {
    return new Response(JSON.stringify({
      type: 'urn:sveltesentio:ai:invalid-request',
      title: 'Invalid request', status: 400, detail: parsed.error.message,
      extensions: { correlationId: locals.correlationId },
    }), { status: 400, headers: { 'Content-Type': 'application/problem+json' } });
  }

  const correlationId = uuidv7();
  await emit({
    timestamp: new Date().toISOString(),
    kind: 'prompt', provider: 'anthropic', model: 'claude-opus-4-7',
    correlationId, userId: session.user.id,
  }, locals.onAudit);

  const result = streamText({
    model: anthropic('claude-opus-4-7'),
    messages: convertToCoreMessages(parsed.data.messages),
    abortSignal: request.signal,                 // propagate client disconnect
    onFinish: async ({ usage }) => {
      await emit({
        timestamp: new Date().toISOString(),
        kind: 'response', provider: 'anthropic', model: 'claude-opus-4-7',
        correlationId, userId: session.user.id,
        metadata: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens },
      }, locals.onAudit);
    },
    onError: async ({ error }) => {
      await emit({
        timestamp: new Date().toISOString(),
        kind: 'error', provider: 'anthropic', model: 'claude-opus-4-7',
        correlationId, userId: session.user.id,
        metadata: { message: String(error) },
      }, locals.onAudit);
    },
  });

  return result.toDataStreamResponse({
    headers: { 'X-Correlation-Id': correlationId },
  });
};
```

Five invariants ported from [ai-streaming.md](ai-streaming.md):

1. **Zod request validation** at the boundary.
2. **Session check** before provider call.
3. **`abortSignal: request.signal`** so AI SDK aborts upstream when
   the client disconnects (the equivalent of the manual `cancel()`
   in the raw-SDK pattern).
4. **`onFinish` + `onError` audit emit** with usage tokens captured
   for cost tracking.
5. **`X-Correlation-Id` response header.**

## Client-side — `@ai-sdk/svelte` + `useChat`

```svelte
<!-- src/lib/ai/Chat.svelte -->
<script lang="ts">
  import { useChat } from '@ai-sdk/svelte';
  import { sanitizeMarkdown } from '@sveltesentio/ui/markdown';

  const chat = useChat({
    api: '/api/ai/chat',
    onError: (err) => console.error('[ai-vercel] stream failed', err),
  });
</script>

<ol role="log" aria-live="polite" aria-relevant="additions">
  {#each chat.messages as msg, i (i)}
    <li class={msg.role}>
      {#if msg.role === 'assistant'}
        {@html sanitizeMarkdown(msg.content)}
      {:else}
        {msg.content}
      {/if}
    </li>
  {/each}
</ol>

<form onsubmit={chat.handleSubmit}>
  <textarea bind:value={chat.input}
            disabled={chat.isLoading}
            onkeydown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                chat.handleSubmit();
              }
            }}></textarea>
  <button type="submit" disabled={chat.isLoading}>Send</button>
  {#if chat.isLoading}
    <button type="button" onclick={chat.stop}>Stop</button>
  {/if}
</form>

{#if chat.error}
  <p role="alert">Failed: {chat.error.message}</p>
{/if}
```

Three notes:

- **Same `role="log" aria-live="polite"` SR contract** as
  [sse.md](sse.md) and the default chat in
  [ai-streaming.md](ai-streaming.md).
- **`{@html sanitizeMarkdown(content)}` not raw.** AI SDK gives you
  the streaming content as a string — sanitise per
  [markdown.md](markdown.md).
- **`chat.stop()` aborts the stream.** Exposed alongside the loading
  state so the UI can offer a stop button.

## Tool calling

Tool calling is where the AI SDK pays for its bundle. Pattern:

```ts
import { streamText, tool } from 'ai';
import { z } from 'zod';

const result = streamText({
  model: anthropic('claude-opus-4-7'),
  messages: convertToCoreMessages(parsed.data.messages),
  maxSteps: 5,                                   // bounded agent loop
  tools: {
    searchOrders: tool({
      description: "Search the user's order history",
      parameters: z.object({
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      execute: async ({ query, limit }, { abortSignal }) => {
        const orders = await db.orders.search({
          userId: session.user.id, query, limit, abortSignal,
        });
        return { orders };
      },
    }),
    placeOrder: tool({
      description: 'Place a new order. Always confirm with user first.',
      parameters: z.object({
        sku: z.string(),
        quantity: z.number().int().positive(),
      }),
      execute: async ({ sku, quantity }) => {
        // Side effect — extra audit + idempotency-key per http-client.md
        return await placeOrderWithIdempotency({
          userId: session.user.id, sku, quantity,
        });
      },
    }),
  },
  onStepFinish: async ({ toolCalls }) => {
    for (const call of toolCalls) {
      await emit({
        timestamp: new Date().toISOString(),
        kind: 'response', provider: 'anthropic', model: 'claude-opus-4-7',
        correlationId, userId: session.user.id,
        metadata: { tool: call.toolName, args: 'redacted' },
      }, locals.onAudit);
    }
  },
});
```

Five tool-calling rules:

1. **`maxSteps` bounded.** Without it, the model can chain
   indefinitely → runaway billing.
2. **Tool parameters are Zod schemas.** AI SDK validates the
   model's args before calling `execute`. No `any`.
3. **Tool `execute` runs server-side.** Same trust boundary as the
   `+server.ts` route — session is in scope, db is available.
4. **Side-effect tools (`placeOrder`) need idempotency keys** per
   [http-client.md](http-client.md). Models occasionally re-call
   tools.
5. **Audit each tool call** with `kind: 'response'` and the tool
   name in metadata. Compliance traces full agent loops.

## Structured output — `streamObject` / `generateObject`

```ts
import { streamObject } from 'ai';
import { z } from 'zod';

const Plan = z.object({
  title: z.string(),
  steps: z.array(z.object({
    description: z.string(),
    estimateMinutes: z.number().int().positive(),
  })).min(1).max(20),
});

const { partialObjectStream } = streamObject({
  model: anthropic('claude-opus-4-7'),
  schema: Plan,
  prompt: 'Plan a weekend trip to Lisbon',
});

for await (const partial of partialObjectStream) {
  // partial is Partial<Plan> — incremental as the model streams JSON
  send({ kind: 'object-update', partial });
}
```

Schema-first generation eliminates the "did the model return valid
JSON?" failure mode the raw-SDK path faces. The AI SDK retries +
re-prompts on schema mismatch.

For one-shot non-streaming output, `generateObject` returns the
fully-validated value:

```ts
const { object } = await generateObject({ model, schema: Plan, prompt });
// object is typed Plan — no manual safeParse
```

## Provider switching

```ts
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { ollama } from '@ai-sdk/ollama';

const providers = {
  anthropic: () => anthropic('claude-opus-4-7'),
  openai: () => openai('gpt-4o'),
  ollama: () => ollama('llama3.2'),
} satisfies Record<string, () => LanguageModel>;

const model = providers[parsed.data.provider]();
```

Per [ai-audit-hook.md](ai-audit-hook.md), the audit `provider` field
distinguishes downstream — sinks can route by provider.

Cost / latency / capability differ wildly. Surface the choice in
the UI and let the user pick — don't auto-fallback silently.

## Resumable streams (multi-tab)

The AI SDK's `experimental_resume` lets a stream survive page reloads
+ multi-tab handoff:

```ts
const { resumableStream } = await streamText({ /* ... */ });
return resumableStream.toDataStreamResponse({
  headers: { 'X-Correlation-Id': correlationId },
});
```

Server stores partial state in Redis / Postgres / Upstash. Client
re-attaches via the same stream ID. Useful for long agent loops
that exceed the user's session.

Trade-off: state-store dep + recovery complexity. Default to
non-resumable; opt in only when long sessions matter.

## Audit-hook integration

`onFinish` + `onError` are the two hook points; supplement with
`onStepFinish` for tool-call boundaries. Three emissions per
session = same contract as [ai-audit-hook.md](ai-audit-hook.md):

| Boundary | Hook |
|---|---|
| Prompt | At route entry (before `streamText`) |
| Each tool call | `onStepFinish` per toolCalls element |
| Response | `onFinish` with usage |
| Error | `onError` |

The AI SDK abstracts away the SSE wire format, but **the audit
contract doesn't change**. Same `AiAuditEvent` shape, same
correlation thread.

## Cost tracking

`onFinish` exposes `usage: { promptTokens, completionTokens }`.
Wire to a per-user spend tracker:

```ts
onFinish: async ({ usage }) => {
  await db.aiUsage.add({
    userId: session.user.id,
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    correlationId,
  });
  // pair with rate-limit + monthly budget cap
},
```

Pair with the rate-limit pattern in
[ai-streaming.md](ai-streaming.md). LLM bills add up fast.

## Testing

Mock the `LanguageModel` interface — AI SDK ships a test provider:

```ts
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV1 } from 'ai/test';

const model = new MockLanguageModelV1({
  doStream: async () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: 'text-delta', textDelta: 'Hello ' },
        { type: 'text-delta', textDelta: 'world' },
        { type: 'finish', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 2 } },
      ],
    }),
    rawCall: { rawPrompt: '', rawSettings: {} },
  }),
});

const result = streamText({ model, prompt: 'hi' });
const text = await result.text;
expect(text).toBe('Hello world');
```

Real-provider integration tests run nightly only — too expensive
per-PR.

## Migration from raw-SDK ([ai-streaming.md](ai-streaming.md))

Mechanical:

1. `pnpm add ai @ai-sdk/anthropic` (or your provider).
2. Replace `new Anthropic({ apiKey })` + manual stream loop with
   `streamText({ model: anthropic('...'), ... })`.
3. Replace manual `controller.enqueue` SSE writer with
   `result.toDataStreamResponse()`.
4. Wire `onFinish` / `onError` for audit (move out of try/catch).
5. Switch client from `fetch(POST) + ReadableStream` reader to
   `useChat({ api: '/api/ai/chat' })` from `@ai-sdk/svelte`.
6. `Migration:` footer documents the bundle increase + the
   tool-calling / structured-output capability gain.

Migrate per route, not en masse. The raw-SDK path stays valid for
chat-only routes that don't need tools.

## Anti-patterns

- **AI SDK as framework default.** ADR-0043 holds it opt-in. Raw
  SDK + [ai-streaming.md](ai-streaming.md) is the default.
- **Provider package imported in `src/lib/**` or `+page.svelte`.**
  Same boundary violation as raw provider SDKs. ESLint gates.
- **`generateText` / `streamText` / `streamObject` in client code.**
  ESLint blocks via `importNames` rule.
- **No `maxSteps` on tool-calling.** Runaway agent loops bill at
  $$/step. Always cap (5-10 typical).
- **Tool `execute` mutating without idempotency key.** Models
  occasionally re-call. Pair with `Idempotency-Key` per
  [http-client.md](http-client.md).
- **Tool parameters typed as `z.any()` / `z.unknown()`.** Loses the
  validation that justifies the bundle. Strict Zod.
- **Skipping `onError` audit.** Compliance gap; provider failures
  must log too.
- **`{@html chat.messages[i].content}` raw.** Model output is
  external data. DOMPurify per [markdown.md](markdown.md).
- **No `abortSignal: request.signal`.** Provider keeps tokenising
  after client disconnect → billable waste.
- **Resumable streams without state-store cleanup.** Stale state
  accumulates → Redis / Postgres bloat.
- **Provider auto-fallback on failure** (Anthropic down → silently
  retry OpenAI). Costs/latency/capability differ; surface the
  choice.
- **`onFinish` audit without usage capture.** No cost tracking →
  budget breakage. Always emit `promptTokens` + `completionTokens`.

## References

- ADR-0043 — AI provider SDKs server-only; AI SDK held opt-in.
- ADR-0045 — AI audit hook + Zod schema.
- ADR-0023 — UUIDv7 correlation IDs.
- [ai-streaming.md](ai-streaming.md) — default raw-SDK path.
- [ai-audit-hook.md](ai-audit-hook.md) — three-emission audit
  contract (unchanged).
- [http-client.md](http-client.md) — `Idempotency-Key` for
  side-effect tools.
- [markdown.md](markdown.md) — sanitise model output before render.
- [schemas.md](schemas.md) — Zod for tool params + structured
  output.
- [observability.md](observability.md) — correlation thread.
- Vercel AI SDK docs: <https://sdk.vercel.ai/docs>.
- `@ai-sdk/svelte`: <https://sdk.vercel.ai/docs/reference/ai-sdk-ui/use-chat>.
