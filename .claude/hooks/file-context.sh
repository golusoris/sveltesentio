#!/usr/bin/env bash
# Claude Code context hook — injects relevant docs when specific file patterns are edited.
# Triggered by PostToolUse on Edit|Write. $FILE is set by Claude Code.

FILE="${FILE:-}"
[[ -z "$FILE" ]] && exit 0

# +server.ts — SvelteKit server route / API endpoint
if [[ "$FILE" == *"+server.ts"* ]]; then
  cat >&2 <<'GUIDE'
[sentio] +server.ts detected — server route patterns:
• Type-safe fetch: import { createApiClient } from '@sveltesentio/query'
• Validate all inputs at the boundary: use Zod, never trust raw request bodies
• HTTP errors: throw error(status, message) from @sveltejs/kit
• Responses: return json(data satisfies ResponseType) — always type the shape
• Auth: check session in hooks.server.ts handle(), not per-route
• CSP headers: set in hooks.server.ts, not here
• No secrets in response bodies — server vars never leave the server
GUIDE
fi

# +page.svelte — SvelteKit page component
if [[ "$FILE" == *"+page.svelte"* ]]; then
  cat >&2 <<'GUIDE'
[sentio] +page.svelte detected — Svelte 5 runes required:
• State:   $state()    — never writable()
• Derived: $derived()  — never $:
• Effects: $effect()   — for side-effects, not reactive statements
• Props:   $props()    — destructured in <script lang="ts">
• Server state: createQuery() from '@sveltesentio/query' — never writable() for server data
• i18n: use m.message_key() from paraglide, never hardcode strings
• a11y: every interactive element needs aria-label or visible label
GUIDE
fi

# +page.server.ts — SvelteKit server-side load / form actions
if [[ "$FILE" == *"+page.server.ts"* ]]; then
  cat >&2 <<'GUIDE'
[sentio] +page.server.ts detected — server load + form action patterns:
• Forms: use superValidate(request, schema) and return { form }
• Auth guards: redirect(302, '/login') if !event.locals.session
• Type load return: satisfies PageServerLoad so TypeScript catches shape mismatches
• Actions: always return fail(400, { form }) on validation error
• Never throw in actions — return fail() or return data
GUIDE
fi

# schema.ts — Zod schema file
if [[ "$FILE" == *"schema.ts"* ]]; then
  cat >&2 <<'GUIDE'
[sentio] schema.ts detected — Zod v4 + Superforms patterns:
• Always .trim() string inputs before other validations
• Use z.coerce.number() / z.coerce.date() for form numeric/date fields
• Export schema AND infer type: export type FormData = z.infer<typeof schema>
• Superforms: schema must be z.object({}) at top level
• Reuse schemas: extend with .extend(), narrow with .pick()/.omit()
• No z.any() — use z.unknown() and narrow explicitly
GUIDE
fi

# realtime package files
if [[ "$FILE" == *"/packages/realtime/"* ]] || [[ "$FILE" == *"realtime"*".ts"* ]]; then
  cat >&2 <<'GUIDE'
[sentio] Realtime file detected — SSE / WebSocket / ConnectRPC patterns:
• SSE source: wrap sveltekit-sse with createSSESource() helper
• WebSocket store: createWebSocketStore() returns $state-compatible reactive store
• ConnectRPC: createConnectTransport() for bidirectional gRPC streams
• Always handle reconnection: exponential backoff, max retry count
• Cleanup: return cleanup fn from $effect() to close connections on destroy
GUIDE
fi

# hooks.server.ts — SvelteKit server hooks
if [[ "$FILE" == *"hooks.server.ts"* ]]; then
  cat >&2 <<'GUIDE'
[sentio] hooks.server.ts detected — global server hook patterns:
• CSP: set Content-Security-Policy header with nonce for inline scripts
• Session: validate session cookie and set event.locals.session
• Locale: read Accept-Language + URL prefix, set event.locals.locale
• Logging: use createLogger('hooks') from '@sveltesentio/core'
• Error handling: wrap handle() with sequence() for composable middleware
GUIDE
fi
