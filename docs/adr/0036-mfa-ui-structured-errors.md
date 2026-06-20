# ADR-0036: First-class MFA/TOTP UI in `@sveltesentio/auth` + structured error codes

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D64 + D10 in `.workingdir/research/decisions-needed.md`

## Context

revenge detects MFA challenges by substring-matching the error message (`if (error.message.includes('mfa'))` or similar). Any server-side i18n change or error-message rewording silently breaks MFA. Golusoris emits RFC 9457 errors already (ADR-0019); the fix is structured error codes + typed UI components.

## Decision

- Golusoris error contract for auth:
  - `type: "urn:golusoris:auth:mfa_required"` (status 401)
  - `type: "urn:golusoris:auth:mfa_invalid"` (status 401)
  - `type: "urn:golusoris:auth:mfa_rate_limited"` (status 429)
- `@sveltesentio/auth` ships:
  - `<MfaChallenge>` component — accepts the `ProblemError` from ADR-0019, renders TOTP / WebAuthn challenge based on `extensions.allowedMethods`.
  - `<MfaEnroll>` component — QR code + recovery codes; wraps `@simplewebauthn/browser` for passkey enrolment.
  - `handleAuthError(error)` helper — narrows `ProblemError` to MFA states via typed switch.
- No substring matching anywhere in the framework code path.

## Alternatives considered

- **Keep substring match** — rejected; dispositive antipattern.
- **Raw API for app-level MFA UI** — every app re-implements the same challenge surface.
- **Third-party MFA SaaS** — duplicates Golusoris.

## Consequences

**Positive**:

- MFA UI consistent across sveltesentio apps with one component.
- i18n / message wording changes don't break the flow.
- Structured error codes flow end-to-end (server → `ProblemError` → narrowed switch).

**Negative / trade-offs**:

- Golusoris must emit the typed error codes (it's already the RFC 9457 owner — coordination, not new work).
- Framework maintains the component accessibility + copy; apps override via slots.

**Documentation obligations**:

- `docs/compose/mfa.md` — enrolment + challenge flows with code examples.
- `@sveltesentio/auth` AGENTS.md — error code contract with Golusoris.
- Migration (critical): revenge replaces substring match with `handleAuthError`.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:80` — D64 pick.
- `.workingdir/research/deepread-revenge.md` — substring-match location.
- ADR-0019 — RFC 9457 error pipeline that narrows to these codes.
