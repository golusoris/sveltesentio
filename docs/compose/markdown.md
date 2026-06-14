# Markdown — runtime (`marked` + `DOMPurify`) vs build-time (`mdsvex`)

Markdown has two distinct lanes per
[ADR-0026](../adr/0026-markdown-runtime-build-split.md):

1. **Runtime user input** (chat, comments, notes) — XSS sink. Every
   `innerHTML` boundary must run through `DOMPurify.sanitize()` with a
   hardened allowlist. arca's `NotesEditor.svelte:62-63` shipped a
   literal "TODO: should add DOMPurify in prod" — dispositive XSS risk.
2. **Build-time authored content** (`.md` pages, docs) — compiled to
   Svelte components via `mdsvex`. No runtime sink.

`@sveltesentio/ui/markdown` ships both. **Picking the wrong lane is the
anti-pattern.** A single library for both optimises the wrong axis.

Related: [a11y-audit-runbook.md](a11y-audit-runbook.md) (axe rule for
`button-name` etc.), `docs/compliance/xss-sinks.md` (every `innerHTML`
boundary).

## Decision matrix

| Source | Library | Where it runs |
|---|---|---|
| User input (chat, comments) | `<Markdown source>` (marked + DOMPurify) | Runtime in browser |
| Authored docs (`.md` files) | `mdsvex` preprocessor | Build time |
| AI model output rendered to user | `<Markdown source>` (treat as untrusted!) | Runtime |
| Embedded help text in component | `mdsvex` (`.svx` file) | Build time |

Rule: **anything that isn't 100% in your repo at build time goes
through the runtime sanitizer.**

## Install

```bash
pnpm add marked dompurify
pnpm add -D mdsvex
```

`@sveltesentio/ui/markdown` re-exports both with the pin applied:
`marked@^18`, `dompurify@^3`, `mdsvex@^0.12`.

## Runtime: `<Markdown source>`

```svelte
<script lang="ts">
  import { Markdown } from '@sveltesentio/ui/markdown';
</script>

<Markdown source={comment.body} />
```

Wrapper internals (simplified):

```svelte
<!-- @sveltesentio/ui/markdown/Markdown.svelte -->
<script lang="ts">
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import { browser } from '$app/environment';

  type Props = {
    source: string;
    unsafe?: boolean;          // bypasses sanitizer; loud opt-out
    class?: string;
  };

  let { source, unsafe = false, class: className }: Props = $props();

  const html = $derived.by(() => {
    const raw = marked.parse(source, { async: false }) as string;
    if (unsafe) return raw;
    return browser
      ? DOMPurify.sanitize(raw, ALLOWLIST)
      : sanitizeServer(raw);   // jsdom-based
  });
</script>

<div class={className}>{@html html}</div>
```

`{@html}` is the Svelte XSS sink. The `$derived` runs the sanitizer
**every** render — `DOMPurify.sanitize` is fast (~µs per KB) and
correctness wins over caching.

## The allowlist

```ts
// @sveltesentio/ui/markdown/allowlist.ts
export const ALLOWLIST: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'strong', 'em', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  ALLOWED_ATTR: [
    'href', 'title', 'src', 'alt', 'rel', 'target', 'class',
  ],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|data:image\/(png|jpeg|webp|gif))/i,
  ADD_ATTR: ['target', 'rel'],
};
```

Defaults are:

- **No `<script>`, `<iframe>`, `<object>`, `<embed>`.** These are
  XSS sinks.
- **No event handlers.** `onclick="…"`, `onerror="…"` stripped.
- **No `javascript:` URIs.** `ALLOWED_URI_REGEXP` blocks them.
- **No `style` attribute.** CSS injection vector.
- **`data:` URIs only for image MIME types.** Prevents
  `data:text/html,<script>` injection.

Allowlist changes go via ADR amendment — security boundary, not
ergonomics.

## Link policy

External links auto-get `rel="noopener noreferrer" target="_blank"`:

