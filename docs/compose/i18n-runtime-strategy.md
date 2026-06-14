# i18n — Paraglide v2 runtime strategy

`@sveltesentio/i18n` re-exports Paraglide v2 per
[ADR-0017](../adr/0017-paraglide-v2-i18n-default.md). This recipe
focuses on the **runtime strategy chain** — how Paraglide picks the
active locale per request, which sources it consults, and the
trade-offs of each ordering. The basic setup (`paraglideVitePlugin()`,
`messages/`, typed keys) is in the package README; this doc goes deep
on SSR-vs-client correctness.

Related: [ADR-0040](../adr/0040-paraglide-strategy-logical-properties.md)
(logical-properties RTL posture), [theming.md](theming.md) (ltr/rtl
bindings), [safe-area.md](safe-area.md) (`ps-*` logical variants).

## The strategy chain

```ts
// vite.config.ts
import { paraglideVitePlugin } from '@inlang/paraglide-js';

export default defineConfig({
  plugins: [
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
      strategy: ['url', 'cookie', 'preferredLanguage', 'baseLocale'],
    }),
  ],
});
```

Paraglide evaluates the strategy **left to right**, returning the
first match. Each entry has different SSR / caching implications:

| Strategy | Source | SSR-safe? | Cacheable? | When to use |
|---|---|---|---|---|
| `url` | `/en/…`, `/de/…` path prefix or subdomain | ✅ | Per-URL cache | SEO-critical content; shareable URLs must carry locale |
| `cookie` | `NEXT_LOCALE` / custom cookie | ✅ | Per-cookie cache (`Vary: Cookie`) | User-selected override that persists across sessions |
| `preferredLanguage` | `Accept-Language` header | ✅ | Per-AL cache (`Vary: Accept-Language`) | First-visit default before user picks |
| `baseLocale` | configured default (e.g. `en`) | ✅ | Fully cacheable | Final fallback |
| `localStorage` | client-only storage | ❌ SSR | Not cacheable | Don't use server-side |
| `custom` | user-supplied resolver | depends | depends | advanced / DB-backed preferences |

**Recommended default:** `['url', 'cookie', 'preferredLanguage', 'baseLocale']`.
`url` wins for shareability; `cookie` for sticky user pick;
`preferredLanguage` for zero-config first visits; `baseLocale` never
fails.

## Why `url` first

A URL-carried locale (`/de/flows/123`) is:

- **Shareable** — send a link, recipient sees same locale.
- **SEO-friendly** — Google indexes `/de/*` separately with
  `hreflang` annotations.
- **Cacheable** — CDNs key on URL; no `Vary` overhead.
- **Deterministic** — no hidden state.

Putting `cookie` before `url` breaks sharing: user A shares `/de/x`
to user B whose cookie says `fr` → user B sees French at a German
URL. Confusing + breaks hreflang expectations.

## Why `cookie` before `preferredLanguage`

The user's explicit pick (cookie) always outranks their browser's
default (Accept-Language). Browser settings are often wrong for
travel / shared devices.

Cookie shape:

```text
Name:    PARAGLIDE_LOCALE
Path:    /
SameSite: Lax
Secure:  true (production)
HttpOnly: false          ← client must set on language switcher
Max-Age: 31536000        ← 1 year
```

`HttpOnly: false` — the language switcher writes it from JS. Not a
sensitive value; cookie guardrails don't apply.

## The reroute hook

URL-based strategies need `reroute()` to map `/de/x` → internal
`/x` with locale in `event.locals`:

```ts
// src/hooks.ts
import { deLocalizeUrl } from '$lib/paraglide/runtime';

export const reroute = ({ url }) => deLocalizeUrl(url).pathname;
```

This is the key Paraglide v2 boundary — `deLocalizeUrl` strips the
locale prefix so every route handler writes locale-free paths
(`/flows/[id]`) and Paraglide injects `/de` on `<a>` href
generation.

## hooks.server.ts wiring

