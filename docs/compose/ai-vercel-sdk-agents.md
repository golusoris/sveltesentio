# AI agents — Vercel AI SDK multi-step tool loops + MCP integration

Extends [ai-vercel-sdk.md](ai-vercel-sdk.md) with the **agent loop**
pattern: a multi-step LLM conversation where the model calls tools,
observes results, and continues until it produces a final answer (or
hits a step cap). Same `streamText` primitive, extra `maxSteps`,
extra tool contract, extra observability.

Agents earn their complexity **only** when the task actually requires
iterative tool use (find record → fetch related → decide → act).
Single-call tool-use (answer one question with one tool) belongs in
[ai-vercel-sdk.md](ai-vercel-sdk.md), not here.

## Related

- [ai-vercel-sdk.md](ai-vercel-sdk.md) — base Vercel AI SDK usage,
  `streamText`, client `useChat`.
- [ai-streaming.md](ai-streaming.md) — raw-SDK streaming default.
- [ai-audit-hook.md](ai-audit-hook.md) — per-step audit emits.
- [schemas.md](schemas.md) — Zod at every boundary (tool parameters,
  tool results, MCP responses).
- [observability.md](observability.md) — UUIDv7 correlation + span per
  step.
- [http-client.md](http-client.md) — openapi-fetch for tool
  `execute` bodies.
- [ADR-0043](../adr/0043-ai-server-proxy-only.md) — server-proxy
  rule (all provider SDK use server-side).

## When to use agents

```text
One LLM call + one tool result → done         → ai-vercel-sdk.md (not this)
User-facing chat with incidental tool use     → ai-vercel-sdk.md
Task that needs iterative lookup + action     → AGENT LOOP (this recipe)
Scheduled background task (no user waiting)   → AGENT LOOP + job queue
Research / planning / multi-document synth    → AGENT LOOP
"Build me a ___" freeform generation          → reject; too much agency
```

Four hard rules before reaching for an agent loop:

1. **The task has a verifiable success criterion.** Agents hallucinate
   completion; you need a Zod schema or structured output to assert
   "done".
2. **All tools are idempotent or carry `Idempotency-Key`.** Agents
   retry on stream interrupts; non-idempotent tools double-side-effect.
3. **There's a hard `maxSteps` cap.** Runaway agents burn API budget.
4. **Every step is auditable per [ai-audit-hook.md](ai-audit-hook.md).**
   EU AI Act Art. 12 applies to every LLM decision — step-level, not
   conversation-level.

## Install

Same as [ai-vercel-sdk.md](ai-vercel-sdk.md). For MCP add:

```bash
pnpm add @modelcontextprotocol/sdk
```

MCP (Model Context Protocol) is the emerging standard for exposing
tools / resources to LLMs over a typed protocol. Anthropic + OpenAI +
others adopted it during 2025. The Vercel AI SDK gained
`experimental_createMCPClient` for consuming MCP servers as a
tool-source.

## Reference `+server.ts` — agent endpoint

