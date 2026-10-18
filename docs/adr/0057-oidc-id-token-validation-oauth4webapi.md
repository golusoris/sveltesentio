# ADR-0057: Validate the OIDC ID token with `oauth4webapi` inside the existing client helpers

- **Status**: Accepted
- **Date**: 2026-10-18
- **Deciders**: @lusoris (user, through the fleet decision ledger entry `sveltesentio-ru-oidc-reuse`)
- **Supersedes**: [ADR-0032](0032-custom-oidc-client-against-golusoris.md)

## Context

ADR-0032 promised a relay client (`startLogin`, `handleCallback`, `refresh`, `logout`) that forwards to Golusoris HTTP endpoints under `/auth/oidc/*`. Measured on 2026-10-18, the code and Golusoris both diverge from that record:

- `packages/auth/src/oidc.ts` exports `buildAuthorizationUrl`, `createAuthorizationRequest` and `exchangeAuthorizationCode`. None of the four relay functions exists.
- Golusoris `auth/oidc` is a Go provider library with no HTTP routes, so there is no endpoint for a relay to call.
- `exchangeAuthorizationCode` returned the token response after checking only that `access_token` is a string. A returned `id_token` was never checked for its signature, issuer, audience, expiry or nonce, so a forged or replayed ID token was accepted.

Writing JOSE and claim validation by hand would add a second implementation of a behaviour that a maintained library already provides.

## Decision

1. `@sveltesentio/auth` depends on `oauth4webapi`, pinned to the exact version `3.8.8` (MIT, no runtime dependencies).
2. `exchangeAuthorizationCode` keeps its request path and its signature. When the response carries an `id_token`, it hands a copy of the parsed body to `oauth4webapi`, which checks `iss`, `aud`, `exp`, `iat`, `sub`, the `alg` header and, for the `authorization_code` grant, the `nonce`; `validateApplicationLevelSignature` then verifies the signature against the JWKS.
3. `TokenExchangeInit` gains four optional fields: `issuer`, `jwksUri`, `nonce` and `idTokenSigningAlgs` (default `RS256`). An `id_token` without `issuer` and `jwksUri`, or an `authorization_code` response without `nonce`, is rejected; validation fails closed.
4. Every failure raises the existing `ProblemError` with type `urn:sveltesentio:auth:token_exchange_failed` and title `Invalid ID token`.
5. The exported names and signatures of the OIDC helpers stay unchanged. Removing or renaming one needs a new decision.

## Alternatives considered

- **Keep ADR-0032 and build the relay**: there are no Golusoris routes to relay to, so the relay would have no server side.
- **Validate by hand with WebCrypto**: a second implementation of JOSE parsing, algorithm checks and claim rules, which the reuse rule (HISS-19) forbids.
- **`openid-client`**: built on `oauth4webapi` by the same author and adds discovery and a client object this package does not need.

## Consequences

**Positive**:

- A forged, expired, replayed or wrongly addressed ID token is rejected (`packages/auth/test/oidc-id-token.test.ts`).
- The validation logic lives in one maintained library.

**Negative / trade-offs**:

- Callers that receive an `id_token` must now pass `issuer`, `jwksUri` and `nonce`; without them the exchange fails.
- The JWKS is fetched on every exchange that returns an ID token, because each call builds a new authorization-server object.

## Evidence

- `packages/auth/src/oidc.ts`: `validateIdToken`.
- `packages/auth/test/oidc-id-token.test.ts`: wrong nonce, wrong audience, wrong issuer, expired token, foreign signing key, rejected `alg`, missing configuration.
- `npm view oauth4webapi@3.8.8 license dependencies`: `MIT`, no dependencies (checked 2026-10-18).

## References

- Fleet decision ledger, `sveltesentio-ru-oidc-reuse`, 2026-10-18: adopt `oauth4webapi` at an exact pin, validate signature, issuer, audience, expiry and nonce, keep the exported API and supersede ADR-0032 (paraphrased).
