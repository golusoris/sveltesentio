# Error boundaries — SvelteKit `+error.svelte` + ProblemError propagation

When something throws server-side, SvelteKit walks up the route tree
looking for `+error.svelte`. When something throws client-side, the
same boundary handles the render-time error. When something *breaks
inside an error boundary*, you get a white screen. When neither is
reached — a thrown promise in an `$effect`, a syntax error in a
lazy-loaded chunk, a network drop mid-hydrate — the browser shows a
console error and the user stares at a partially-painted page.

The working shape is a layered contract: **`handleError` hooks** for
logging + correlation, **`+error.svelte` routes** for rendered
fallbacks at the right tree level, **`ProblemError`** (RFC 9457) as
the single server-to-client error envelope, and **client-side error
recovery** via TanStack Query's retry semantics plus a global
unhandled-rejection handler wired into
[sentry-or-equivalent.md](sentry-or-equivalent.md).

Per [ADR-0019](../adr/0019-structured-error-envelope.md) (RFC 9457)
and [principles.md §2.1](../principles.md) (Power-of-10 —
exhaustive error handling, no silent catches), this recipe covers:
server/client `handleError` hooks, `+error.svelte` at root vs nested
routes, the `ProblemError` shape, graceful degradation in load
functions, and what belongs in which layer (user-facing vs
developer-facing).

## Related

- [sentry-or-equivalent.md](sentry-or-equivalent.md) — `handleError`
  hooks emit to the error tracker with `correlation.id` join.
- [observability.md](observability.md) — same error threads into
  OTel span + log record; RFC 9457 `type` becomes a span attribute.
- [http-client.md](http-client.md) — `openapi-fetch` middleware
  maps server RFC 9457 responses to typed `ProblemError` instances.
- [forms.md](forms.md) — form submission errors surface via
  Superforms; field-level errors don't cross the error-boundary
  line.
- [server-state.md](server-state.md) — TanStack Query retry /
  exponential backoff handles transient errors before they reach the
  UI boundary.
- [schemas.md](schemas.md) — Zod `safeParse` at every boundary
  prevents validation errors from leaking untyped.
- [i18n-runtime-strategy.md](i18n-runtime-strategy.md) — error copy
  is localized via Paraglide; never hard-code English in error
  components.
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — error pages are
  `role="alert"` with focus-management rules below.
- [toast.md](toast.md) — transient errors that don't require a
  full-page fallback use toast notifications.
- [principles.md §2.1](../principles.md) — no silent catches; every
  thrown error is logged, typed, and surfaced.

## The three layers

```text
Layer 1 — handleError hook             (server + client)
  WHAT: logs, adds correlation.id, ships to Sentry + OTel
  DOES NOT: render UI
  WHERE: src/hooks.server.ts + src/hooks.client.ts

Layer 2 — +error.svelte                (per route segment)
  WHAT: renders a user-facing error page
  DOES NOT: log (already logged in layer 1)
  WHERE: src/routes/+error.svelte (root) + nested as needed

Layer 3 — in-component try/catch       (per interaction)
  WHAT: shows inline error state (toast, form error, retry button)
  DOES NOT: bubble to +error.svelte for recoverable cases
  WHERE: components + $effect blocks + async handlers
```

Each layer has a different job. Mixing them is how you end up with
double-logged errors, unhandled promises, or full-page redirects
when an inline toast would do.

## ProblemError — the single error envelope

```ts
// packages/core/src/errors/problem.ts
import { z } from 'zod';

export const ProblemDetail = z.object({
  type: z.string().url().or(z.string().startsWith('urn:')),
  title: z.string(),
  status: z.number().int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  correlationId: z.string().uuid().optional(),
}).passthrough();   // RFC 9457 allows additional member fields

export type ProblemDetail = z.infer<typeof ProblemDetail>;

export class ProblemError extends Error {
  readonly problem: ProblemDetail;
  constructor(problem: ProblemDetail) {
    super(problem.title);
    this.problem = problem;
    this.name = 'ProblemError';
  }
}

export function isProblemError(err: unknown): err is ProblemError {
  return err instanceof ProblemError;
}
```

**Five envelope rules:**

