# Tenant theming — resolver + SSR-injected `<style>`

Multi-tenant deployments override a subset of oklch tokens per tenant:
accent color, brand color, sometimes logo. `@sveltesentio/shell/tenancy`
resolves the tenant server-side, injects a scoped `<style>` block into
the SSR HTML, and cascades into the Tailwind 4 `@theme` pipeline. **No
CSS-in-JS**, no runtime injection, no hydration mismatch.

See [ADR-0050](../adr/0050-tenant-theming-minimal-skeleton.md) for the
decision (minimal skeleton in v0.1; full surface deferred). Related:
[theming.md](theming.md) (three-tier theming contract),
[theming-flash-free.md](theming-flash-free.md) (dark mode compose),
[ADR-0046](../adr/0046-three-tier-theming.md).

## Scope in v0.1

**In:** per-tenant `--color-accent` / `--color-brand` / arbitrary custom
props, injected server-side. Consumer-supplied resolver (cookie /
subdomain / JWT — app chooses).

**Out (deferred to v0.2+):** per-tenant dark-mode palettes (cascades
multiplicatively), per-tenant font presets, per-tenant preset swap
(`desktop` → `10foot` per tenant).

Stay in scope; the v0.1 surface is minimal-viable and swap-in-ready for
Golusoris's future `tenancy/` API.

## Install

```bash
pnpm add @sveltesentio/shell
```

## Resolver contract

Apps supply a function that maps the request → tenant identity + token
overrides:

```ts
// src/lib/tenancy.ts
import type { TenantResolver } from '@sveltesentio/shell/tenancy';

export const resolveTenant: TenantResolver = async (event) => {
  // Choose your signal — cookie, subdomain, JWT claim, path prefix.
  const host = event.url.hostname;
  const subdomain = host.split('.')[0];
  if (!subdomain || subdomain === 'www') return null; // no tenant

  const tenant = await fetchTenant(subdomain); // your backend
  if (!tenant) return null;

  return {
    id: tenant.id,
    name: tenant.name,
    tokens: {
      '--color-accent': tenant.accentOklch,
      '--color-accent-fg': tenant.accentFgOklch,
      '--color-brand': tenant.brandOklch,
      // Any --color-* or sizing/typography token can go here.
    },
  };
};
```

The resolver runs on every request. Cache `fetchTenant` in a per-process
LRU (tenant data changes rarely; the request path must stay fast).

### Return shape

```ts
type Tenant = {
  id: string;
  name?: string;
  tokens: Record<`--${string}`, string>;
};
type TenantResolver = (event: RequestEvent) => Promise<Tenant | null>;
```

`null` disables tenant theming for the request — the base tokens
apply.

## Server hook

```ts
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { withTheme } from '@sveltesentio/ui/theme';
import { withTenant } from '@sveltesentio/shell/tenancy';
import { resolveTenant } from '$lib/tenancy';

export const handle = sequence(
  withTheme({ cookie: 'sv_theme', default: 'system' }),
  withTenant({ resolve: resolveTenant }),
);
```

`withTenant`:

1. Calls the resolver.
2. Sets `event.locals.tenant = { id, name, tokens }`.
3. Stamps `<html data-tenant="{id}">`.
4. Injects a `<style>` block in `<head>` that declares
   `:root[data-tenant='{id}'] { --color-accent: ...; ... }`.

The injection happens before the first paint — no flash, no
hydration mismatch. Composes with `withTheme` (dark mode cascades
through the same `data-*` attributes).

## `app.html` shape

No extra markers needed beyond the `data-theme` one from
[theming-flash-free.md](theming-flash-free.md):

```html
<!DOCTYPE html>
<html lang="en" data-theme="%sveltekit.theme%" data-tenant="%sveltekit.tenant%">
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light dark" />
    %sveltekit.head%
  </head>
  <body>%sveltekit.body%</body>
</html>
```

The hook replaces `%sveltekit.tenant%` with the resolved ID (or an
empty string when no tenant). The injected `<style>` block lands inside
`%sveltekit.head%`.

## Consuming tokens

Tenant tokens are CSS custom properties — same consumption contract as
base tokens. Tailwind utilities (`bg-accent`, `text-brand`) and raw
`var(--color-accent)` both work. See [theming.md](theming.md).

## Layout data

Expose the tenant on `+layout.server.ts` so components can read its
name/logo without re-running the resolver:

```ts
// src/routes/+layout.server.ts
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    tenant: locals.tenant ? { id: locals.tenant.id, name: locals.tenant.name } : null,
  };
};
```

Never send the full `tokens` map to the client — they're already
rendered into the injected `<style>`. Exposing them again wastes
payload.

## Resolving via cookie

For apps where subdomain isn't an option (single-domain SaaS, multi-tenant
admin console):

```ts
export const resolveTenant: TenantResolver = async (event) => {
  const tenantId = event.cookies.get('tenant_id');
  if (!tenantId) return null;
  const tenant = await fetchTenant(tenantId);
  return tenant ? { id: tenant.id, name: tenant.name, tokens: tenant.tokens } : null;
};
```

The cookie itself must be set somewhere — typically on tenant selection
inside the app (a `/tenant/switch` endpoint that validates access and
writes the cookie).

## Resolving via JWT claim

For apps where the session carries a `tenant` claim:

```ts
export const resolveTenant: TenantResolver = async (event) => {
  const session = await readSession(event); // from auth-oidc.md
  if (!session?.tenantId) return null;
  const tenant = await fetchTenant(session.tenantId);
  return tenant ? { /* … */ } : null;
};
```

This is the shape that plugs cleanly into Golusoris's future `tenancy/`
API — when it lands, swap `fetchTenant` for
`golusorisTenancyResolver()`.

## Fallback + invalid tenants

If the resolver returns `null` or throws, `withTenant` applies no
overrides and does not stamp `data-tenant`. App renders with the base
palette. Don't throw 404 for unknown tenants in the resolver — that's a
route-level concern (use `+layout.server.ts` → `error(404)` if the app
semantically requires a tenant).

## Testing

Unit-test the resolver with a mocked `RequestEvent`:

```ts
import { resolveTenant } from '$lib/tenancy';

test('resolves by subdomain', async () => {
  const event = { url: new URL('https://acme.example.com/'), cookies: { get: () => undefined } } as any;
  const t = await resolveTenant(event);
  expect(t?.id).toBe('acme');
});
```

Playwright for end-to-end flash-free verification:

```ts
test('acme tenant paints with cyan accent on first render', async ({ page, context }) => {
  await page.goto('https://acme.localhost/');
  const accent = await page.evaluate(() => {
    return getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
  });
  expect(accent).toMatch(/oklch\(0\.70 0\.14 200\)/); // acme cyan
});
```

## Migration to Golusoris `tenancy/`

When Golusoris ships its tenancy API, replace the consumer resolver
with a one-liner:

```ts
// before
export const resolveTenant = customResolver;

// after
import { golusorisTenancyResolver } from '@sveltesentio/shell/tenancy/golusoris';
export const resolveTenant = golusorisTenancyResolver({ baseUrl: GOLUSORIS_URL });
```

The hook + injection surface is unchanged. Tokens flow the same way.

## Anti-patterns

- **CSS-in-JS for tenant tokens.** Runtime cost + hydration mismatch.
  Server-injected `<style>` only.
- **Sending the token map to the client.** It's already rendered.
  Expose ID + name via `page.data`, nothing more.
- **Resolving on every request without cache.** Tenant data is near-static.
  Cache in a per-process LRU.
- **Overriding `--color-fg` / `--color-bg` at tenant tier.** Breaks the
  WCAG contrast contract from [theming.md](theming.md). Override only
  brand colors (`--color-accent`, `--color-brand`).
- **Per-tenant dark mode mapping in v0.1.** Out of scope — cascades
  multiplicatively (theme × tenant). Deferred to v0.2+.
- **Resolving tenancy from the client.** The resolver runs server-side.
  Client can't override tokens without flash.
- **Throwing from the resolver.** Return `null` on missing/invalid
  tenant. Let the route layer handle "tenant required" semantics.
- **Mutating `event.locals.tenant.tokens` after the hook runs.** Hook
  already injected the `<style>`. Mutation is dead code.

## References

- ADR-0050 — tenant theming minimal skeleton decision.
- ADR-0046 — three-tier theming (framework / app / tenant).
- [theming.md](theming.md) — oklch token pipeline + contrast contract.
- [theming-flash-free.md](theming-flash-free.md) — compose with dark
  mode.
- [auth-oidc.md](auth-oidc.md) — JWT-claim resolver path.
