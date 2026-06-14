# Trusted Types — defence-in-depth DOM-XSS prevention

Trusted Types is a browser security primitive that blocks every
dangerous DOM sink (innerHTML, outerHTML, script.src, etc.) unless the
value went through a registered policy. It turns "don't forget to
sanitize" from a code-review rule into a browser-enforced runtime
contract.

Extends [markdown.md](markdown.md) (which establishes DOMPurify at the
`{@html}` boundary) by wiring DOMPurify into a Trusted Types policy so
the browser refuses any HTML that didn't pass through the policy —
even if a future regression forgets to sanitize. Not a replacement for
DOMPurify; Trusted Types **enforces** its use.

## Related

- [markdown.md](markdown.md) — DOMPurify at `{@html}` boundary; this
  recipe upgrades that contract to browser-enforced.
- [theming.md](theming.md) — CSP header wiring; Trusted Types is a CSP
  directive.
- [pwa.md](pwa.md) — CSP additions for service-worker context.
- [ai-streaming.md](ai-streaming.md) — LLM output into `{@html}` must
  go through a TT policy.
- [ai-vercel-sdk.md](ai-vercel-sdk.md) — same contract for AI SDK
  chat message rendering.
- [principles.md §2.2](../principles.md) — OWASP ASVS L2 Content
  Security.
- [ADR-0026](../adr/0026-markdown-runtime-build-split.md) — markdown
  runtime sanitization path.

## When to enable Trusted Types

```text
Any app with user-generated content rendered as HTML      → enable (mandatory)
Any app rendering LLM output                              → enable (mandatory)
Static marketing site, zero {@html}                       → optional
App on Safari/Firefox only (no TT support yet)            → implement anyway; Chromium gates matter
```

Chromium enforces Trusted Types. Safari and Firefox (as of 2026-04)
don't — but enabling it has zero cost in non-supporting browsers (the
CSP directive is ignored) and real benefit in Chrome/Edge (~70% of
traffic most apps). Always enable; never treat as Chromium-only.

## CSP header — the enforcement gate

```text
Content-Security-Policy:
  require-trusted-types-for 'script';
  trusted-types sveltesentio-dompurify sveltesentio-svg sveltesentio-default;
```

Two directives, one contract:

- **`require-trusted-types-for 'script'`** — any sink that the browser
  classifies as "injection" (`innerHTML`, `outerHTML`, `setAttribute('srcdoc')`,
  `document.write`, `script.src`, `script.text`, `eval`-via-setTimeout-string,
  etc.) rejects non-TrustedType values.
- **`trusted-types <policy-names>`** — only the named policies may be
  created. Any `trustedTypes.createPolicy('something-else')` throws.
  The `sveltesentio-default` policy is the fallback for built-in
  sinks that don't name their policy; keeping it on a short allowlist
  narrows the attack surface.

Deploy in **Report-Only** first:

```text
Content-Security-Policy-Report-Only:
  require-trusted-types-for 'script';
  trusted-types sveltesentio-dompurify sveltesentio-svg sveltesentio-default;
  report-uri /api/csp-report;
```

Watch `/api/csp-report` for 1-2 weeks. Violations indicate:

- A sink we don't control (usually a third-party CDN script).
- A library that assigns `innerHTML` internally.
- A dev-only code path (source maps, HMR).

Fix or allowlist each. Then flip to enforcing mode.

## Install

No npm package needed for Trusted Types itself — it's a browser API.
DOMPurify already ships per [markdown.md](markdown.md); it has built-in
TT integration:

```bash
# Already installed per markdown.md
pnpm add dompurify
pnpm add -D @types/dompurify
```

## Policy module — `$lib/security/trusted-types.ts`