1. **`type` is a stable URI** (`urn:sveltesentio:validation:invalid`
   or `https://docs.acme.example/errors/invalid-input`). Clients
   switch on `type` — never on `title` or `detail`, which are
   localized/free-form.
2. **`correlationId` UUIDv7** threads through
   [observability.md](observability.md) for end-to-end trace.
3. **`passthrough()`** on the Zod schema allows domain-specific
   extensions (`rate.retryAfterMs`, `validation.fieldErrors`) without
   loosening the base contract.
4. **`ProblemError extends Error`** so it flows through try/catch
   and reaches `handleError`.
5. **`isProblemError` type-guard** — handlers inspect `err.problem`,
   non-problem errors get a generic `urn:…:unexpected` wrap.

Server throws via SvelteKit's `error()`:

```ts
// +server.ts
import { error } from '@sveltejs/kit';

throw error(400, {
  type: 'urn:sveltesentio:validation:invalid',
  title: 'Invalid input',
  status: 400,
  detail: 'priceCents must be positive.',
  correlationId: locals.correlationId,
});
```

SvelteKit serializes the body as JSON for fetch-style requests and
routes to `+error.svelte` for page navigations.

## Layer 1 — handleError hooks

```ts
// src/hooks.server.ts
import type { HandleServerError } from '@sveltejs/kit';
import * as Sentry from '@sentry/sveltekit';
import { uuidv7 } from '@sveltesentio/core';
import { isProblemError } from '@sveltesentio/core/errors';

export const handleError: HandleServerError = ({ error: err, event, status, message }) => {
  const correlationId = event.locals.correlationId ?? uuidv7();

  // Normalize to a ProblemError shape for the response.
  const problem = isProblemError(err)
    ? err.problem
    : {
        type: 'urn:sveltesentio:unexpected',
        title: 'Unexpected error',
        status,
        detail: undefined,   // never leak err.message — it may contain secrets
        correlationId,
      };

  // 4xx are expected; 5xx page oncall.
  if (status >= 500) {
    Sentry.captureException(err, {
      tags: { 'problem.type': problem.type, 'problem.status': String(problem.status) },
      contexts: { problem },
      extra: { correlationId, path: event.url.pathname, method: event.request.method },
    });
  }

  console.error('server_error', {
    correlationId,
    path: event.url.pathname,
    method: event.request.method,
    status,
    problemType: problem.type,
    message: err instanceof Error ? err.message : String(err),
  });

  // Return value is what SvelteKit sends to +error.svelte as `$page.error`.
  return {
    message: problem.title,
    type: problem.type,
    status: problem.status,
    correlationId,
  };
};
```

```ts
// src/hooks.client.ts
import type { HandleClientError } from '@sveltejs/kit';
import * as Sentry from '@sentry/sveltekit';
import { uuidv7 } from '@sveltesentio/core';

export const handleError: HandleClientError = ({ error: err, status }) => {
  const correlationId = uuidv7();

  // Don't re-report errors Sentry already captures (unhandled rejections).
  if (status >= 500) {
    Sentry.captureException(err, {
      tags: { source: 'handleError.client', status: String(status) },
      extra: { correlationId },
    });
  }

  return {
    message: err instanceof Error ? err.message : 'Client error',
    type: 'urn:sveltesentio:client:unexpected',
    status,
    correlationId,
  };
};
```

**Seven hook rules:**

1. **`handleError` returns `App.Error`, not throws.** Its return
   value flows into `$page.error` in `+error.svelte`. Throwing from
   within `handleError` is the white-screen path.
2. **Normalize to ProblemError shape.** Downstream code (error
   component, client, tests) sees a consistent envelope regardless
   of what threw.
3. **Never leak `err.message` in `detail`.** Stack traces, SQL
   snippets, and internal paths end up in error bodies if you forward
   `err.message` blindly. Log privately; show generic title publicly.
4. **`correlationId` generated once** per request; reused for Sentry
   tags + OTel context + response body.
5. **`Sentry.captureException` only for 5xx.** 4xx are client mistakes
   / validation failures; they're not errors in the alert-someone
   sense. Filtering 4xx in `beforeSend` is a common Sentry-cost
   bug — catch it here.
6. **Log with structured attributes, not string-interpolated
   messages.** `console.error('server_error', {...})` is grep-able
   + OTel-parseable; `console.error(\`error in ${path}\`)` isn't.
