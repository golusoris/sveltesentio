# AI streaming — `+server.ts` provider proxy + `useSSE` consumer

ADR-0043 makes one rule absolute: **AI provider SDKs are
server-only**. `@anthropic-ai/sdk`, `ollama`, `ollama-js` never
ship in a browser bundle — credentials would leak, and the SSE
transport already owned by ADR-0037 is the right way to push tokens
to the UI.

This recipe is the explicit doc obligation from
[ADR-0043](../adr/0043-ai-server-proxy-only.md): the
`+server.ts` proxy pattern + the `useSSE` consumer + the
ESLint rule that prevents regressions.

Related: [sse.md](sse.md) (transport), [http-client.md](http-client.md)
(RFC 9457 errors), [ai-audit-hook.md](ai-audit-hook.md) (audit
every prompt + response), [ai-on-device.md](ai-on-device.md) +
[ai-in-browser-llm.md](ai-in-browser-llm.md) (no-server
alternatives), [observability.md](observability.md)
(correlation IDs).

## The boundary

```text
Browser                              SvelteKit server                       Provider
───────                              ────────────────                       ────────
useSSE('/api/ai/chat') ──────────►   +server.ts (POST then SSE)
                                       │
                                       ├── @anthropic-ai/sdk  ─────────► api.anthropic.com
                                       ├── ollama (over Unix sock) ────► localhost:11434
                                       └── @sveltesentio/ai/server
                                              ↓
                                       audit-hook + Zod boundary
                                              ↓
                                       text/event-stream  ◄────────────── stream tokens
```

Browser only ever talks to your origin. The provider only ever talks
to your server. Two CORS boundaries, zero credential leaks.

## Install

```bash
# server-only
pnpm add @anthropic-ai/sdk ollama
# both server + client
pnpm add @sveltesentio/ai @sveltesentio/realtime
```

ESLint rule (`@sveltesentio/eslint-config` ships this) blocks
`@anthropic-ai/sdk` / `ollama` / `ollama-js` imports from any file
matching `src/lib/**` (client-shared) or `src/routes/**/+page.svelte`
(client-only). Allowed patterns: `+server.ts`, `+page.server.ts`,
`hooks.server.ts`, `src/lib/**/*.server.ts`.

```js
// eslint.config.js (excerpt — sveltesentio preset)
{
  files: ['src/lib/**/*.{ts,svelte}', 'src/routes/**/*.svelte'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        { name: '@anthropic-ai/sdk', message: 'Server-only per ADR-0043. Move to +server.ts.' },
        { name: 'ollama', message: 'Server-only per ADR-0043. Move to +server.ts.' },
        { name: 'ollama-js', message: 'Server-only per ADR-0043. Move to +server.ts.' },
      ],
    }],
  },
}
```

## Server-side endpoint