```ts
const renderer = new marked.Renderer();
renderer.link = (href, title, text) => {
  const isExternal = /^https?:\/\//.test(href ?? '');
  const attrs = [
    `href="${href}"`,
    title && `title="${title}"`,
    isExternal && 'rel="noopener noreferrer"',
    isExternal && 'target="_blank"',
  ].filter(Boolean).join(' ');
  return `<a ${attrs}>${text}</a>`;
};
marked.use({ renderer });
```

`noopener` defends against `window.opener` redirect attacks;
`noreferrer` strips Referer for privacy.

## Image policy

Images load from any `https:` host by default — that's a tracking +
bandwidth surface. Two hardening options:

**(a) Allow-list specific hosts:**

```ts
ALLOWED_URI_REGEXP: /^(?:https:\/\/(cdn\.example\.com|images\.example\.com))/i,
```

**(b) Proxy through your origin:**

```ts
renderer.image = (href, title, text) => {
  const proxied = `/api/img-proxy?url=${encodeURIComponent(href ?? '')}`;
  return `<img src="${proxied}" alt="${text}" loading="lazy">`;
};
```

The proxy adds `Referrer-Policy: no-referrer` + caches + can scan
content. Trade-off: bandwidth + cost.

## Code blocks

```ts
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
hljs.registerLanguage('javascript', javascript);

renderer.code = (code, lang) => {
  const valid = lang && hljs.getLanguage(lang);
  const highlighted = valid
    ? hljs.highlight(code, { language: lang }).value
    : escapeHtml(code);
  return `<pre><code class="hljs language-${valid ? lang : 'plaintext'}">${highlighted}</code></pre>`;
};
```

Lazy-load only the languages your app actually uses — `highlight.js`
full bundle is 700 KB. Per-language imports stay <5 KB each.

The DOMPurify allowlist permits `<pre><code class="hljs …">` but
strips inline styles — colors come from CSS rules on `.hljs-*`
classes (theme via [theming.md](theming.md) tokens).

## SSR

`DOMPurify` requires a DOM. Server-side wrap with `jsdom`:

```ts
// @sveltesentio/ui/markdown/sanitize-server.ts
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window as unknown as Window);

export const sanitizeServer = (html: string) =>
  DOMPurify.sanitize(html, ALLOWLIST);
```

Cost: jsdom adds ~3 MB to the server bundle. Acceptable for SSR
correctness — never skip server-side sanitization assuming the
client will catch it (some flows ship sanitized HTML to APIs).

## The `unsafe` escape hatch

```svelte
<Markdown source={trustedAdminHtml} unsafe />
```

Bypasses the sanitizer. Justified only when:

- Source is a trusted admin's authored content.
- Source has been sanitized at a prior boundary (you can prove it).
- Output is in an iframe sandbox.

ESLint flags any `unsafe={true}` with a custom rule:

```js
// eslint.config.js
{
  rules: {
    'svelte/no-markdown-unsafe': 'warn',  // custom; require justification comment
  },
}
```

Every `unsafe` use needs an inline comment explaining why. Code
review must validate.

## Build-time: `mdsvex`

```js
// svelte.config.js
import { mdsvex } from 'mdsvex';

export default {
  extensions: ['.svelte', '.svx'],
  preprocess: mdsvex({
    extensions: ['.svx', '.md'],
    layout: { _: './src/lib/layouts/Doc.svelte' },
    rehypePlugins: [/* … */],
    remarkPlugins: [/* … */],
  }),
};
```

Authored `.md` / `.svx` files compile to Svelte components — no
runtime sink, no DOMPurify needed:

```svx
---
title: Getting Started
---

# {title}

Use `<Markdown>` for runtime content.
```

```svelte
<script lang="ts">
  import GettingStarted from '$lib/docs/getting-started.md';
</script>

<GettingStarted />
```

`mdsvex` permits Svelte components in markdown:

```svx
# Counter demo

<Counter initial={5} />
```

This is fine because authoring is a build-time trust boundary — you
review the source.

## Front-matter typing

