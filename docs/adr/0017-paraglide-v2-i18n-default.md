# ADR-0017: Paraglide v2 as framework i18n default

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D50 in `.workingdir/research/decisions-needed.md`

## Context

Only arca ships i18n today — `@inlang/paraglide-js@2` wired via Vite plugin and `messages/` directory. revenge, subdo, Lurkarr ship zero i18n imports (intentional v0.1 deferral). Single-adopter evidence was initially insufficient to lock; the user's direction ("well then this is missing in apps so lock in") closed the row by fiat — revenge/subdo/Lurkarr will adopt on next pass with arca's usage as the reference.

The D50 4-axes re-audit (`reaudit-d50-paraglide.md`, 2026-04-17) surfaced one scope tightening: **`@inlang/paraglide-sveltekit` is deprecated by Paraglide v2.0+**. The separate adapter package is replaced by the framework-agnostic `paraglideVitePlugin()` exported from `@inlang/paraglide-js` directly. SvelteKit wires via standard `hooks.server.ts` middleware + `reroute()` hook + `<html lang="%lang%" dir="%dir%">` template placeholders.

## Decision

Lock `@inlang/paraglide-js@^2.16.0` as framework-default i18n. **No separate `@inlang/paraglide-sveltekit` adapter** — deprecated by Paraglide v2's direct Vite plugin.

Integration pattern:

- `vite.config.ts` — `paraglideVitePlugin({ project, outdir, strategy: ['url', 'cookie', 'baseLocale'] })`
- `hooks.server.ts` — `paraglideMiddleware()`
- `hooks.ts` — `reroute()`
- `app.html` — `<html lang="%lang%" dir="%dir%">`

`@sveltesentio/i18n` (ADR-0018) re-exports Paraglide v2 with a typed-keys helper and pinned version.

## Alternatives considered

- **svelte-i18n** — stale (not pushed since 2024-10-21, ~1.5 years); runtime-based, not compile-time; no tree-shake at message level. Rejected.
- **typesafe-i18n** — strong runner-up (compile-time, MIT, pushed 2026-03-22, Svelte 5 support); rejected for smaller ecosystem + no official SvelteKit integration (Paraglide is labelled "SvelteKit's official i18n integration" on inlang.com).
- **@tolgee/svelte** — platform-heavy SaaS CMS + API shape, wrong fit for an open-framework default. Rejected.
- **@wuchale/svelte** — pre-1.0 (0.19.3), small community. Rejected for stability floor.
- **inlang SDK direct** — Paraglide is the inlang-recommended output; direct SDK is lower-level than needed.
- **No i18n** — blocks revenge/subdo/Lurkarr from ever shipping i18n under a shared framework stack.

## Consequences

**Positive**:

- Matches arca's proven integration (minus the deprecated adapter — migration trivial).
- Compile-time message extraction → tree-shakable per-locale bundles (claimed 70% smaller vs runtime).
- Single dep pin (no adapter matrix) — `@inlang/paraglide-js@^2` is the only lock.
- `paraglideMiddleware()` handles `<html lang>` + `<html dir>` injection for SSR + screen-reader correctness.
- Unblocks ADR-0018 (`@sveltesentio/i18n` wrapper).

**Negative / trade-offs**:

- revenge/subdo/Lurkarr carry i18n-adoption cost on next pass.
- Inlang project-file convention (`project.inlang/`) must be onboarded per-app.
- adapter-static consumers (subdo, revenge, Lurkarr) require `paths: { relative: false }` — documentation obligation on `docs/compose/i18n.md`.
- `urlpattern-polyfill@^10` is a transitive dep (~4 KB gzipped) for Safari < 17 / older mobile.

**Documentation obligations**:

- `docs/compose/i18n.md` — Paraglide v2 setup, Vite plugin + hooks wiring, typed-keys pattern, message-catalog conventions, adapter-static `paths.relative = false` requirement, SSR strategy must include `cookie`.
- `@sveltesentio/i18n` wrapper spec (see ADR-0018).

## Evidence

- `.workingdir/research/reaudit-d50-paraglide.md` — full 4-axes audit; critical finding on paraglide-sveltekit deprecation; pinned versions; WCAG 2.2 AA checklist.
- `.workingdir/research/awesome-harvest.md` §i18n (lines 93-98) — bucket comparison.
- `@inlang/paraglide-js@2.16.0` npm metadata — MIT, pushed 2026-04-14 (<https://registry.npmjs.org/@inlang/paraglide-js/latest>).
- `https://inlang.com/m/gerre34r/library-inlang-paraglideJs/sveltekit` (fetched 2026-04-17) — "Paraglide JS is SvelteKit's official i18n integration"; no adapter package mentioned.
- `.workingdir/research/deepread-arca.md:18,34,87` — arca's Paraglide integration is the reference.
- `.workingdir/research/deepread-revenge.md:22,192-194,208` — "NO Paraglide/i18n (all English)"; intentional v0.1 deferral.
- `.workingdir/research/deepread-lurkarr.md:31` — "NO Paraglide".
- `.workingdir/research/deepread-subdo.md:28` — "NO Paraglide".
- `.workingdir/research/decisions-needed.md:239` — divergence row.
- `.workingdir/research/decisions-needed.md:317` — user closure.
