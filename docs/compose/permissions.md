# Permissions — `load`-derived, not a global rune

Permissions flow from Golusoris → `+layout.server.ts` → `page.data` →
a `$derived` view via `usePermissions()`. **No global store, no
module-level mutable state.** Server state in a client-side rune is
exactly the anti-pattern [ADR-0008](../adr/0008-tanstack-svelte-query-v6.md)
and [CLAUDE.md](../../CLAUDE.md) forbid.

See [ADR-0035](../adr/0035-load-derived-permissions.md) for the decision.
Related: [auth-oidc.md](auth-oidc.md) (session loading),
[ADR-0019](../adr/0019-openapi-fetch-rfc9457.md) (authorization-failure
error shape).

## Mental model

```text
Golusoris                SvelteKit load               Component
─────────                ──────────────               ─────────
role + grants ──▶ +layout.server.ts ──▶ page.data ──▶ $derived view
                  permissions.load()    .permissions   usePermissions()
```

Permissions are **request-scoped**. Every SSR render calls
`permissions.load()`; no long-lived cache in the browser. This matches
SvelteKit's data model — permissions are load-time data, not
streaming server state.

## Install

```bash
pnpm add @sveltesentio/auth
```

## Load in a layout

```ts
// src/routes/+layout.server.ts
import { load as loadSession } from '@sveltesentio/auth/oidc';
import { load as loadPermissions } from '@sveltesentio/auth/permissions';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
  const session = await loadSession(event);
  const permissions = await loadPermissions(event, session);
  return { user: session?.user ?? null, permissions };
};
```

`loadPermissions` calls `GET /auth/permissions` on Golusoris with the
forwarded session cookie. The result is a typed shape:

```ts
type Permissions = {
  readonly roles: readonly string[];
  readonly grants: readonly Grant[];
};

type Grant = {
  readonly action: 'read' | 'edit' | 'delete' | 'admin';
  readonly resource: { type: string; id?: string };
};
```

Empty permissions (`{ roles: [], grants: [] }`) for anonymous users —
not `null`. Distinguishing "no permissions" from "not fetched" is
always a bug.

## Consume in a component

```svelte
<script lang="ts">
  import { usePermissions } from '@sveltesentio/auth/permissions';

  const perms = usePermissions();
</script>

{#if perms.can('edit', { type: 'flow', id: flowId })}
  <button onclick={openEditor}>Edit flow</button>
{/if}

{#if perms.hasRole('admin')}
  <AdminPanel />
{/if}
```

`usePermissions()` returns a `$derived` view of `page.data.permissions`:

```ts
type PermissionsView = {
  readonly roles: readonly string[];
  hasRole(role: string): boolean;
  can(action: Grant['action'], resource: Grant['resource']): boolean;
  canAny(action: Grant['action'], type: string): boolean; // any resource of type
};
```

All methods read from `$page.data.permissions` — reactive by
construction, no manual subscribe.

## Gate a route

`+layout.server.ts` can short-circuit unauthorized requests before the
page renders:

```ts
// src/routes/admin/+layout.server.ts
import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ parent }) => {
  const { permissions } = await parent();
  if (!permissions.roles.includes('admin')) {
    error(403, 'admin role required');
  }
  return {};
};
```

Server-side `error(403)` is the authoritative gate. The UI check above
(`{#if perms.hasRole('admin')}`) is presentation polish — **never** the
security boundary. Golusoris does the real check on every request.

## Per-route permissions (resource-scoped)

Load resource-specific grants in the deepest layout / page that needs
them — not in the root layout:

```ts
// src/routes/flows/[id]/+page.server.ts
import { load as loadResourcePermissions } from '@sveltesentio/auth/permissions';

export const load: PageServerLoad = async (event) => {
  const { params } = event;
  const resourcePerms = await loadResourcePermissions(event, {
    type: 'flow',
    id: params.id,
  });
  return { resourcePerms };
};
```

Scoping avoids over-fetching: the root layout doesn't need to know
about every resource the user could touch.

## Layered checks

A common pattern: some views read both global roles and
resource-scoped grants:

```svelte
<script lang="ts">
  import { usePermissions } from '@sveltesentio/auth/permissions';
  let { data } = $props();

  const perms = usePermissions();
  const canEdit = $derived(
    perms.hasRole('admin') || perms.can('edit', { type: 'flow', id: data.flowId }),
  );
</script>

<button disabled={!canEdit}>Save</button>
```

Computing via `$derived` keeps the check reactive and colocated with
the component that renders the button.

## Testing

In unit tests, inject `page.data.permissions` directly:

```ts
import { render } from '@testing-library/svelte';
import { page } from '$app/state';
import MyComponent from './MyComponent.svelte';

page.data = {
  permissions: { roles: ['editor'], grants: [{ action: 'edit', resource: { type: 'flow', id: 'f-1' } }] },
};

render(MyComponent);
```

In Playwright, mint a session with the required grants via Golusoris's
test-mode endpoint (see [auth-oidc.md](auth-oidc.md) § Testing).

## Anti-patterns

- **Global `$permissions` rune.** Violates ADR-0008 + CLAUDE.md — that's
  server state in a module-level store. Use `page.data` + `$derived`.
- **Caching permissions in `localStorage`.** Permissions change
  server-side (role revocations, grant expiry). Load per request.
- **Hiding UI as the security boundary.** `{#if perms.can(...)}` is UX.
  Golusoris enforces access on every request — an attacker who edits
  the DOM changes nothing.
- **`can()` returning `null` / `undefined`.** Ternary-unfriendly and a
  source of silent bugs. Always `boolean`.
- **Resource permissions in the root layout.** Over-fetches for every
  navigation. Scope per route.
- **Permissions via TanStack Query.** Redundant — permissions are
  load-time data, not streaming. Load keeps SSR + hydration correct.

## References

- ADR-0008 — TanStack Query for server state (permissions are an
  exception: load-time, not streaming).
- ADR-0035 — load-derived permissions decision.
- [auth-oidc.md](auth-oidc.md) — session loading recipe.
- Golusoris `auth/permissions/` README — server-side contract.
