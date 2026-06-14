# Theming — flash-free dark mode (cookie + DB hybrid)

Dark-mode persistence via **cookie** (anonymous) + **user DB record**
(signed in) — never `localStorage`. The server injects
`<html data-theme="dark">` during SSR so the first paint never flashes.
`mode-watcher` handles client toggling + cookie writes.

See [ADR-0048](../adr/0048-cookie-backed-dark-mode.md) (decision) and
[ADR-0030](../adr/0030-mode-watcher-pin.md) (mode-watcher pin).
Related: [theming.md](theming.md) (oklch token pipeline),
[auth-oidc.md](auth-oidc.md) (session shape for DB preference mirror).

## Why not `localStorage`

`localStorage` is client-only — the server can't read it, so the first
paint is the server's default (light). On hydration, the client reads
`localStorage`, switches to dark, and the user sees a flash. UX
regression. **Never use `localStorage` for theme.**

## Resolution order

```text
1. signed-in user     → DB preference (server-read via session)
2. cookie present     → cookie value ('dark' | 'light' | 'system')
3. Sec-CH-Prefers-Color-Scheme header (Chrome 119+, Edge 120+)
4. fall back to 'light'
```

The result lands on `<html data-theme="...">` before the first paint.

## Install

```bash
pnpm add @sveltesentio/ui mode-watcher
```

Peer range: `mode-watcher@^1`, `svelte@^5`.

## Server hook

```ts
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { withTheme } from '@sveltesentio/ui/theme';

export const handle = sequence(
  withTheme({
    cookie: 'theme',            // cookie name — default 'sv_theme'
    default: 'system',          // fallback when nothing resolved
    dbPreferenceKey: 'theme',   // optional — reads event.locals.user?.prefs[key]
  }),
);
```

`withTheme` is a SvelteKit hook that:

1. Reads the cookie + DB preference + `Sec-CH-Prefers-Color-Scheme`.
2. Sets `event.locals.theme` to `'dark'` / `'light'` / `'system'`.
3. Rewrites the HTML response, stamping `data-theme` on `<html>`.
4. Emits `Accept-CH: Sec-CH-Prefers-Color-Scheme` + `Vary: Sec-CH-Prefers-Color-Scheme`
   so browsers send the hint on subsequent requests.

No client code runs before the first paint — the theme is already
correct when the HTML arrives.

## `app.html` shape

`withTheme` rewrites the `<html>` tag via a text transform. The template
must have a `%sveltekit.head%`-style marker for the attribute injection:

```html
<!-- src/app.html -->
<!DOCTYPE html>
<html lang="en" data-theme="%sveltekit.theme%">
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light dark" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

The hook replaces `%sveltekit.theme%` with the resolved value. If your
template doesn't have this marker, the hook falls back to injecting a
class on `<html>` via `transformPageChunk`.

## Layout data

Expose the resolved theme via `+layout.server.ts` so client components
can read it without re-running the hook:

```ts
// src/routes/+layout.server.ts
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  return { theme: locals.theme }; // 'dark' | 'light' | 'system'
};
```

## Client toggle

```svelte
<!-- src/lib/components/ThemeToggle.svelte -->
<script lang="ts">
  import { toggleMode, mode } from 'mode-watcher';
  import { Sun, Moon } from 'lucide-svelte';
</script>