```ts
// src/routes/api/agents/research/+server.ts
import { anthropic } from '@ai-sdk/anthropic';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { v7 as uuid } from 'uuid';
import type { RequestHandler } from './$types';
import { auditPrompt, auditStep, auditError } from '$lib/server/ai/audit';
import { tracer } from '$lib/server/telemetry';
import { requireSession } from '$lib/server/auth';
import { rateLimit } from '$lib/server/rate-limit';

const RequestBody = z.object({
  prompt: z.string().min(1).max(4000),
  scope: z.enum(['customer', 'internal']).default('customer'),
});

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = requireSession(locals);
  await rateLimit.agents.check(session.user.id);

  const parsed = RequestBody.safeParse(await request.json());
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid' }), {
      status: 400,
      headers: { 'Content-Type': 'application/problem+json' },
    });
  }

  const correlationId = uuid();
  const conversationId = uuid();

  return tracer.startActiveSpan('agent.research', async (span) => {
    span.setAttributes({
      'agent.scope': parsed.data.scope,
      'correlation.id': correlationId,
      'conversation.id': conversationId,
      'user.id.hashed': session.user.hashedId,
    });

    auditPrompt({
      correlationId,
      userId: session.user.id,
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      input: { prompt: parsed.data.prompt, scope: parsed.data.scope },
      retain: 'hash',
      reason: 'agent-conversation-root',
    });

    const result = streamText({
      model: anthropic('claude-opus-4-7'),
      abortSignal: request.signal,
      maxSteps: 8,
      system: systemPrompt(parsed.data.scope),
      prompt: parsed.data.prompt,
      tools: agentTools(session, correlationId),
      onStepFinish: ({ text, toolCalls, toolResults, finishReason, usage, stepType }) => {
        auditStep({
          correlationId,
          conversationId,
          stepType,
          finishReason,
          usage,
          toolCalls: toolCalls.map((c) => ({
            name: c.toolName,
            id: c.toolCallId,
            args: c.args,
          })),
          toolResults: toolResults.map((r) => ({
            id: r.toolCallId,
            name: r.toolName,
            resultHash: hash(JSON.stringify(r.result)),
          })),
        });
      },
      onFinish: ({ text, finishReason, usage }) => {
        span.setAttributes({
          'agent.finishReason': finishReason,
          'agent.tokens.prompt': usage.promptTokens,
          'agent.tokens.completion': usage.completionTokens,
        });
      },
      onError: ({ error }) => {
        auditError({ correlationId, conversationId, error });
        span.recordException(error as Error);
        span.setStatus({ code: 2, message: (error as Error).message });
      },
    });

    span.end();

    return result.toDataStreamResponse({
      headers: {
        'X-Correlation-Id': correlationId,
        'X-Conversation-Id': conversationId,
      },
    });
  });
};
```

Six invariants new vs. [ai-vercel-sdk.md](ai-vercel-sdk.md):

1. **`maxSteps: 8` hard cap.** Matches the "no runaway" rule. Tune per
   task — 3 for simple lookup, 8–12 for research, never >20 without
   strong evidence.
2. **`onStepFinish`** — per-step audit, not per-conversation. EU AI Act
   Art. 12 wants decision-granularity.
3. **`correlationId` + `conversationId`** — correlation is per request
   (trace join), conversation is per user-visible thread (audit join).
   Two UUIDs.
4. **Tool results hashed, not retained raw.** Raw tool output can
   include PII (customer records, internal docs). Hash by default;
   `retain: 'full'` only on explicit opt-in with `reason`.
5. **System prompt scoped by `scope` param.** Customer-facing vs.
   internal-facing agents get different tool sets and different data
   access.
6. **Rate limit per user on agents separately.** Agent calls cost 5–20×
   a chat call (multi-step multiplies tokens). Separate bucket,
   separate limit.

## Tool definition pattern

```ts
// src/lib/server/ai/tools.ts
import { tool } from 'ai';
import { z } from 'zod';
import type { Session } from '$lib/server/auth';

export function agentTools(session: Session, correlationId: string) {
  return {
    findCustomer: tool({
      description: 'Look up a customer by email or customer ID. Returns null if not found.',
      parameters: z.object({
        query: z.string().min(1).describe('Email or customer ID'),
      }),
      execute: async ({ query }) => {
        const result = await locals.db.customers.find(query, {
          userId: session.user.id,
          correlationId,
        });
        if (!result) return { found: false };
        return {
          found: true,
          id: result.id,
          email: result.email,
          tier: result.tier,
          lastSeen: result.lastSeen.toISOString(),
        };
      },
    }),

    listRecentOrders: tool({
      description: 'List up to 10 recent orders for a customer.',
      parameters: z.object({
        customerId: z.string().uuid(),
        limit: z.number().int().min(1).max(10).default(5),
      }),
      execute: async ({ customerId, limit }) => {
        const orders = await locals.db.orders.recent(customerId, limit, {
          userId: session.user.id,
          correlationId,
        });
        return { orders: orders.map(sanitiseOrder) };
      },
    }),

    refundOrder: tool({
      description: 'Issue a refund for an order. REQUIRES explicit Idempotency-Key. Irreversible.',
      parameters: z.object({
        orderId: z.string().uuid(),
        amount: z.number().positive(),
        reason: z.enum(['customer_request', 'duplicate', 'fraud']),
        idempotencyKey: z.string().uuid(),
      }),
      execute: async ({ orderId, amount, reason, idempotencyKey }) => {
        return await locals.payments.refund({
          orderId,
          amount,
          reason,
          idempotencyKey,
          actorUserId: session.user.id,
          correlationId,
        });
      },
    }),
  };
}
```