7. **Server + client hooks in parallel.** Both must exist. Only
   client-side `handleError` catches client-thrown errors; only
   server-side catches SSR errors.

## Layer 2 — `+error.svelte` at the right tree level

```svelte
<!-- src/routes/+error.svelte — root boundary (always required) -->
<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { onMount } from 'svelte';

  let heading: HTMLHeadingElement | undefined;

  onMount(() => {
    heading?.focus();
  });
</script>

<svelte:head>
  <title>{page.status} — {m.error_page_title()}</title>
</svelte:head>

<main role="alert" aria-live="assertive">
  <h1 bind:this={heading} tabindex="-1">
    {#if page.status === 404}
      {m.error_not_found_title()}
    {:else if page.status === 403}
      {m.error_forbidden_title()}
    {:else if page.status >= 500}
      {m.error_server_title()}
    {:else}
      {m.error_generic_title()}
    {/if}
  </h1>

  <p>
    {#if page.status === 404}
      {m.error_not_found_body()}
    {:else if page.status >= 500}
      {m.error_server_body()}
    {:else}
      {page.error?.message ?? m.error_generic_body()}
    {/if}
  </p>

  {#if page.error?.correlationId}
    <p class="text-muted">
      {m.error_reference({ id: page.error.correlationId })}
    </p>
  {/if}

  <div class="actions">
    <a href="/" class="btn btn-primary">{m.error_action_home()}</a>
    {#if page.status >= 500}
      <button onclick={() => location.reload()} class="btn">
        {m.error_action_retry()}
      </button>
    {/if}
  </div>
</main>
```

**Eight boundary rules:**

1. **Root `+error.svelte` exists always.** Without it, SvelteKit
   falls back to a generic grey error page that's not branded,
   localized, or a11y-clean.
2. **`role="alert"` + `aria-live="assertive"`** on the main container.
   Screen-readers announce the error on load.
3. **Focus moves to `<h1>`** on mount. Users who tabbed into a broken
   state need an announced landing.
4. **Status-driven copy.** 404 / 403 / 5xx have distinct messages;
   never show "An error occurred" for everything.
5. **Show `correlationId`.** Users reporting bugs can give support a
   reference ID that joins to logs + Sentry.
6. **Retry button for 5xx only.** 404 and 403 won't fix themselves
   on reload; hiding the button prevents the "I keep clicking but
   nothing works" UX.
7. **Localized copy via Paraglide.** Error pages are high-traffic
   and multilingual-sensitive; never hard-code English.
8. **Nested `+error.svelte` for route-specific UX.** `/billing/+error.svelte`
   can surface "Your payment method was declined — update and retry"
   with `<a href="/billing/portal">` instead of the generic "go
   home".

## Nested `+error.svelte` — how SvelteKit picks one

SvelteKit walks up from the errored route. A 500 in
`/dashboard/reports/[id]` checks:

```text
src/routes/dashboard/reports/[id]/+error.svelte    (most specific)
src/routes/dashboard/reports/+error.svelte
src/routes/dashboard/+error.svelte
src/routes/+error.svelte                            (root fallback)
```

**Three nesting rules:**

1. **Only nest when the UX differs.** A root `+error.svelte` covers
   most cases; nested ones exist for domain-specific actions (e.g.
   "retry your checkout").
2. **Nested pages still render the surrounding `+layout.svelte`.**
   Shell chrome (nav, footer) remains visible — which is usually
   what you want.
3. **Error inside `+layout.svelte` bubbles past the same-level
   `+error.svelte`.** If the layout throws, the root boundary
   catches. Don't put heavy logic in layouts for this reason.

## `load` function errors — expected vs unexpected

```ts
// +page.server.ts
import { error } from '@sveltejs/kit';
import { ProblemError } from '@sveltesentio/core/errors';

export async function load({ params, locals }) {
  const report = await db.selectFrom('reports')
    .where('id', '=', params.id)
    .selectAll()
    .executeTakeFirst();

  if (!report) {
    throw error(404, {
      type: 'urn:sveltesentio:report:not-found',
      title: 'Report not found',
      status: 404,
      correlationId: locals.correlationId,
    });
  }

  // Transient downstream failure — graceful degrade, not an error.
  let enrichment = null;
  try {
    enrichment = await enrichmentApi.fetch(report.id);
  } catch (err) {
    console.warn('enrichment_failed', { correlationId: locals.correlationId, err });
    // Page still renders without enrichment.
  }

  return { report, enrichment };
}
```