```ts
// src/hooks.server.ts
import { paraglideMiddleware } from '$lib/paraglide/server';
import { sequence } from '@sveltejs/kit/hooks';

const i18nHandle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ request, locale }) => {
    event.request = request;
    event.locals.locale = locale;
    return resolve(event, {
      transformPageChunk: ({ html }) =>
        html.replace('%lang%', locale).replace('%dir%', dirOf(locale)),
    });
  });

export const handle = sequence(i18nHandle, /* withTheme, withTenant, … */);

function dirOf(locale: string): 'ltr' | 'rtl' {
  return ['ar', 'he', 'fa', 'ur'].includes(locale.split('-')[0]) ? 'rtl' : 'ltr';
}
```

Two HTML template holes in `app.html`:

```html
<html lang="%lang%" dir="%dir%">
```

`dir="rtl"` is mandatory for Arabic/Hebrew/Persian/Urdu; Tailwind's
logical properties (`ms-*`, `pe-*`) flip automatically — see
[safe-area.md](safe-area.md) for the full logical-property table.

## Cache + `Vary` posture

```ts
// inside paraglideMiddleware's resolve:
setHeaders({
  Vary: 'Accept-Language, Cookie',
});
```

Why:

- URL-keyed strategies don't need `Vary` (different URL = different
  cache key).
- `cookie` needs `Vary: Cookie` or CDNs collapse variants.
- `preferredLanguage` needs `Vary: Accept-Language` or first-visitor
  locale gets served to everyone.

Combining both headers costs cache diversity (CDN keeps N×M
variants) but keeps correctness. Strip when possible — a
fully-URL-driven i18n site can `Vary: null`.

## Adapter-static gotcha

`@sveltejs/adapter-static` requires `paths: { relative: false }`
when Paraglide is active. Relative paths break Paraglide's runtime
URL rewriting:

```ts
// svelte.config.js
import adapter from '@sveltejs/adapter-static';
export default {
  kit: {
    adapter: adapter(),
    paths: { relative: false },   // ← required
  },
};
```

Consumer apps on `adapter-node` / `adapter-vercel` are unaffected.

## Typed keys helper

Paraglide generates per-message functions. Wrap with a typed helper
so consumers get autocomplete + a single import:

```ts
// @sveltesentio/i18n/m.ts
export { m } from '../paraglide/messages';
```

Usage:

```svelte
<script lang="ts">
  import { m } from '@sveltesentio/i18n';
</script>

<h1>{m.greeting({ name: 'Ada' })}</h1>
```

`m.greeting` is typed; passing an unknown key fails at compile time.
Passing wrong params (`{ name: 123 }` when string expected) also
fails.

## Build vs runtime split

Paraglide is **compile-time**. Messages are extracted at `vite
build` → per-locale chunks with tree-shaking. Consequence:

- **No runtime message edits.** Translation platforms that push
  live updates (Crowdin Live, Lokalise in-context) don't work out
  of the box.
- **New locale = rebuild.** Shipping a new locale is a deploy, not
  a config change.

Trade-off vs runtime i18n (svelte-i18n, typesafe-i18n runtime):

| | Paraglide v2 | Runtime i18n |
|---|---|---|
| Bundle size | ~70% smaller | Full catalog ships |
| Live updates | Rebuild required | Hot-swap |
| Tree-shake per locale | Yes | Bundler-dependent |
| SSR HTML | Pre-rendered | Runtime-resolved |
| Translation platform | Push-to-git | API-driven |

Sveltesentio picks compile-time (ADR-0017). If you need live updates,
document the deploy-on-translate cadence upfront.

## ICU plurals + complex messages

```ts
// messages/en.json
{
  "cart": "{count, plural, =0 {Cart is empty} one {# item} other {# items}}"
}
```

Paraglide compiles ICU → TS functions with typed params. No runtime
ICU parser ships to the client — the branching is pre-compiled.

## Locale switcher pattern