Tool-definition rules:

- **`description` drives selection.** LLMs pick tools from descriptions.
  Be precise: write "up to 10 recent orders" not "recent orders". Add
  negative constraints: "REQUIRES explicit Idempotency-Key. Irreversible."
- **Zod `.describe()` on parameters.** The description is forwarded to
  the model as the parameter schema. Vague parameter names → bad
  tool calls.
- **Return shapes are JSON-serialisable.** Dates → ISO strings, enums →
  string literals, `undefined` → omit the field. The model sees the
  JSON; any conversion quirk confuses it.
- **Never return raw DB rows.** `sanitiseOrder()` strips fields the
  model shouldn't see (internal IDs, audit metadata, PII that isn't
  needed for the task).
- **Side-effect tools require `idempotencyKey`.** The model supplies a
  UUID; the server uses it as the replay key. See
  [http-client.md](http-client.md).
- **Pass `correlationId` into every DB / service call.** Every tool
  call gets its own span tied to the root via the correlation thread.

## System prompt scoping

```ts
function systemPrompt(scope: 'customer' | 'internal'): string {
  if (scope === 'customer') {
    return `You are a customer support assistant for Sveltesentio.
      You have access to findCustomer and listRecentOrders.
      You MAY NOT issue refunds; escalate by saying so.
      Never reveal internal fields (audit IDs, compliance flags).
      Keep answers under 200 words.`;
  }
  return `You are an internal support agent assistant for Sveltesentio.
      You have access to findCustomer, listRecentOrders, and refundOrder.
      Refunds require explicit amount and reason; confirm before executing.
      Always include the orderId in your reply.`;
}
```

The **tool set** narrows scope (customer agent literally cannot call
`refundOrder`), not just the prompt. Prompts are advisory; the tool
registry is enforcing.

## Client — `useChat` with multi-step indication

```svelte
<!-- src/lib/ai/AgentChat.svelte -->
<script lang="ts">
  import { useChat } from '@ai-sdk/svelte';
  import { sanitizeMarkdown } from '@sveltesentio/ui/markdown';

  const { messages, input, handleSubmit, isLoading, stop } = useChat({
    api: '/api/agents/research',
    streamProtocol: 'data',
    onFinish: (msg) => {
      if (!msg.content) {
        // Model stopped at maxSteps without final text.
        notify('The assistant stopped before reaching an answer. Try a narrower prompt.');
      }
    },
  });
</script>

<div role="log" aria-live="polite" aria-relevant="additions" class="flex flex-col gap-4">
  {#each $messages as message (message.id)}
    <article class="rounded border p-3">
      <header class="text-sm text-muted-fg">
        {message.role === 'assistant' ? 'Assistant' : 'You'}
      </header>

      {#if message.toolInvocations?.length}
        <details class="my-2 text-sm">
          <summary>Tool calls ({message.toolInvocations.length})</summary>
          <ul class="mt-1 space-y-1">
            {#each message.toolInvocations as inv}
              <li>
                <code>{inv.toolName}</code>
                {#if inv.state === 'call'}<span aria-busy="true">running…</span>{/if}
                {#if inv.state === 'result'}<span class="text-success">done</span>{/if}
              </li>
            {/each}
          </ul>
        </details>
      {/if}

      {#if message.content}
        {@html sanitizeMarkdown(message.content)}
      {/if}
    </article>
  {/each}
</div>

<form onsubmit={handleSubmit} class="mt-4 flex gap-2">
  <input bind:value={$input} name="prompt" class="flex-1 rounded border px-3 py-2" />
  <button type="submit" disabled={$isLoading}>Ask</button>
  {#if $isLoading}<button type="button" onclick={stop}>Stop</button>{/if}
</form>
```

