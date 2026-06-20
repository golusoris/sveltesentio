# ADR-0040: Paraglide URL+cookie strategy + Tailwind 4 logical properties for RTL

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D51 + D52 + D53 in `.workingdir/research/decisions-needed.md`

## Context

Paraglide v2 is locked (ADR-0017). Open questions: locale detection strategy, RTL support, Intl formatter scope. Paraglide supports a strategy array that resolves locale per request; `['url', 'cookie', 'baseLocale']` matches SvelteKit's route-based i18n pattern. RTL requires `<html dir="rtl">` + logical properties (`ms-*`/`me-*` etc.) rather than physical (`ml-*`/`mr-*`) — Tailwind 4 ships the logical variants natively. `Intl.*` is a web platform primitive; a separate `@sveltesentio/format` module would split what Paraglide already anchors.

## Decision

- **Strategy default** in `@sveltesentio/i18n`:
  ```ts
  paraglideVitePlugin({
    strategy: ['url', 'cookie', 'baseLocale'],
    // ...
  });
  ```
  URL wins (SEO, shareable); cookie is the persistence override; baseLocale is the fallback.
- **RTL**: `@sveltesentio/i18n` ships `getTextDirection(locale)` + a SvelteKit hook that sets `<html lang dir>` server-side from the detected locale. Tailwind 4 logical properties are the framework default; ESLint rule (warn) flags `ml-*`/`mr-*`/`pl-*`/`pr-*` in new code — guides authors to `ms-*`/`me-*`/`ps-*`/`pe-*`.
- **Intl formatters**: fold `formatCurrency`, `formatNumber`, `formatDate`, `formatRelativeTime` into `@sveltesentio/i18n/format`. No separate module (reversing D53 from open to fold-in).

## Alternatives considered

- **Strategy `['cookie', 'url', 'baseLocale']`** — breaks SEO on first visit; search engines see the fallback locale.
- **Physical properties with `[dir=rtl]` overrides** — maintenance tax per component.
- **Separate `@sveltesentio/format` module** — adds a package for what's already one logical home.

## Consequences

**Positive**:

- SEO-correct URLs per locale by default.
- RTL support is framework-baseline, not per-app.
- One import path for Intl formatting.

**Negative / trade-offs**:

- Apps on physical properties need a one-shot migration (codemod opportunity).
- ESLint warn (not error) to avoid friction on legacy components; promote to error once downstream migrated.

**Documentation obligations**:

- `docs/compose/i18n-routing.md` — URL strategy, cookie override, SSR hook.
- `docs/compose/rtl.md` — logical-property patterns + ESLint rule rationale.
- `@sveltesentio/i18n/format` AGENTS.md — Intl API surface.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:87-89` — D51 + D52 + D53 picks.
- ADR-0017 — Paraglide v2 lock.
- ADR-0018 — i18n thin wrapper scope (formatters fit inside).
