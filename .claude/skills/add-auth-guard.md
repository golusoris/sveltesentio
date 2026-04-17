# Skill: add-auth-guard

Add authentication and authorization guards to SvelteKit routes.

## When to use

When a route requires the user to be logged in, or needs role-based access control.

---

## Pattern A — Server-side guard in `+page.server.ts`

Redirects unauthenticated users before the page loads.

```typescript
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.session) throw redirect(302, '/login');
  // Role check:
  if (!locals.session.roles.includes('admin')) throw redirect(302, '/');
  return { user: locals.session.user };
};
```

---

## Pattern B — Route group with shared guard

For many routes sharing the same auth requirement, use a layout guard.

```
src/routes/
  (authed)/
    +layout.server.ts   ← single guard for all routes in the group
    dashboard/
      +page.svelte
    settings/
      +page.svelte
```

```typescript
// src/routes/(authed)/+layout.server.ts
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types.js';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.session) throw redirect(302, '/login');
  return { session: locals.session };
};
```

---

## Pattern C — Client-side permission runes

For UI-only visibility (server guard still required for data security).

```svelte
<script lang="ts">
  import type { PageData } from './$types.js';

  const { data }: { data: PageData } = $props();

  const canEdit = $derived(data.session?.roles.includes('editor') ?? false);
  const canDelete = $derived(data.session?.roles.includes('admin') ?? false);
</script>

{#if canEdit}
  <button>Edit</button>
{/if}
```

---

## Setting up `locals.session` in hooks

```typescript
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { validateSession } from '@sveltesentio/auth';

export const handle: Handle = async ({ event, resolve }) => {
  const sessionToken = event.cookies.get('session');
  event.locals.session = sessionToken ? await validateSession(sessionToken) : null;
  return resolve(event);
};
```

## Rules

- Server guard is ALWAYS required — client guard is UI only, never security
- Use route groups `(authed)/` to share guards across many routes
- Never put auth logic in `+page.svelte` — always `+page.server.ts` or `+layout.server.ts`
- `locals.session` shape comes from `@sveltesentio/auth` types