```svelte
<script lang="ts">
  import { localizeUrl, locales } from '$lib/paraglide/runtime';
  import { page } from '$app/stores';

  function switchTo(locale: string) {
    document.cookie = `PARAGLIDE_LOCALE=${locale}; path=/; max-age=31536000; SameSite=Lax; Secure`;
    window.location.href = localizeUrl($page.url, { locale });
  }
</script>

<label for="locale">Language</label>
<select id="locale" onchange={(e) => switchTo(e.currentTarget.value)}>
  {#each locales as locale}
    <option value={locale} selected={$page.data.locale === locale}>{locale}</option>
  {/each}
</select>
```

Full-page navigation is intentional — SSR needs the new locale from
the start. SPA-style locale swap works but breaks server-rendered
HTML until next request.

## RTL defaults

Every layout uses logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`)
per ADR-0040. Tailwind 4 handles this automatically when `dir="rtl"`
is set. Test with:

```bash
pnpm dev --locale=ar
```

And a Playwright visual regression per RTL locale.

Never use `ml-*` / `mr-*` in components. If an AI agent adds them,
flag via ESLint (`tailwindcss/no-custom-classname` + custom rule).

## Preferred language detection (first visit)

`preferredLanguage` reads `Accept-Language` which is comma-weighted:

```text
Accept-Language: de-DE,de;q=0.9,en;q=0.8
```

Paraglide picks the best match against configured locales. If none
match, falls through to `baseLocale`. Don't attempt to probe IP
geolocation as a fallback — locale ≠ country and the UX is hostile.

## Testing

```ts
// vitest
import { m } from '$lib/paraglide/messages';
import { setLocale } from '$lib/paraglide/runtime';

test('German greeting', () => {
  setLocale('de');
  expect(m.greeting({ name: 'Ada' })).toBe('Hallo, Ada!');
});
```

Playwright:

```ts
test('url strategy overrides cookie', async ({ context, page }) => {
  await context.addCookies([{ name: 'PARAGLIDE_LOCALE', value: 'fr', url: 'http://localhost:5173' }]);
  await page.goto('/de/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});
```

## Migration from Paraglide v1 + `@inlang/paraglide-sveltekit`

The separate SvelteKit adapter is deprecated by v2:

```bash
pnpm remove @inlang/paraglide-sveltekit
pnpm add @inlang/paraglide-js@latest
```

Replace `import { … } from '@inlang/paraglide-sveltekit'` with
`@inlang/paraglide-js`. The adapter's `i18n.handle()` becomes the
`paraglideMiddleware()` above. No message-format changes — catalogs
carry over.

arca is the reference integration (see
`golusoris/app-arca/src/lib/paraglide/`).

## Anti-patterns

- **`['cookie', 'url', …]` order.** Sharing-breaks per above.
- **`localStorage` strategy.** SSR-incompatible. `<html lang>` will
  be wrong on first paint.
- **`ml-*` / `mr-*` Tailwind classes.** Break RTL. Use logical
  properties (see ADR-0040).
- **Omitting `paths.relative = false` on adapter-static.** Paraglide
  URL rewriting silently breaks.
- **Live-updating messages without rebuild.** Paraglide is
  compile-time. Schedule deploys.
- **Probing IP geo for locale.** Locale ≠ country. Use browser
  Accept-Language.
- **Shipping `@inlang/paraglide-sveltekit` on v2.** Deprecated.
  Remove.
- **`Vary: *`.** Kills all CDN caching. Be surgical: `Accept-Language,
  Cookie` only if both strategies are active.

## References

- ADR-0017 — Paraglide v2 as default.
- ADR-0040 — logical-properties RTL posture.
- ADR-0018 — `@sveltesentio/i18n` wrapper.
- [theming.md](theming.md) — ltr/rtl CSS.
- [safe-area.md](safe-area.md) — `ps-*` / `pe-*` safe-area variants.
- Paraglide v2 docs: <https://inlang.com/m/gerre34r/library-inlang-paraglideJs>.
- SvelteKit hreflang guide: <https://kit.svelte.dev/docs/seo#manual-setup-lang>.