Two UX invariants:

1. **Tool-call visibility.** Users see `findCustomer running…` then
   `done`. Agent loops feel slow; showing progress prevents abandonment.
2. **`role="log"` on the thread.** SR contract inherited from
   [ai-streaming.md](ai-streaming.md) / [ai-vercel-sdk.md](ai-vercel-sdk.md).

## MCP — consuming external tool sources

MCP servers expose a tool registry over JSON-RPC. Vercel AI SDK has
experimental support for consuming them as if they were local tools:

```ts
import { experimental_createMCPClient as createMCPClient } from 'ai';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const mcpClient = await createMCPClient({
  transport: new StdioClientTransport({
    command: 'node',
    args: ['/opt/sveltesentio/mcp-servers/docs.js'],
  }),
});

const mcpTools = await mcpClient.tools();

const result = streamText({
  model: anthropic('claude-opus-4-7'),
  maxSteps: 10,
  tools: { ...agentTools(session, correlationId), ...mcpTools },
  prompt,
  onStepFinish: ({ toolCalls, toolResults }) => {
    // Same audit hook — MCP tools are auditable the same way.
  },
});

await mcpClient.close();
```

Four MCP invariants:

1. **MCP servers run server-side, not in the browser.** stdio /
   sse / websocket transports all terminate at the SvelteKit server.
   The browser never sees MCP.
2. **Zod-parse every MCP response.** MCP servers are third-party code;
   validate inputs and outputs at the boundary same as any HTTP API.
3. **Close the client.** `await mcpClient.close()` in a `finally`.
   Leaked stdio subprocesses are a prod killer.
4. **Never expose `refundOrder`-class tools via MCP.** MCP is for
   read-only / safe tools (documentation, code search, weather).
   Side-effect tools stay local where the session contract is explicit.

## Structured output from an agent

When the agent needs to produce a structured answer (JSON, not prose),
use `streamObject` with a step-aware schema:

```ts
import { streamObject } from 'ai';

const result = streamObject({
  model: anthropic('claude-opus-4-7'),
  maxSteps: 6,
  tools: agentTools(session, correlationId),
  schema: z.object({
    summary: z.string(),
    findings: z.array(z.object({
      customerId: z.string().uuid(),
      issue: z.string(),
      severity: z.enum(['low', 'medium', 'high']),
    })),
    nextActions: z.array(z.string()),
  }),
  prompt,
});
```

`streamObject` + `maxSteps` is the closest Vercel AI SDK analog to
OpenAI's "structured output mode for agents". Auto-retries on schema
mismatch per [ai-vercel-sdk.md](ai-vercel-sdk.md).

## Observability — per-step spans

Emit one span per agent step, child of the root `agent.<name>` span:

```ts
onStepFinish: ({ stepType, toolCalls, usage }) => {
  tracer.startActiveSpan(`agent.step.${stepType}`, { parent: span }, (child) => {
    child.setAttributes({
      'agent.step.toolCallCount': toolCalls.length,
      'agent.step.tokens.total': usage.totalTokens,
      'agent.step.toolNames': toolCalls.map((c) => c.toolName).join(','),
    });
    child.end();
  });
  auditStep({ /* … */ });
},
```

Metrics to export:

- `agent.steps` histogram — distribution of steps per run.
- `agent.tokens` histogram — cost per run.
- `agent.tool_calls` counter by `toolName`.
- `agent.stopReason` counter (`stop`, `tool-calls`, `length`, `content-filter`).
- `agent.errors` counter.

Alert on `stopReason: length` rate > 10% (agents are hitting step
caps).

## Testing