```ts
// src/lib/security/trusted-types.ts
import DOMPurify from 'dompurify';

type PolicyMap = {
  dompurify: TrustedTypePolicy;
  svg: TrustedTypePolicy;
  default: TrustedTypePolicy;
};

const policies: Partial<PolicyMap> = {};

export function initTrustedTypes(): void {
  if (typeof window === 'undefined') return;
  if (!window.trustedTypes?.createPolicy) return;

  if (!policies.dompurify) {
    policies.dompurify = trustedTypes.createPolicy('sveltesentio-dompurify', {
      createHTML: (input) =>
        DOMPurify.sanitize(input, {
          USE_PROFILES: { html: true },
          ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|data:image):/i,
          ADD_ATTR: ['target', 'rel'],
          FORBID_TAGS: ['style', 'script', 'iframe'],
          FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover'],
        }),
    });
  }

  if (!policies.svg) {
    policies.svg = trustedTypes.createPolicy('sveltesentio-svg', {
      createHTML: (input) =>
        DOMPurify.sanitize(input, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ['script', 'foreignObject'],
        }),
    });
  }

  if (!policies.default) {
    policies.default = trustedTypes.createPolicy('sveltesentio-default', {
      createHTML: (input, sink) => {
        console.warn('[TT] default policy used:', { sink });
        return DOMPurify.sanitize(input, { USE_PROFILES: { html: true } });
      },
      createScript: (input) => {
        throw new Error('[TT] script injection blocked: ' + input.slice(0, 80));
      },
      createScriptURL: (input) => {
        const url = new URL(input, location.href);
        if (url.origin !== location.origin) {
          throw new Error('[TT] cross-origin script URL blocked: ' + url.href);
        }
        return input;
      },
    });
  }
}

export function sanitizeHTML(html: string): TrustedHTML {
  if (!policies.dompurify) {
    throw new Error('Trusted Types not initialized');
  }
  return policies.dompurify.createHTML(html);
}

export function sanitizeSVG(svg: string): TrustedHTML {
  if (!policies.svg) {
    throw new Error('Trusted Types not initialized');
  }
  return policies.svg.createHTML(svg);
}
```

Three invariants in this module:

1. **Three policies, one per use case.** `dompurify` for prose HTML,
   `svg` for inline SVG, `default` as the last-resort fallback. Fewer
   policies = smaller attack surface.
2. **Default policy logs + sanitizes, never passes through.** A sink
   that falls through to `default` is a bug — log it, sanitize with the
   strictest profile, and refactor the caller.
3. **Script policies throw.** `createScript` is for `eval`-class sinks;
   we never legitimately need them. `createScriptURL` allows
   same-origin only (blocks CDN script injection).

## Init from `+layout.svelte`

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { initTrustedTypes } from '$lib/security/trusted-types';

  if (browser) initTrustedTypes();

  onMount(() => { /* other client-only init */ });
</script>
```

Init runs during module evaluation, **before** any component renders
HTML. `onMount` is too late — a child component's `{@html}` may
execute during initial hydration before `onMount` fires.

## Using the policy — `{@html}` sinks

Replace raw `{@html userHtml}` with `{@html sanitizeHTML(userHtml)}`:

```svelte
<!-- src/lib/markdown/Markdown.svelte -->
<script lang="ts">
  import { marked } from 'marked';
  import { sanitizeHTML } from '$lib/security/trusted-types';

  let { source }: { source: string } = $props();
  const html = $derived(sanitizeHTML(marked.parse(source) as string));
</script>

<div class="prose">{@html html}</div>
```

Svelte 5's `{@html}` accepts `TrustedHTML` in addition to `string`. The
compiler doesn't narrow the type for you — that's why the wrapper
returns `TrustedHTML`, so TypeScript flags raw `{@html string}` at
call sites where TT is required.

## LLM output — ai-streaming / ai-vercel-sdk

```svelte
<!-- src/lib/ai/Message.svelte -->
<script lang="ts">
  import { sanitizeHTML } from '$lib/security/trusted-types';
  import { marked } from 'marked';

  let { content }: { content: string } = $props();
  const html = $derived(sanitizeHTML(marked.parse(content) as string));
</script>

<article>{@html html}</article>
```

LLM output is the highest-risk innerHTML in the stack — the model has
been trained on prompt-injection payloads and can emit them. Trusted
Types is the browser's "even if you forget" guardrail.

## Inline SVG

User-uploaded SVG (logos, diagrams, decorative icons) goes through
`sanitizeSVG`:

```svelte
<script lang="ts">
  import { sanitizeSVG } from '$lib/security/trusted-types';

  let { source }: { source: string } = $props();
  const svg = $derived(sanitizeSVG(source));
