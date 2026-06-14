---
pinned-version: 2.x
canonical-url: https://inlang.com/m/gerre34r/library-inlang-paraglideJs
last-verified: 2026-04-18
---

# Paraglide JS — v2.x snapshot

Pinned: **`@inlang/paraglide-js ^2.0.0`** (peerDependency in `@sveltesentio/i18n`)
Canonical: https://inlang.com/m/gerre34r/library-inlang-paraglideJs

Paraglide v2 is a framework-agnostic i18n compiler. The legacy `@inlang/paraglide-sveltekit` adapter is no longer maintained — v2 is consumed via the Vite plugin directly.

## Project setup

```bash
pnpm dlx @inlang/paraglide-js init
```

Generates `project.inlang/`, `messages/<locale>.json`, and adds the Vite plugin.

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide'
    }),
    sveltekit()
  ]
});
```

## Messages → typed functions

`messages/en.json`:

```json
{ "hello": "Hello {name}", "items": "{count, plural, one {# item} other {# items}}" }
```

Compiles to `src/lib/paraglide/messages.js`:

```ts
import * as m from '$lib/paraglide/messages';

m.hello({ name: 'Ada' });            // "Hello Ada"
m.items({ count: 3 });               // "3 items"
```

Type-safe: missing keys, missing params, and invalid plural categories are TypeScript errors.

## Locale management

```ts
import { setLocale, getLocale, locales, baseLocale } from '$lib/paraglide/runtime';

setLocale('de');                     // updates locale + persists per strategy
getLocale();                          // -> 'de'
locales;                              // ['en', 'de', ...]
```

## Locale strategies (URL / cookie / preferredLanguage)

```ts
paraglideVitePlugin({
  project: './project.inlang',
  outdir: './src/lib/paraglide',
  strategy: ['url', 'cookie', 'preferredLanguage', 'baseLocale']
})
```

The `url` strategy reads/writes a path prefix (`/de/about`); `cookie` uses `PARAGLIDE_LOCALE`; `preferredLanguage` reads `Accept-Language`. Order = priority.

## SvelteKit hook

```ts
// src/hooks.server.ts
import { paraglideMiddleware } from '$lib/paraglide/server';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ request, locale }) => {
    event.request = request;
    return resolve(event, { transformPageChunk: ({ html }) => html.replace('%lang%', locale) });
  });
```

## `sveltesentio` usage

- `@sveltesentio/i18n` re-exports the Vite plugin + middleware + a `LocaleSwitcher.svelte` component.
- Messages live in the consuming app's `messages/` directory — the framework does not bundle translations.
- Tree-shaking: only used messages ship to the client. Verify with bundle visualizer.

## Gotchas

- v1 `paraglide-sveltekit` adapter is **deprecated**; do not suggest it.
- `setLocale` triggers a navigation when using the `url` strategy — call it from a click handler, not during render.
- `messages.*` functions return strings, not stores — they re-evaluate at render time because the runtime locale is reactive.
- ICU MessageFormat is supported (plural / select / number / date) but custom formatters require runtime config.
- The compiler runs at Vite startup; missing message keys surface as build-time errors only after the first compile — restart `vite dev` after adding locales.

## Links

- v1 → v2 migration: https://inlang.com/m/gerre34r/library-inlang-paraglideJs/migrating-from-v1
- Strategies: https://inlang.com/m/gerre34r/library-inlang-paraglideJs/strategy
- ICU MessageFormat: https://unicode-org.github.io/icu/userguide/format_parse/messages/
