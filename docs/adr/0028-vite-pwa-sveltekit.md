# ADR-0028: `@vite-pwa/sveltekit@^1.1` as the PWA layer inside `@sveltesentio/shell`

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D142 in `.workingdir/research/decisions-needed.md`

## Context

SvelteKit PWA story split between two camps:
- **vite-plugin-pwa + `@vite-pwa/sveltekit`** — SvelteKit-specific adapter (`@vite-pwa/sveltekit@1.1.0`, MIT) wires service worker + manifest + SSR-safe lifecycle hooks.
- **Serwist** — rebranded Workbox fork. `@serwist/sw@9.5.7` exists on npm; `@serwist/sveltekit` **does not exist** despite what some guides suggest. Rolling your own SvelteKit adapter on `@serwist/sw` reinvents the lifecycle wiring.

No adopter app has a mature PWA build yet, so the choice is forward-facing.

## Decision

Pin `@vite-pwa/sveltekit@^1.1.0` inside `@sveltesentio/shell`. Service worker registration + manifest generation + update prompts flow through the adapter. Serwist re-audit deferred to v0.3 (depends on `@serwist/sveltekit` landing).

## Alternatives considered

- **`@serwist/sveltekit`** — does not exist on npm; phantom option.
- **Custom SvelteKit + `@serwist/sw`** — rebuilds the adapter layer; no upside today.
- **Raw `vite-plugin-pwa`** — missing SvelteKit-specific SSR hooks; more glue per consumer.

## Consequences

**Positive**:
- First-class SvelteKit PWA install + update flow out of the box.
- Manifest + icons + offline shell wired via the adapter's defaults.
- Workbox under the hood (via `vite-plugin-pwa@^1.2`) — proven caching strategies.

**Negative / trade-offs**:
- Tied to `vite-plugin-pwa` cadence; major bumps flow through an ADR amendment.
- Serwist migration, if the ecosystem consolidates there, is a future re-audit.

**Documentation obligations**:
- `docs/compose/pwa.md` — manifest config, update prompts, offline strategy.
- `@sveltesentio/shell` AGENTS.md — PWA wiring + opt-out flag.
- `docs/compliance/csp-pwa.md` — service worker CSP implications.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:65` — D142 pick.
- npm registry check: `@serwist/sveltekit` absent (2026-04-17).
- `.workingdir/research/ecosystem-batch-b.md` — Serwist state-of-play.
