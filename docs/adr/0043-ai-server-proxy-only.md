# ADR-0043: AI provider SDKs are server-proxy-only; no browser imports of Anthropic / Ollama SDKs

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D130 + D131 + D133 in `.workingdir/research/decisions-needed.md`

## Context

AI provider SDKs (`@anthropic-ai/sdk`, `ollama`, `ollama-js`) accept API keys/bearer tokens directly. Importing these SDKs in a browser bundle exposes credentials — even with env-var swapping, the import graph statically includes provider URLs and request shapes that should never leave the server. Streaming from an AI provider to the browser must route through a SvelteKit `+server.ts` endpoint that proxies the SDK call.

Additionally: the "streaming" channel for AI responses is SSE, already owned by `@sveltesentio/realtime/sse` (ADR-0037). No parallel streaming transport.

## Decision

- `@sveltesentio/ai/server` — imports `@anthropic-ai/sdk` / `ollama` / `ollama-js`. Only importable from `+server.ts` / hooks.
- `@sveltesentio/ai/client` — **never** imports a provider SDK. ESLint rule (`no-restricted-imports`) blocks direct imports of `@anthropic-ai/sdk` / `ollama*` from any client-side file.
- Browser streams AI responses via SSE (`useSSE`) pointed at an app-owned `+server.ts`.
- CORS: provider APIs not callable from the browser. Any attempt is rejected at the ESLint gate and at the browser's same-origin + missing-CORS boundary.

## Alternatives considered

- **Browser-direct with API proxy keys** — keys leak; even "proxy keys" from some providers can be abused.
- **Separate streaming transport for AI** — duplicates SSE; no gain.
- **Vercel AI SDK** — evaluated; framework idioms overlap with our realtime + query layers. Opt-in via `docs/compose/ai-vercel-sdk.md` if needed.

## Consequences

**Positive**:

- Provider credentials stay server-side by construction.
- Single streaming transport (SSE) across AI + generic server events.
- ESLint rule prevents regression.

**Negative / trade-offs**:

- AI features must ship with a SvelteKit server; pure static hosting cannot embed AI features.
- Consumer apps author their own `+server.ts` route per feature; template in `docs/compose/`.

**Documentation obligations**:

- `docs/compose/ai-streaming.md` — `+server.ts` + `useSSE` pattern.
- `@sveltesentio/ai` AGENTS.md — server vs client import boundary.
- Lint config ships the `no-restricted-imports` rule enabled by default.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:102-103,105` — D130 + D131 + D133 picks.
- OWASP ASVS L2 V14 Configuration — credentials must not reach client.
- ADR-0037 — SSE ownership.
