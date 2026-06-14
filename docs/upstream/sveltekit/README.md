---
pinned-version: 2.x
canonical-url: https://svelte.dev/docs/kit
last-verified: 2026-04-18
---

# SvelteKit — v2.x snapshot

Pinned: **`@sveltejs/kit ^2.0.0`** (peerDependency in `@sveltesentio/core`)
Canonical: https://svelte.dev/docs/kit

## Routing

File-based under `src/routes/`. Special files:

| File | Purpose |
|---|---|
| `+page.svelte` | Page UI |
| `+page.ts` | Universal load (runs on server + client) |
| `+page.server.ts` | Server-only load + form actions |
| `+layout.svelte` / `+layout.ts` / `+layout.server.ts` | Nested layout |
| `+server.ts` | API endpoint (returns `Response`) |
| `+error.svelte` | Error boundary |

Dynamic segments: `[slug]`, `[...rest]`, `[[optional]]`, `(group)/`, `[[lang=lang]]/`.

## Load functions

```ts
// +page.server.ts
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, fetch, depends }) => {
  depends('app:posts');                      // for invalidate('app:posts')
  const post = await locals.db.post.find(params.id);
  return { post };                            // typed in +page.svelte via PageData
};
```

```ts
// +page.ts — universal
import type { PageLoad } from './$types';
export const load: PageLoad = async ({ fetch, parent, data }) => {
  const { user } = await parent();
  return { ...data, user };
};
```

## Form actions

```ts
// +page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const form = await request.formData();
    if (!form.get('email')) return fail(400, { error: 'email required' });
    redirect(303, '/dashboard');
  },
  delete: async ({ request, locals }) => { /* named action */ }
};
```

## API endpoints (`+server.ts`)

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  const items = await locals.db.list();
  return json(items);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  // validate with Zod at the boundary (principles §2.2)
  return json({ ok: true }, { status: 201 });
};
```

## Hooks (`src/hooks.server.ts`)

```ts
import type { Handle, HandleServerError } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = await getUser(event);
  return resolve(event, {
    transformPageChunk: ({ html }) => html,
    filterSerializedResponseHeaders: () => false
  });
};

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  return { message: 'Internal error', code: 'E_INTERNAL' };
};
```

## Navigation & state

```ts
import { goto, invalidate, invalidateAll, preloadData } from '$app/navigation';
import { page } from '$app/state';            // rune-based ($app/stores is legacy)

await goto('/posts', { replaceState: false, invalidateAll: true });
await invalidate('app:posts');                // re-runs loads with depends('app:posts')
```

`$app/stores` (legacy `writable`-based) is **deprecated** in v2; use `$app/state` (rune-based: `page.url`, `page.params`, `page.data`, `navigating`, `updated`).

## `sveltesentio` usage

- `@sveltesentio/core` re-exports its Vite plugin + env schema; never re-export SvelteKit primitives.
- Hook chain assembly lives in `@sveltesentio/auth` (sequence pattern) — see ADR list.
- API endpoints use `openapi-fetch`-typed clients on the consumer side; see [docs/compose/](../../compose/) for the recipe.

## Gotchas

- `redirect()` and `error()` **throw**; don't `return` them and don't wrap in `try/catch` unless rethrowing.
- `+page.ts` runs on both server and client — guard server-only code with `if (browser)` from `$app/environment`.
- `event.fetch` (server-side) preserves cookies and short-circuits same-origin calls. Always use it inside `load`, never bare `fetch`.
- Form actions return `{ form }` to the page automatically — typed via `PageData` + `ActionData`.
- `cookies.set` defaults to `httpOnly: true`, `secure: true` (in prod), `sameSite: 'lax'`.

## Links

- v2 migration: https://svelte.dev/docs/kit/migrating-to-sveltekit-2
- Adapters: https://svelte.dev/docs/kit/adapters