</script>

<figure>{@html svg}</figure>
```

SVG carries `<script>` and `foreignObject` + `onclick` vectors
independent of HTML. The separate policy has a narrower profile
(`svg` + `svgFilters`, no HTML tags).

## Third-party libraries — the nuisance

Some libraries assign `innerHTML` internally:

- **LayerChart / ECharts / uPlot** — write SVG/canvas; do not use
  innerHTML (✅ safe).
- **Leaflet / Mapbox** — some tile popups build HTML with innerHTML.
- **Quill / CKEditor** — rich-text editors use innerHTML heavily;
  they usually ship TT-compatible builds.
- **Histoire dev server** — HMR injects scripts; TT violations in dev
  are expected and fine (enforce only in prod).

For libraries without TT support, two options:

1. **Wrap all library entry points in a policy.** Add the library's
   dangerous input path to `sveltesentio-default`'s `createHTML`, which
   sanitizes everything. Perf cost: sanitization on every lib render.
2. **Name the library's policy in the CSP.** If the library calls
   `trustedTypes.createPolicy('leaflet')`, add `leaflet` to the
   `trusted-types` directive. Only if the library's sanitization is
   auditable.

Never `trusted-types *` — that disables enforcement.

## Development-mode bypass (never in production)

Vite HMR runtime injects scripts during dev. Enforcing TT in dev
breaks HMR. Wire the policy only in prod builds:

```ts
// src/lib/security/trusted-types.ts (extension)
export function initTrustedTypes(): void {
  if (typeof window === 'undefined') return;
  if (import.meta.env.DEV) return;
  if (!window.trustedTypes?.createPolicy) return;
  // … create policies
}
```

CSP header likewise — emit `require-trusted-types-for` only in prod
hooks. Dev has `Content-Security-Policy-Report-Only` so violations
still appear in the console for debugging.

## Reporting — `/api/csp-report`

```ts
// src/routes/api/csp-report/+server.ts
import type { RequestHandler } from './$types';
import { z } from 'zod';

const ReportSchema = z.object({
  'csp-report': z.object({
    'document-uri': z.string().url(),
    'violated-directive': z.string(),
    'blocked-uri': z.string().optional(),
    'source-file': z.string().optional(),
    'line-number': z.number().optional(),
    'script-sample': z.string().optional(),
  }),
});

export const POST: RequestHandler = async ({ request, locals }) => {
  const body = await request.text();
  const parsed = ReportSchema.safeParse(JSON.parse(body));
  if (!parsed.success) return new Response(null, { status: 204 });

  locals.log.warn('csp-violation', {
    directive: parsed.data['csp-report']['violated-directive'],
    blockedUri: parsed.data['csp-report']['blocked-uri'],
    sourceFile: parsed.data['csp-report']['source-file'],
    sample: parsed.data['csp-report']['script-sample']?.slice(0, 200),
  });
  return new Response(null, { status: 204 });
};
```

Route to OTel per [observability.md](observability.md) with a
`csp.violation` metric. Alert on rate > 10/min per origin — indicates
either a real attack or a regression.

## Testing

Component test with jsdom + polyfill:

```ts
import { test, beforeAll } from 'vitest';
import { render } from '@testing-library/svelte';
import DOMPurify from 'dompurify';
import { sanitizeHTML, initTrustedTypes } from '$lib/security/trusted-types';

beforeAll(() => {
  // jsdom has no trustedTypes; stub it for tests.
  if (!(globalThis as any).trustedTypes) {
    (globalThis as any).trustedTypes = {
      createPolicy: (name: string, opts: any) => ({
        name,
        createHTML: (s: string) => opts.createHTML(s),
        createScript: (s: string) => opts.createScript?.(s),
        createScriptURL: (s: string) => opts.createScriptURL?.(s),
      }),
    };
  }
  initTrustedTypes();
});