```ts
// $lib/docs/types.ts
import { z } from 'zod';

export const DocFrontmatter = z.object({
  title: z.string(),
  description: z.string().optional(),
  publishedAt: z.iso.date().optional(),
  draft: z.boolean().default(false),
});
```

Validate at the page route:

```ts
// src/routes/docs/[slug]/+page.ts
export const load = async ({ params }) => {
  const mod = await import(`$lib/docs/${params.slug}.md`);
  const meta = DocFrontmatter.parse(mod.metadata);
  return { meta, default: mod.default };
};
```

Schema-invalid front matter fails the build via the load function;
no silent typos.

## A11y in rendered markdown

The sanitizer permits semantic tags but doesn't enforce hierarchy.
Common axe issues:

- **`heading-order`** — markdown author skips `##` → `####`. Add a
  remark plugin to normalize, or document the convention.
- **`image-alt`** — `![](url)` produces `<img alt="">`. Block empty
  alt unless explicitly decorative; lint markdown source.
- **`color-contrast` on highlighted code** — code-block theme must
  hit AA. Test per
  [a11y-audit-runbook.md](a11y-audit-runbook.md).

## Testing

```ts
import { Markdown } from '@sveltesentio/ui/markdown';
import { render } from '@testing-library/svelte';

test('strips script tag', () => {
  const { container } = render(Markdown, {
    props: { source: 'hi <script>alert(1)</script>' },
  });
  expect(container.innerHTML).not.toContain('<script');
  expect(container.innerHTML).not.toContain('alert');
});

test('strips javascript: href', () => {
  const { container } = render(Markdown, {
    props: { source: '[click](javascript:alert(1))' },
  });
  expect(container.querySelector('a')?.getAttribute('href')).not.toMatch(/^javascript:/);
});

test('preserves safe code block', () => {
  const { container } = render(Markdown, {
    props: { source: '```js\nconst x = 1\n```' },
  });
  expect(container.querySelector('pre code.hljs')).toBeTruthy();
});
```

Run XSS payloads from the
[OWASP cheat sheet](https://owasp.org/www-community/xss-filter-evasion-cheatsheet)
as a regression suite. Every payload should fail to render as
JS-executing HTML.

## CSP interaction

Even with sanitization, a strict CSP is the second wall:

```text
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';   # unfortunately needed for highlight themes
  img-src 'self' https:;
  frame-src 'none';
```

If sanitizer fails, CSP catches the inline `<script>` injection.
See `docs/compliance/owasp-asvs-l2.md` for the full CSP recipe.

## Anti-patterns

- **Runtime markdown without DOMPurify.** Dispositive XSS — the
  arca pattern.
- **Trusting `marked`'s sanitization options.** Removed in v5+;
  DOMPurify is the only safe path.
- **Allowlisting `<style>` or `style=` attribute.** CSS injection
  vector.
- **Allowlisting `<iframe>` for embeds.** Use a dedicated embed
  component with sandbox attributes; never via markdown sink.
- **Skipping SSR sanitization.** Some pipelines ship server-rendered
  HTML to APIs / archive — assume client-side might be bypassed.
- **`mdsvex` for user input.** mdsvex is a compile-time
  preprocessor; pointing it at runtime input is a build-time RCE
  vector.
- **`{@html source}` directly anywhere.** If you're not going through
  `<Markdown>`, you're rolling your own sanitizer. Don't.
- **`unsafe={true}` without justification comment.** ESLint flag
  + code review block.
- **Loading `highlight.js` full bundle.** 700 KB — register only
  the languages you use.

## References

- ADR-0026 — `marked` + `DOMPurify` runtime split from `mdsvex`
  build-time.
- `docs/compliance/xss-sinks.md` — every `innerHTML` boundary
  inventory.
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — heading-order,
  image-alt, contrast.
- [theming.md](theming.md) — code-block theme tokens.
- DOMPurify: <https://github.com/cure53/DOMPurify>.
- marked: <https://marked.js.org>.
- mdsvex: <https://mdsvex.pngwn.io>.
- OWASP XSS prevention cheat sheet:
  <https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html>.