```ts
// src/routes/api/ai/chat/+server.ts
import type { RequestHandler } from './$types';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { uuidv7 } from '@sveltesentio/core/id';
import { emit } from '@sveltesentio/ai/audit';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const ChatRequest = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(10_000),
  })).min(1).max(50),
  model: z.literal('claude-opus-4-7').default('claude-opus-4-7'),
});

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = locals.session;
  if (!session) return new Response('Unauthorized', { status: 401 });

  const body = await request.json();
  const parsed = ChatRequest.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({
      type: 'urn:sveltesentio:ai:invalid-request',
      title: 'Invalid request', status: 400,
      detail: parsed.error.message,
      extensions: { correlationId: locals.correlationId },
    }), { status: 400, headers: { 'Content-Type': 'application/problem+json' } });
  }

  const correlationId = uuidv7();
  await emit({
    timestamp: new Date().toISOString(),
    kind: 'prompt', provider: 'anthropic', model: parsed.data.model,
    correlationId, userId: session.user.id,
  }, locals.onAudit);

  const stream = await anthropic.messages.stream({
    model: parsed.data.model,
    max_tokens: 4096,
    messages: parsed.data.messages,
  });

  const enc = new TextEncoder();
  let seq = 0;

  const body$ = new ReadableStream({
    async start(controller) {
      const send = (data: unknown, event = 'message') => {
        controller.enqueue(enc.encode(
          `id: ${++seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
        ));
      };

      try {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            send({ kind: 'token', text: chunk.delta.text });
          }
        }
        send({ kind: 'done' }, 'done');
        await emit({
          timestamp: new Date().toISOString(),
          kind: 'response', provider: 'anthropic', model: parsed.data.model,
          correlationId, userId: session.user.id,
        }, locals.onAudit);
      } catch (err) {
        send({ kind: 'error', message: 'provider failed' }, 'error');
        await emit({
          timestamp: new Date().toISOString(),
          kind: 'error', provider: 'anthropic', model: parsed.data.model,
          correlationId, userId: session.user.id,
          metadata: { message: String(err) },
        }, locals.onAudit);
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.controller?.abort();             // honour client disconnect
    },
  });

  return new Response(body$, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
      'X-Correlation-Id': correlationId,
    },
  });
};
```

Eight invariants, each tied to a sibling recipe:

1. **Zod request validation.** External boundary per
   [schemas.md](schemas.md). Cap message count + content length —
   prompt-injection / abuse mitigation.
2. **`session` check before provider call.** No anonymous AI;
   credentials cost money.
3. **`uuidv7()` correlation ID** per
   [observability.md](observability.md) — threads through audit +
   trace + RFC 9457.
4. **`emit` audit at prompt + response + error** per
   [ai-audit-hook.md](ai-audit-hook.md). All three boundaries
   logged with the same `correlationId`.
5. **Three SSE header invariants** per [sse.md](sse.md):
   `no-cache, no-transform`, `X-Accel-Buffering: no`,
   `Connection: keep-alive`.
6. **`id:` field on every chunk** so browser `EventSource` can
   `Last-Event-ID` resume.
7. **Discriminated `kind` field** so the consumer Zod-parses
   exhaustively (`token` / `done` / `error`).
8. **`cancel()` aborts the upstream stream.** Without this, the
   provider keeps tokenising after the user navigates away —
   billable waste + unbounded process lifetime.

## Client-side consumer

```svelte
<!-- src/lib/ai/Chat.svelte -->
<script lang="ts">
  import { useSSE } from '@sveltesentio/realtime/sse';
  import { sanitizeMarkdown } from '@sveltesentio/ui/markdown';
  import { z } from 'zod';

  type Msg = { role: 'user' | 'assistant'; content: string };
  let messages = $state<Msg[]>([]);
  let composer = $state('');
  let streaming = $state(false);

  const Frame = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('token'), text: z.string() }),
    z.object({ kind: z.literal('done') }),
    z.object({ kind: z.literal('error'), message: z.string() }),
  ]);

  let sse: ReturnType<typeof useSSE> | null = null;

  function send() {
    if (!composer.trim() || streaming) return;
    const userMsg: Msg = { role: 'user', content: composer };
    messages.push(userMsg);
    const assistantMsg: Msg = { role: 'assistant', content: '' };
    messages.push(assistantMsg);
    const idx = messages.length - 1;
    composer = '';
    streaming = true;

    // POST messages then connect to SSE — two-step keeps payload off the URL
    fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.slice(0, -1) }),
    }).then((r) => {
      if (!r.body) throw new Error('no stream');
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      function pump(): Promise<void> {
        return reader.read().then(({ done, value }) => {
          if (done) { streaming = false; return; }
          buf += dec.decode(value, { stream: true });
          for (const event of parseSSE(buf)) {
            const f = Frame.safeParse(JSON.parse(event.data));
            if (!f.success) continue;
            if (f.data.kind === 'token') messages[idx].content += f.data.text;
            else if (f.data.kind === 'error') console.error('[ai-stream]', f.data.message);
          }
          buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
          return pump();
        });
      }
      return pump();
    }).catch(() => { streaming = false; });
  }
</script>

