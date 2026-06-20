# ADR-0050: Tenant theming — minimal skeleton NOW (CSS custom props + oklch, server-injected)

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user) **[override]**, research agent
- **D-row**: D162 in `.workingdir/research/decisions-needed.md`

## Context

Multi-tenant deployments need per-tenant theming (logo, accent palette, potentially density). The research recommendation was to **defer** to v0.2.x, since Golusoris's tenancy module is still in flight. User override (Round 4d): lock the minimal skeleton **now** so downstream apps can adopt when Golusoris `tenancy/` lands, without waiting for a v0.2 release.

## Decision

Ship a minimal tenant-theming skeleton in v0.1:

- `+layout.server.ts` helper in `@sveltesentio/shell/tenancy` — reads `tenant` from cookie / subdomain / JWT claim (consumer chooses), fetches the tenant's palette (CSS custom-prop overrides) via a consumer-provided endpoint.
- Server-injected `<style>` block in the SSR HTML declares `:root { --accent: oklch(...); --brand: oklch(...); ... }` for the resolved tenant. Runs inside `app.html` template.
- CSS custom props flow into Tailwind 4 `@theme` via `theme(--accent)` references — already idiomatic in `ui/preset`.
- Consumer contract:
  ```ts
  export const tenantResolver: TenantResolver = async (event) => ({
    id: '...',
    tokens: { accent: 'oklch(0.7 0.15 240)', brand: 'oklch(...)' },
  });
  ```
- Swap-in target: when Golusoris `tenancy/` lands, replace the consumer resolver with a shipped `golusorisTenancyResolver()` that reads from the tenancy API.

**Explicitly out of scope for v0.1**: runtime per-tenant dark mode (multiplicative complexity), per-tenant font presets (too large a surface), per-tenant preset-\* swap. All deferred.

**No CSS-in-JS** — runtime cost + hydration mismatch risk. Server-injected `<style>` block is the posture.

## Alternatives considered

- **Defer to v0.2.x (original recommendation)** — user overrode; locking skeleton now keeps downstream unblocked.
- **CSS-in-JS per tenant** — runtime injection + hydration hazard; bigger footprint.
- **Build-time per-tenant bundles** — doesn't scale; tenancy is runtime concern.
- **Full runtime theming system** — overshoots v0.1; custom props + server injection is minimum-viable.

## Consequences

**Positive**:

- Drop-in path for when Golusoris `tenancy/` lands — consumer replaces resolver with one-liner.
- No runtime JS cost; custom props resolved natively by the browser.
- Preserves ADR-0046's tier boundaries (this is Tier 3-adjacent but server-driven).

**Negative / trade-offs**:

- Cookie / subdomain / JWT resolver choice is consumer's; framework doesn't pick.
- Custom-prop-only scope means tenant-specific density / typography require future ADR (intentional).
- Skeleton API is likely to evolve as real tenancy lands — flagged for re-audit in v0.2.

**Documentation obligations**:

- `docs/compose/tenant-theming.md` — resolver contract, SSR injection, Tailwind 4 `theme(--*)` bridge.
- `@sveltesentio/shell/tenancy` AGENTS.md — resolver API + migration plan when Golusoris `tenancy/` ships.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:109` — D162 research recommendation (defer).
- User Round 4d override: "what no, lock all three" — forces skeleton-now.
- ADR-0006 — oklch palette.
- ADR-0046 — three-tier theming model.