<button
  type="button"
  onclick={toggleMode}
  aria-label={$mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
>
  {#if $mode === 'dark'}
    <Moon />
  {:else}
    <Sun />
  {/if}
</button>
```

`toggleMode` from `mode-watcher`:

1. Flips `data-theme` on `<html>`.
2. Writes the cookie (`document.cookie` — SameSite=Lax, 1 year).
3. Fires a `theme-change` custom event on `<html>`.

### Mirror to DB when signed in

On signed-in apps, pair the toggle with a server-side preference
update so the choice follows the user across devices:

```svelte
<script lang="ts">
  import { toggleMode, mode } from 'mode-watcher';
  import { api } from '$lib/api';

  async function toggle() {
    toggleMode();
    // Fire-and-forget DB update; cookie already reflects the new value.
    await api.PATCH('/user/prefs', { body: { theme: $mode } }).catch(() => {});
  }
</script>

<button onclick={toggle}>Toggle</button>
```

The cookie is the authoritative fast-path (server reads it on every
request). The DB row is the cross-device source — read on login, mirrored
into the cookie by `withTheme`.

## Cookie shape

```text
Name:      sv_theme (configurable)
Value:     dark | light | system
Path:      /
Domain:    (app default)
SameSite:  Lax
Secure:    true (in production)
HttpOnly:  false (client-readable — mode-watcher writes it too)
Max-Age:   31536000 (1 year)
```

`HttpOnly` is **off** by design — the client must write it when the
user toggles. The value is not sensitive; no tokens live here.

## `system` behavior

When the cookie value is `system`, the resolved theme follows
`prefers-color-scheme`. The server uses the request hint
(`Sec-CH-Prefers-Color-Scheme`); the client subscribes to the
`matchMedia` change event:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { setMode } from 'mode-watcher';

  onMount(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      // Only re-apply when user chose 'system'
      if (getCookie('sv_theme') === 'system') {
        setMode(mq.matches ? 'dark' : 'light', { persist: false });
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });
</script>
```

`mode-watcher` exposes `setMode(value, { persist })` so `system`-follow
updates don't overwrite the `system` cookie with `dark` / `light`.

## Testing flash-free behavior

Playwright assertion:

```ts
test('no flash on cold load', async ({ page, context }) => {
  await context.addCookies([
    { name: 'sv_theme', value: 'dark', domain: 'localhost', path: '/' },
  ]);

  // Capture first paint: the HTML must already have data-theme="dark"
  await page.goto('/');
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(theme).toBe('dark');

  // No subsequent class swap in the first 100ms (would indicate client-side flip)
  const observed = await page.evaluate(() => {
    return new Promise<string[]>((resolve) => {
      const seen: string[] = [];
      const obs = new MutationObserver((records) => {
        for (const r of records) {
          if (r.attributeName === 'data-theme') {
            seen.push(document.documentElement.dataset.theme ?? '');
          }
        }
      });
      obs.observe(document.documentElement, { attributes: true });
      setTimeout(() => resolve(seen), 100);
    });
  });
  expect(observed).toEqual([]); // zero class swaps
});
```

## Static-hosted surfaces

`withTheme` requires SSR. Purely static routes (prerendered, no
`+layout.server.ts` dependency) cannot read the cookie before the first
paint — they flash by definition.

Two options:

1. **Accept the flash** for static routes. `mode-watcher` mounts and
   applies the cookie; there's a ~50–200ms dark→light transition. OK
   for marketing pages; not OK for app surfaces.
2. **Opt those routes out of prerender.** Set `export const prerender = false;`
   so SSR runs and the hook resolves the theme server-side.

Most apps mix: marketing prerendered + app dynamic. The prerendered
flash is a documented trade-off of static hosting, not a framework bug.

## Interaction with tenant theming

Tenant overrides (see [tenant-theming.md](tenant-theming.md)) cascade
naturally — dark mode flips tokens; the tenant layer overrides a
subset; the two compose:

```css
:root[data-theme='dark'] {
  --color-accent: oklch(0.78 0.14 250);
}
:root[data-theme='dark'][data-tenant='acme'] {
  --color-accent: oklch(0.78 0.14 200); /* acme cyan, dark variant */
}
```

The hook sets `data-theme` first; `withTenant` (separate hook) sets
`data-tenant`. Order matters — compose via `sequence()`.

## Anti-patterns

- **`localStorage` for theme.** Flashes on SSR. Never.
- **`.dark` class via `class:dark={mode === 'dark'}`.** The framework
  uses `[data-theme='dark']`; the class selector breaks SSR injection.
- **Applying theme in `onMount`.** Too late — the first paint already
  happened. The hook must set `data-theme` server-side.
- **Skipping the hook.** Without `withTheme`, every return visit
  flashes. The hook is non-optional for signed-in surfaces.
- **Making the cookie `HttpOnly`.** The client toggle can't write it.
  Theme isn't a credential.
- **Overwriting the `system` cookie on prefers-color-scheme change.**
  `setMode(..., { persist: false })` — the cookie stays `system`; only
  the live class follows.
- **Using `mode-watcher` in a SSR-only context.** It's a client
  component. Pair with the server hook for initial state; use the
  rune/store for client interactions.

## References

- ADR-0048 — cookie-backed dark mode decision.
- ADR-0030 — mode-watcher pin.
- [theming.md](theming.md) — `@theme` + oklch token pipeline.
- [tenant-theming.md](tenant-theming.md) — tenant overrides compose
  with dark mode.
- `mode-watcher` docs: <https://mode-watcher.svecosystem.com>.
- MDN `Sec-CH-Prefers-Color-Scheme`: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-CH-Prefers-Color-Scheme>.