**Four load rules:**

1. **Expected errors throw `error(status, problemBody)`.** Not-found,
   forbidden, validation-failed — these are routed to
   `+error.svelte` via SvelteKit's error handling.
2. **Unexpected errors bubble.** Don't try/catch to return `null` for
   a DB down — the page can't render without the primary data; let
   `handleError` catch it and 500.
3. **Optional / enrichment data gets try/catch + warn.** The page
   partially renders; downstream outage doesn't fail the whole page.
4. **Never swallow without logging.** Silent catches are the
   [principles.md §2.1](../principles.md) violation the Power-of-10
   guards against.

## Layer 3 — in-component error recovery

```svelte
<!-- src/routes/checkout/+page.svelte -->
<script lang="ts">
  import { toast } from '@sveltesentio/ui/toast';
  import { isProblemError } from '@sveltesentio/core/errors';

  let loading = $state(false);

  async function submit() {
    loading = true;
    try {
      const res = await fetch('/api/checkout', { method: 'POST' });
      if (!res.ok) {
        const problem = await res.json();
        throw new ProblemError(problem);
      }
      const { url } = await res.json();
      location.href = url;
    } catch (err) {
      if (isProblemError(err) && err.problem.status === 429) {
        toast.warning(m.checkout_rate_limited(), {
          action: { label: m.retry(), onClick: submit },
        });
      } else if (isProblemError(err) && err.problem.status === 400) {
        toast.error(err.problem.detail ?? m.checkout_invalid());
      } else {
        toast.error(m.checkout_unexpected());
        Sentry.captureException(err);
      }
    } finally {
      loading = false;
    }
  }
</script>
```

**Six in-component rules:**

1. **Recoverable errors don't bubble to `+error.svelte`.** A 429 on
   a button click becomes a toast with a retry action; a
   full-page crash would lose the user's form state.
2. **`ProblemError` discriminator.** Branch on
   `err.problem.status` or `err.problem.type`, not stringly-typed
   messages.
3. **Localized copy always.** `m.checkout_rate_limited()`, never
   inline English.
4. **`Sentry.captureException` only for truly unexpected.** 4xx with
   known `type` is not an error tracker event; 500 + network failure
   is.
5. **`finally { loading = false }`.** Always reset the loading state;
   a stuck button is a worse UX than the underlying error.
6. **Explicit retry via action button**, not automatic. Automatic
   retry on POST is a payment-duplicate bug waiting to happen —
   idempotency-key aware retries belong in
   [http-client.md](http-client.md).

## Async-effect errors — the silent-crash path

`$effect` swallows async errors by default:

```svelte
<script lang="ts">
  $effect(() => {
    // If this throws, you won't see it — $effect is sync-typed.
    loadSomething();
  });
</script>
```

The fix:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  $effect(() => {
    (async () => {
      try {
        await loadSomething();
      } catch (err) {
        Sentry.captureException(err);
        toast.error(m.load_failed());
      }
    })();
  });
</script>
```

Or preferably, use TanStack Query per
[server-state.md](server-state.md) — it has built-in error handling,
retry, and cache invalidation.

## Global unhandled-rejection handler

```ts
// src/hooks.client.ts — alongside handleError
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    console.error('unhandled_rejection', { reason: event.reason });
    Sentry.captureException(event.reason);
  });
  window.addEventListener('error', (event) => {
    console.error('uncaught_error', { error: event.error, message: event.message });
    Sentry.captureException(event.error ?? event.message);
  });
}
```

**Three global-handler rules:**

1. **Catch unhandled rejections.** Sentry's default setup does this,
   but explicit is better than implicit — you see it in code review.
2. **Catch synchronous errors** that escape the render tree (rare but
   happens with buggy third-party scripts).
3. **Don't `event.preventDefault()`.** Let the browser also log the
   error — hiding it from the console breaks dev debugging.

## Testing

```ts
// packages/core/test/problem.test.ts
import { describe, expect, test } from 'vitest';
import { ProblemError, isProblemError } from '../src/errors/problem';