<ol role="log" aria-live="polite" aria-relevant="additions">
  {#each messages as m, i (i)}
    <li class={m.role}>
      {#if m.role === 'assistant'}
        {@html sanitizeMarkdown(m.content)}
      {:else}
        {m.content}
      {/if}
    </li>
  {/each}
</ol>

<form onsubmit={(e) => { e.preventDefault(); send(); }}>
  <textarea bind:value={composer} disabled={streaming}></textarea>
  <button type="submit" disabled={streaming}>Send</button>
</form>
```

Note: this uses `fetch` + `ReadableStream` rather than
`new EventSource()` because **`EventSource` is GET-only** — a chat
prompt is too big for a query string. Two patterns address this:

| Pattern | When |
|---|---|
| `fetch(POST) + ReadableStream` reading `text/event-stream` | Long prompts; this recipe |
| `POST /api/ai/chat/start` returning a `chatId` then `useSSE('/api/ai/chat/:id')` | Resume on reconnect; multi-tab |

The two-step ID pattern wins when `Last-Event-ID` resume matters.

## RFC 9457 errors

Per [http-client.md](http-client.md), provider failures map to
problem responses with `extensions.correlationId`:

```ts
// inside +server.ts catch
return new Response(JSON.stringify({
  type: 'urn:sveltesentio:ai:provider-failed',
  title: 'AI provider failure', status: 502,
  detail: 'Upstream model temporarily unavailable',
  extensions: { correlationId, providerCode: err.status ?? null },
}), {
  status: 502,
  headers: {
    'Content-Type': 'application/problem+json',
    'X-Correlation-Id': correlationId,
  },
});
```

Never leak provider error messages verbatim — they may include
account IDs / rate-limit headers / prompt fragments. Map to
sveltesentio problem URIs.

## Audit-hook integration

Per [ai-audit-hook.md](ai-audit-hook.md), three audit emissions per
request:

```ts
// at request entry
await emit({ kind: 'prompt', correlationId, /* … */ }, onAudit);

// after stream completes
await emit({ kind: 'response', correlationId, /* … */ }, onAudit);

// in catch
await emit({ kind: 'error', correlationId, /* … */ }, onAudit);
```

`retain: 'none'` is the default — neither prompt nor response stored.
Override per route with `retain: 'hash'` (compliance / debugging) or
`retain: 'full'` (requires documented lawful basis):

```ts
await emit({
  kind: 'prompt', correlationId, /* … */
  input: parsed.data.messages.map((m) => m.content).join('\n'),
  // emit() respects opts.retain to hash or drop
}, onAudit, { retain: 'hash', reason: 'EU AI Act Art. 12 — high-risk system' });
```

## Backpressure + abuse

Per-user rate limit is mandatory (provider bills you):

```ts
import { ratelimit } from '$lib/ratelimit';   // your impl

const rl = await ratelimit.check(`ai:${session.user.id}`, { window: '1m', limit: 10 });
if (!rl.ok) {
  return new Response('Too many requests', { status: 429, headers: {
    'Retry-After': String(rl.resetSeconds),
  }});
}
```

Tiers:

- Per-user per-minute (10 prompts).
- Per-user per-day (200 prompts).
- Global per-minute kill-switch via env var.

Long-running streams — clients can disconnect without notifying the
server. Set a server-side timeout (`AbortSignal.timeout(120_000)`) so
zombie streams free up sockets.

## Ollama variant

Same shape, different SDK:

```ts
import ollama from 'ollama';

const stream = await ollama.chat({
  model: 'llama3.2',
  messages: parsed.data.messages,
  stream: true,
});

for await (const chunk of stream) {
  send({ kind: 'token', text: chunk.message.content });
}
```

Per ADR-0043 D133, `ollama` runs on a private network — never
expose `localhost:11434` cross-origin. The `+server.ts` proxy is
the only exposure.

## Vercel AI SDK held opt-in

Per ADR-0043, Vercel AI SDK is **opt-in** — not the default. It
overlaps with the realtime + query layers. If you adopt it,
follow `docs/compose/ai-vercel-sdk.md` (pending).

This recipe uses raw provider SDKs because the SSE wire format +
`useSSE` consumer + Zod boundaries already cover the interesting
cases without a fourth abstraction layer.

## Testing

Server-side: mock the provider SDK:

```ts
import { vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: async () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello ' } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } };
        },
      }),
    };
  },
}));
```

Hit the route with a real fetch + read the SSE stream:

```ts
test('ai chat streams tokens', async () => {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  });
  const text = await res.text();
  expect(text).toMatch(/"kind":"token","text":"hello "/);
  expect(text).toMatch(/event: done/);
});
```

Client-side: mock the SSE response body via `msw` or a local server
harness. Same pattern as [sse.md](sse.md).

## Anti-patterns

- **Provider SDK imported in `src/lib/**`.** Credentials in browser
  bundle. ESLint rule blocks; if you suppress, document why and
  re-open ADR-0043.
- **`@anthropic-ai/sdk` in `+page.svelte`.** Same. Linter catches.
- **Bare provider error message returned to client.** May leak
  account details. Map to RFC 9457.
- **No request validation.** External input straight to provider —
  prompt-injection, runaway billing. Cap message count + length.
- **No rate limit.** First abuse incident costs $$$. Per-user per-
  minute + per-day + global kill-switch.
- **No `cancel()` honouring client disconnect.** Provider keeps
  tokenising after navigation. Wire `controller.abort()`.
- **`{@html assistantContent}` raw.** Model output is external data.
  DOMPurify or plaintext per [markdown.md](markdown.md).
- **Skipping audit emit on error.** Compliance gap — error class
  matters too. All three boundaries.
- **`useSSE` directly without POST.** `EventSource` is GET-only;
  chat prompts don't fit URLs. `fetch(POST) + ReadableStream` or
  two-step start-then-resume.
- **No `X-Correlation-Id` header on response.** Browser bug reports
  arrive without a join key. Mandatory.
- **Returning provider's `model` as user-facing string.** Model
  names change; abstract behind sveltesentio's `model: 'sveltesentio:default'`
  if your UI surfaces them.
- **Bypassing the `+server.ts` proxy "just for prototyping".**
  Prototype habit becomes production bug. ESLint blocks at PR.

## References

- ADR-0043 — AI provider SDKs are server-proxy-only (this recipe's
  governing ADR).
- ADR-0037 — SSE / `useSSE` ownership.
- ADR-0045 — AI audit hook.
- ADR-0023 — UUIDv7 correlation IDs.
- [sse.md](sse.md) — SSE transport + headers.
- [ai-audit-hook.md](ai-audit-hook.md) — three-emission audit
  contract.
- [http-client.md](http-client.md) — RFC 9457 with
  `extensions.correlationId`.
- [observability.md](observability.md) — correlation thread.
- [markdown.md](markdown.md) — sanitise model output before
  `{@html}`.
- [schemas.md](schemas.md) — Zod at boundaries.
- [ai-on-device.md](ai-on-device.md) +
  [ai-in-browser-llm.md](ai-in-browser-llm.md) — server-free
  alternatives.
- Anthropic SDK: <https://docs.anthropic.com/en/api/client-sdks>.
- Ollama HTTP API: <https://github.com/ollama/ollama/blob/main/docs/api.md>.
