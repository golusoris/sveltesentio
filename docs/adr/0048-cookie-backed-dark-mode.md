# ADR-0048: Cookie-backed dark mode + user-account override; server-injected class prevents flash

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D165 in `.workingdir/research/decisions-needed.md`

## Context

Dark-mode persistence options:

- `localStorage` — client-only; causes flash-of-wrong-theme on SSR.
- Cookie — server-readable; no flash, but needs explicit set.
- User account (server-persisted) — follows user across devices, requires auth.

Flash-of-wrong-theme is a UX regression; `@sveltesentio/ui` must make it impossible by default.

## Decision

Hybrid:

- **First visit** — `+layout.server.ts` inspects `prefers-color-scheme` request header (`Sec-CH-Prefers-Color-Scheme` when available) as the initial guess, writes `<html class="dark">` or `<html>` server-side accordingly, sets a `theme=dark|light|system` cookie mirroring the choice.
- **Return visit** — Cookie wins. Server reads cookie, injects matching class on `<html>`, avoids flash entirely.
- **Signed-in users** — DB preference (stored on user record) mirrors into the cookie on login. DB is canonical; cookie is the fast-path cache.
- **Client toggle** — `mode-watcher` (ADR-0030) flips the class + updates the cookie + (if signed in) fires an async PATCH to the user prefs endpoint.

Zero localStorage for theme. Zero flash.

## Alternatives considered

- **localStorage only** — flash on SSR; rejected.
- **Cookie only, no user-account** — cross-device inconsistency for signed-in users.
- **User-account only** — every request needs a session lookup; slower + breaks anonymous UX.

## Consequences

**Positive**:

- No flash-of-wrong-theme on any visit.
- Signed-in users get cross-device consistency.
- Anonymous users get device-local persistence without localStorage.

**Negative / trade-offs**:

- `+layout.server.ts` must always run (dynamic route) — rules out pure static hosting for themed surfaces. Consumers that want static can skip the server-side injection at the cost of flash.
- Cookie + DB sync adds a small auth hook.

**Documentation obligations**:

- `docs/compose/theming-flash-free.md` — server-injection recipe + cookie shape.
- `@sveltesentio/ui/theme` AGENTS.md — cookie + DB contract.
- Downstream migration: apps with localStorage theme move to cookie.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:111` — D165 pick.
- ADR-0030 — mode-watcher pin.
- Sec-CH-Prefers-Color-Scheme MDN reference.