```ts
import { test } from 'vitest';
import { streamText } from 'ai';
import { MockLanguageModelV1 } from 'ai/test';
import { simulateReadableStream } from 'ai/test';

test('agent calls findCustomer then refundOrder', async () => {
  const model = new MockLanguageModelV1({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'tool-call', toolCallId: '1', toolName: 'findCustomer',
            args: JSON.stringify({ query: 'jane@example.com' }) },
          { type: 'finish', finishReason: 'tool-calls',
            usage: { promptTokens: 50, completionTokens: 20 } },
        ],
      }),
    }),
  });

  const steps: string[] = [];
  const result = streamText({
    model,
    maxSteps: 3,
    tools: {
      findCustomer: tool({
        description: 'find',
        parameters: z.object({ query: z.string() }),
        execute: async () => ({ found: true, id: 'c1' }),
      }),
    },
    prompt: 'find jane',
    onStepFinish: ({ stepType }) => steps.push(stepType),
  });

  for await (const _ of result.textStream) { /* drain */ }

  expect(steps).toContain('tool-result');
});
```

Full-fidelity replay testing needs `MockLanguageModelV1` scripted with
the exact tool-call sequence. Production smoke tests replay real agent
traces through the same endpoint against a staging DB.

## Cost control

Agent loops are the biggest AI cost line item in any app that uses
them. Four levers:

- **Per-user daily token cap.** Reject agent requests past the cap.
- **`maxSteps` per endpoint.** Research 8–12, support 3–5, automation 20.
- **Cheaper model for early steps.** Sonnet for tool-calling loops,
  Opus for the final summary step.
- **Cache tool results.** `findCustomer(jane@example.com)` in a 60s
  cache if the record doesn't change that fast.

Emit cost as a span attribute in USD (computed from token usage); keep
a running ledger per user.

## Anti-patterns

- **Agent loop where a single call suffices.** Complexity + cost + risk
  without payoff. If `streamText` + one tool answers the question,
  stay there.
- **No `maxSteps` cap.** Infinite loops exist. Test agents have run
  to 30+ steps in practice.
- **Non-idempotent tools without `idempotencyKey`.** Retries
  double-pay / double-refund / double-email. Side-effect tools
  **require** the key.
- **Tool `execute` that calls the provider SDK directly.** That's
  recursion + cost. Tools call internal services; LLM inference stays
  at the outer loop.
- **Raw tool output in audit retain.** PII leaks. Hash by default;
  `retain: 'full'` only with `reason`.
- **Customer agent with write tools.** Tool-set scoping is a security
  contract, not a style preference.
- **MCP server in the browser.** stdio transport is Node-only; SSE/WS
  transports still need server-side auth + rate limiting. MCP clients
  are server-side only.
- **MCP without Zod parse.** Third-party tool output flows into the
  LLM context; validate the boundary.
- **Leaked MCP client.** `await mcpClient.close()` in `finally`.
  Leaks zombie subprocesses under load.
- **No per-step audit.** EU AI Act Art. 12 needs decision-granular
  logging, not conversation-level.
- **Same correlation ID for conversation + step.** Two UUIDs: request
  = trace correlation, conversation = audit thread. Conflating breaks
  the join.
- **System prompt as the security boundary.** "You may not issue
  refunds" in the prompt is not enforcement. Remove `refundOrder` from
  the tool set.
- **Shipping agents to users without a rate limit.** A loose user +
  Opus + 10 steps = measurable spend per message. Bucket + cap before
  release.
- **Stopping on `maxSteps` silently.** Surface to the user: "The
  assistant ran out of steps — try a narrower prompt."

## References

- [ai-vercel-sdk.md](ai-vercel-sdk.md) — base AI SDK usage.
- [ai-streaming.md](ai-streaming.md) — raw-SDK default.
- [ai-audit-hook.md](ai-audit-hook.md) — step-level audit.
- [observability.md](observability.md) — UUIDv7 correlation.
- [schemas.md](schemas.md) — Zod boundaries.
- [http-client.md](http-client.md) — Idempotency-Key pattern.
- [ADR-0043](../adr/0043-ai-server-proxy-only.md) — server-proxy rule.
- Vercel AI SDK agents: <https://ai-sdk.dev/docs/ai-sdk-core/agents>.
- Vercel AI SDK tool-calling: <https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling>.
- MCP: <https://modelcontextprotocol.io>.
- EU AI Act Art. 12: <https://artificialintelligenceact.eu/article/12/>.
