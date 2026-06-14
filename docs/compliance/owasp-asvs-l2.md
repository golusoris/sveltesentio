# OWASP ASVS L2 — sveltesentio checklist

> Target: [OWASP ASVS 5.0](https://owasp.org/www-project-application-security-verification-standard/)
> verification **Level 2** (applications handling business-to-business or
> personal data; the default bar for every sveltesentio consumer).
>
> Scope: this document covers the framework surface. Downstream
> `golusoris/app-*` consumers inherit these controls but also own their
> application-specific verifications. A `✅` below means sveltesentio ships
> the default; a `⚠️` means the consumer must opt in; a `🔲` means planned.

Each item links to the ADR or module that owns it.

## V1 — Encoding and sanitization

| # | Control | Status | Owner | Evidence |
|---|---|---|---|---|
| 1.1 | Output encoding at every sink (HTML, attribute, URL, JS, CSS). | ✅ | Svelte compiler | Default Svelte `{expr}` escapes HTML. Raw HTML requires `{@html}` which must go through DOMPurify. |
| 1.2 | Sanitize untrusted HTML with a known-good allowlist. | ✅ | `@sveltesentio/ui/markdown` | ADR-0026 — DOMPurify on every `innerHTML` boundary; rehype plugin uses allowlist schema. |
| 1.3 | Markdown renderer does not execute untrusted JS / event handlers / `javascript:` URLs. | ✅ | `@sveltesentio/ui/markdown` | ADR-0026; schema drops `onclick`, `javascript:`, `data:` (except image allowlist). |

## V2 — Validation, business logic, files

| # | Control | Status | Owner | Evidence |
|---|---|---|---|---|
| 2.1 | Validate every API boundary input with a schema. | ✅ | `@sveltesentio/forms` + Zod v4 | ADR-0001; every `+server.ts` and `+page.server.ts` uses Zod. |
| 2.2 | Reject unexpected fields (`.strict()` by default). | ✅ | `@sveltesentio/forms` helpers | Superforms adapter defaults to strict parse. |
| 2.3 | Enforce size + MIME + extension at every upload boundary. | ✅ | `@sveltesentio/uploads` | ADR-0041 — tus + exifr + file-type; server-side content sniff before accept. |
| 2.4 | Strip EXIF from user-uploaded images. | ✅ | `@sveltesentio/uploads` | ADR-0041. |
| 2.5 | Business-logic invariants validated server-side, not just client-side. | ⚠️ | Consumer | Framework provides primitives; enforcement is application-level. |

## V3 — Sessions, authentication

| # | Control | Status | Owner | Evidence |
|---|---|---|---|---|
| 3.1 | Session identifiers in HttpOnly, Secure, SameSite=Lax cookies. | ✅ | `@sveltesentio/auth` | ADR-0034. |
| 3.2 | Session rotation on privilege change (login, MFA step-up). | ✅ | `@sveltesentio/auth` | ADR-0034 — rotate on login + MFA; server-side session store. |
| 3.3 | Idle + absolute session timeouts. | ⚠️ | Consumer | Defaults shipped (30 min idle, 12 h absolute) but overridable. |
| 3.4 | OIDC / OAuth 2.1 flow with PKCE and state + nonce. | ✅ | `@sveltesentio/auth` | ADR-0032 — custom OIDC client against golusoris IdP. |
| 3.5 | Passkey (WebAuthn) support. | ✅ | `@sveltesentio/auth` | ADR-0033 — SimpleWebAuthn server + browser. |
| 3.6 | MFA with structured error responses (distinguish wrong-factor vs. wrong-code). | ✅ | `@sveltesentio/auth` | ADR-0036. |
| 3.7 | Credential stuffing / brute-force protections (rate limit, lockout, CAPTCHA on repeated failure). | ⚠️ | Consumer | Framework exposes hooks; rate-limit policy is application-specific. |

## V4 — Access control

| # | Control | Status | Owner | Evidence |
|---|---|---|---|---|
| 4.1 | Deny-by-default authorization; every route declares its required permissions. | ✅ | `@sveltesentio/auth` | ADR-0035 — load-derived permissions in `+layout.server.ts`. |
| 4.2 | Authorization checked server-side on every mutation. | ✅ | `@sveltesentio/auth` | SvelteKit actions + ConnectRPC interceptor. |
| 4.3 | No client-side-only authorization. | ✅ | Framework convention | AGENTS.md hard rule. |
| 4.4 | Indirect object references for sensitive IDs where appropriate. | ⚠️ | Consumer | UUIDv7 default (ADR-0023) removes sequential-ID leakage; deeper IDOR mitigation is application-level. |

## V5 — Cryptography

| # | Control | Status | Owner | Evidence |
|---|---|---|---|---|
| 5.1 | No home-grown crypto. | ✅ | Framework convention | Only Web Crypto API + well-known libs (SimpleWebAuthn, `@noble/*`). |
| 5.2 | Passwords never stored (passkey-first, fallback to IdP-hosted). | ✅ | `@sveltesentio/auth` | ADR-0032 + ADR-0033. |
| 5.3 | Secrets not in client bundles. | ✅ | Vite `$env/static/private` boundary | ESLint rule blocks `PUBLIC_` prefix on secrets; CI scans bundle for known secret patterns. |
| 5.4 | TLS 1.2+ for all network egress. | ⚠️ | Deployment | Framework assumes HTTPS; `Secure` cookie flag enforced. |

## V6 — Data protection at rest and in transit

| # | Control | Status | Owner | Evidence |
|---|---|---|---|---|
| 6.1 | PII boundaries documented in every package that handles it. | 🔲 | Per-package AGENTS.md | To add: `auth`, `forms`, `uploads`, `ai`. |
| 6.2 | Logs scrubbed of secrets + PII. | ⚠️ | Consumer + `@sveltesentio/core` logger | Core logger redacts known fields; consumer defines field list. |

## V7 — Error handling and logging

| # | Control | Status | Owner | Evidence |
|---|---|---|---|---|
| 7.1 | Structured error responses (RFC 9457 problem+json). | ✅ | `@sveltesentio/core` | ADR-0019. |
| 7.2 | No stack traces or framework internals in 5xx response bodies to unauthenticated clients. | ✅ | `+error.svelte` + RFC 9457 envelope | Default handler strips internals. |
| 7.3 | Audit log for auth events (login, MFA, privilege change, logout). | ⚠️ | Consumer hooks | Hooks provided; storage is application-level. |
| 7.4 | AI request/response audit log with structured schema. | ✅ | `@sveltesentio/ai` | ADR-0045. |

## V8 — Data + privacy

| # | Control | Status | Owner | Evidence |
|---|---|---|---|---|
| 8.1 | Data export for the signed-in user (GDPR Art. 15). | ⚠️ | Consumer | Framework provides session + auth primitives; export endpoint is application-level. |
| 8.2 | Data deletion for the signed-in user (GDPR Art. 17). | ⚠️ | Consumer | Same as above. |
| 8.3 | Cookie consent for non-essential cookies. | ⚠️ | Consumer | Framework ships no tracking cookies by default. |

## V9 — Communications

| # | Control | Status | Owner | Evidence |
|---|---|---|---|---|
| 9.1 | HSTS with `includeSubDomains; preload` on production. | ⚠️ | Deployment | Header set by `hooks.server.ts` default. |
| 9.2 | CSP with `default-src 'self'` + nonce on every `<script>` and `<style>` inline. | ✅ | `hooks.server.ts` default | SvelteKit per-response nonce. |
| 9.3 | SRI on every third-party CDN asset. | ✅ | `vite.config` build hook | Documented in AGENTS.md hard rules. |
| 9.4 | No mixed content. | ✅ | CSP `upgrade-insecure-requests` | Default. |

## V10 — Malicious code

| # | Control | Status | Owner | Evidence |
|---|---|---|---|---|
| 10.1 | No `eval`, `Function`, `setTimeout(string)`, `setInterval(string)`. | ✅ | ESLint `no-eval` + CSP | Flat config. |
| 10.2 | CSP disallows `'unsafe-eval'` and `'unsafe-inline'` (nonce-based only). | ✅ | `hooks.server.ts` default | Per-response nonce. |

## V11 — Business logic

| # | Control | Status | Owner | Evidence |
|---|---|---|---|---|
| 11.1 | CSRF protection on state-changing requests. | ✅ | SvelteKit default + cookie SameSite | Form actions require same-origin by default. |
| 11.2 | Replay protection on idempotent mutations where ordering matters. | ⚠️ | Consumer | `@sveltesentio/query` supports Idempotency-Key header forwarding. |

## V12 — Files and resources

| # | Control | Status | Owner | Evidence |
|---|---|---|---|---|
| 12.1 | Uploaded files stored outside the web root or with `Content-Disposition: attachment`. | ✅ | `@sveltesentio/uploads` | ADR-0041. |
| 12.2 | Antivirus / malware scan on uploaded binaries. | ⚠️ | Consumer | Framework exposes post-upload hook. |
| 12.3 | Image decoding in a sandbox (no server-side ImageMagick conversion by default). | ✅ | `@sveltesentio/uploads` | ADR-0041 — exifr is read-only; no imagemagick / ghostscript shell-out. |

## V13 — API and web service

| # | Control | Status | Owner | Evidence |
|---|---|---|---|---|
| 13.1 | Every API endpoint has a typed schema (OpenAPI or ConnectRPC proto). | ✅ | `@sveltesentio/core` + openapi-fetch / ConnectRPC | ADR-0019, ADR-0038. |
| 13.2 | Rate limiting at the edge. | ⚠️ | Deployment | Framework exposes per-route limits; enforcement is deployment-level. |

## V14 — Configuration

| # | Control | Status | Owner | Evidence |
|---|---|---|---|---|
| 14.1 | Debug endpoints never reachable in production. | ✅ | `process.env.NODE_ENV === 'production'` gate | `@sveltesentio/core` debug helper. |
| 14.2 | SBOM published with every release. | 🔲 | CI `release-sveltekit` | Syft step planned; not yet wired. |
| 14.3 | Provenance attestation (SLSA L3) on every release. | 🔲 | CI `release-sveltekit` | GitHub Artifact Attestations planned. |
| 14.4 | Dependencies have a signed provenance where available. | ⚠️ | Supply chain | `pnpm audit --signatures` in `make ci`. |

## Open items

- `6.1` — author per-package PII boundary notes.
- `14.2`, `14.3` — wire Syft + attestation steps into `release-sveltekit.yml`.
- Annual review cadence: Q1 each year, post–OWASP ASVS point release.