test('sanitizeHTML strips script tags', () => {
  const dirty = '<p>hi</p><script>alert(1)</script>';
  const clean = sanitizeHTML(dirty);
  expect(String(clean)).not.toContain('<script>');
});
```

E2E with Playwright + real Chromium:

```ts
test('CSP blocks raw innerHTML', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (msg.text().includes('Trusted Types')) violations.push(msg.text());
  });
  await page.goto('/');
  await page.evaluate(() => {
    const el = document.createElement('div');
    try { el.innerHTML = '<p>raw</p>'; } catch (e) { /* expected */ }
  });
  expect(violations.length).toBeGreaterThan(0);
});
```

## Performance

DOMPurify runs in microseconds for typical HTML; negligible vs. render
cost. For LLM-streaming where `{@html}` updates 30+ times/second as
tokens arrive:

- Debounce the `sanitizeHTML` call to animation frames.
- Or: sanitize once after stream completion, render pre-stream as text.

Profile before optimizing — most streams are token-per-second, not
30/sec.

## Gotchas

- **`innerHTML = ''`** is still blocked. Use `textContent = ''` or
  `replaceChildren()` to clear.
- **`document.write`** is blocked. Never legitimate anyway; refactor.
- **`eval`, `new Function`, `setTimeout('string')`** — blocked by
  `require-trusted-types-for 'script'`. Always use function references.
- **Third-party analytics scripts.** Some inject via `document.write`
  or string-based `setTimeout`. Pin self-hosted or switch vendors.
- **`DOMParser.parseFromString`** doesn't trigger TT (it doesn't attach
  to the DOM). Safe to parse untrusted HTML into a detached document,
  walk it, and only insert sanitized fragments.
- **Svelte `bind:innerHTML`.** Deprecated; the current runes API uses
  `{@html}`. If you see it in legacy code, refactor.

## Anti-patterns

- **`trusted-types *`.** Disables the allowlist; every policy name is
  valid, which means attackers can name their own. Always enumerate.
- **Raw `{@html stringVar}` without `sanitizeHTML(...)`.** Works in
  dev (no TT), breaks in prod. ESLint rule blocks it:
  `no-restricted-syntax` for `{@html}` without `sanitizeHTML`.
- **Creating policies in components.** Policies are global modules;
  component-scoped creation races with CSP directive evaluation.
  Always in `$lib/security/trusted-types.ts`.
- **Default policy that returns input unchanged.** Defeats the point
  of TT entirely; the default policy must sanitize (or throw).
- **Enforcing TT in dev without HMR-aware skip.** Breaks dev-server
  live reload. Use Report-Only in dev, enforce in prod.
- **Policy per component.** Proliferates. Three is plenty: html, svg,
  default.
- **Trusted Types but no DOMPurify.** TT enforces "goes through a
  policy" but your policy must actually sanitize. TT + identity policy
  = XSS still trivial.
- **Mixing TT with `bypassSecurityTrustHtml`-style escape hatches.**
  Any escape hatch invalidates the guarantee. Never.
- **Reporting endpoint without rate limiting.** Attackers can flood
  `/api/csp-report` to OOM the logger. Rate-limit + drop duplicates.
- **Forgetting the service worker context.** SWs have their own CSP.
  Set `require-trusted-types-for 'script'` in the SW script response
  header too — scripts imported by the SW count.

## References

- [markdown.md](markdown.md) — DOMPurify at `{@html}` boundary.
- [theming.md](theming.md) — CSP header wiring.
- [pwa.md](pwa.md) — service-worker CSP additions.
- [ai-streaming.md](ai-streaming.md) — LLM output sink.
- [ai-vercel-sdk.md](ai-vercel-sdk.md) — AI SDK chat sink.
- [principles.md §2.2](../principles.md) — OWASP ASVS L2.
- [ADR-0026](../adr/0026-markdown-runtime-build-split.md) — markdown
  sanitization.
- Trusted Types spec: <https://w3c.github.io/trusted-types/dist/spec/>.
- Chrome DevRel intro: <https://web.dev/articles/trusted-types>.
- DOMPurify TT: <https://github.com/cure53/DOMPurify#does-it-support-trusted-types>.
- OWASP ASVS V5.2 (sanitization): <https://owasp.org/www-project-application-security-verification-standard/>.