describe('ProblemError', () => {
  test('isProblemError narrows correctly', () => {
    const err = new ProblemError({ type: 'urn:x', title: 't', status: 400 });
    expect(isProblemError(err)).toBe(true);
    expect(isProblemError(new Error('nope'))).toBe(false);
  });

  test('extends Error so it flows through try/catch', () => {
    try {
      throw new ProblemError({ type: 'urn:x', title: 't', status: 400 });
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });
});
```

Playwright lanes:

1. **404 smoke** — navigate to `/does-not-exist`, assert heading
   focus + status + correlationId visible.
2. **5xx smoke** — inject a server fault via test fixture, assert
   retry button + error tracker event emitted.
3. **Nested error** — trigger error inside `/billing`, assert
   `/billing/+error.svelte` renders (not root).

## Anti-patterns

- **Don't log inside `+error.svelte`.** Logging already happened in
  `handleError`; logging again double-counts in observability.
- **Don't throw from `handleError`.** Its job is to return an
  `App.Error` object. A throw here produces the fallback grey page.
- **Don't leak `err.message` in the response body.** Stack traces,
  SQL fragments, and secrets end up on error pages. Log privately,
  show generic titles.
- **Don't try/catch and swallow.** `catch { }` is a
  [principles.md §2.1](../principles.md) violation. Every catch
  either rethrows, logs, or surfaces an inline error state.
- **Don't use `+error.svelte` for transient recoverable errors.**
  A full-page error for a 429 or a flaky network is the wrong shape;
  toast + retry wins.
- **Don't forget the root `+error.svelte`.** Missing root boundary =
  users see SvelteKit's default grey page. Unprofessional and
  a11y-mediocre.
- **Don't hard-code English error copy.** Paraglide all error
  messages; error pages are high-traffic for users in trouble.
- **Don't switch on `err.message` or `title`.** Those are
  localized / free-form. Switch on `type` (stable URI) or `status`.
- **Don't attach full request bodies to Sentry error events.**
  Request bodies contain PII. `tags` are bounded enums; `contexts`
  are structured; neither should carry raw user-supplied text.
- **Don't retry POST requests automatically on error.** Without an
  `Idempotency-Key`, retry = duplicate. See
  [http-client.md](http-client.md).
- **Don't let `$effect` swallow async errors.** Wrap the async IIFE
  in try/catch or use TanStack Query per
  [server-state.md](server-state.md).
- **Don't render error pages without `role="alert"` + focus.**
  Silent visual-only errors are SR-hostile.
- **Don't redirect instead of erroring.** `302 → /` on a 404 loses
  the user's path + breaks bookmarks. `+error.svelte` renders in
  place; the link to home is visible but optional.
- **Don't show different errors in dev vs prod without guardrails.**
  Dev-mode full stack traces are fine; if they leak to prod via a
  misconfigured env var, you've exposed internals. Test this path.
- **Don't paginate error-tracker quota by filtering 5xx.** If you're
  over quota, the problem is too many errors; silencing them hides
  the incident, not fixes it.

## References

- [ADR-0019 — Structured error envelope (RFC 9457)](../adr/0019-structured-error-envelope.md)
- [principles.md §2.1 — Power-of-10 (exhaustive error handling)](../principles.md)
- Sibling recipes: [sentry-or-equivalent.md](sentry-or-equivalent.md),
  [observability.md](observability.md),
  [http-client.md](http-client.md),
  [forms.md](forms.md),
  [server-state.md](server-state.md),
  [schemas.md](schemas.md),
  [i18n-runtime-strategy.md](i18n-runtime-strategy.md),
  [a11y-audit-runbook.md](a11y-audit-runbook.md),
  [toast.md](toast.md).
- Upstream docs:
  - SvelteKit error handling: <https://svelte.dev/docs/kit/errors>
  - SvelteKit hooks (handleError): <https://svelte.dev/docs/kit/hooks#shared-hooks-handleerror>
  - RFC 9457 — Problem Details for HTTP APIs: <https://www.rfc-editor.org/rfc/rfc9457>
  - WCAG 2.2 — Error Identification (SC 3.3.1): <https://www.w3.org/WAI/WCAG22/Understanding/error-identification>
