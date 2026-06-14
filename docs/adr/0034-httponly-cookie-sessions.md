# ADR-0034: HttpOnly + Secure + SameSite=Lax cookie sessions; no JS-readable tokens

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D62 in `.workingdir/research/decisions-needed.md`

## Context

revenge currently stores refresh tokens in `localStorage` — dispositive XSS antipattern: any script (injected or supply-chained) can exfiltrate the token. Golusoris sessions belong in `HttpOnly; Secure; SameSite=Lax` cookies issued by the server, invisible to JS. `@sveltesentio/auth` must enforce this at the framework level so no future app re-introduces the antipattern.

## Decision

- Session cookie set by Golusoris (`Set-Cookie: session=...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=...`). Never readable from JS.
- `@sveltesentio/auth` exposes **no** `getSessionToken()` API. Auth state reads via SvelteKit `load` → `page.data.session` (server-populated).
- ESLint rule (`@sveltesentio/eslint-plugin`): forbid `localStorage.setItem` / `sessionStorage.setItem` with any key matching `/token|session|auth|refresh|bearer/i`.
- CSRF protected by SameSite=Lax for cookie auth + explicit CSRF token on mutation routes (Golusoris enforces server-side).

## Alternatives considered

- **localStorage refresh token (status quo in revenge)** — XSS-exfiltratable; rejected outright.
- **sessionStorage** — same class of vulnerability, narrower persistence; no upside.
- **In-memory-only tokens with silent refresh** — viable but fragile across tab reloads; cookie is the standard.

## Consequences

**Positive**:
- XSS cannot exfiltrate session tokens.
- No JS-side token handling — smaller attack surface + no refresh-race bugs.
- ESLint rule prevents regression.

**Negative / trade-offs**:
- Cross-origin SPAs talking to Golusoris need cookie-friendly deployment (same eTLD+1 or CORS with credentials).
- No cookie-less embed scenarios (iframes without `SameSite=None; Secure`) — future ADR if needed.

**Documentation obligations**:
- `docs/compliance/xss-sinks.md` — session cookie as the token sink.
- Downstream migration (critical): revenge moves refresh token out of localStorage.
- `@sveltesentio/auth` AGENTS.md — cookie contract with Golusoris.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:78` — D62 pick.
- `.workingdir/research/deepread-revenge.md` — localStorage refresh token location.
- OWASP ASVS L2 V3 Session Management.
