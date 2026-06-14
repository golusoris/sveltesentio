# WebAuthn attestation — direct & enterprise verification for high-security flows

[passkeys.md](passkeys.md) registers credentials with `attestation:
"none"` (the default — privacy-preserving, no authenticator vendor
fingerprint sent to the relying party). High-security flows (admin
console, financial settlement, healthcare PHI access, signed-attestation
compliance regimes) need the inverse: cryptographic proof that the
credential was minted by an authenticator the relying party trusts.

This recipe covers when to upgrade `attestation: "none"` to `"direct"`
or `"enterprise"`, how to verify the attestation statement server-side
against the FIDO Metadata Service (MDS), and the privacy / UX trade-offs
that make this a per-flow opt-in, never a default.

## Related

- [passkeys.md](passkeys.md) — base `attestation: "none"` register/login
  ceremonies; this recipe upgrades attestation conveyance for specific
  flows.
- [auth-oidc.md](auth-oidc.md) — session establishment; attestation
  verification gates session-elevation, not initial sign-in.
- [permissions.md](permissions.md) — `load`-derived permission checks
  read attestation-verified flag from session.
- [mfa.md](mfa.md) — attestation-verified passkey can replace step-up
  MFA for the bound flow.
- [observability.md](observability.md) — attestation-verification
  outcomes emit structured spans + counters with `aaguid` (low-card)
  attribute.
- [schemas.md](schemas.md) — Zod boundary on attestation statement
  parse.
- [principles.md §2.2](../principles.md) — OWASP ASVS L2 V6 (stored
  cryptographic verification).
- [ADR-0033](../adr/0033-passkeys-simplewebauthn.md) — `@simplewebauthn/*`
  stack lock.

## When to verify attestation

```text
Standard consumer sign-in / passkey enrolment                 → "none" (privacy-preserving, no MDS round-trip)
Admin console, billing, financial settlement                  → "direct" (verify against MDS allowlist)
Workforce SSO with managed-device fleet                       → "enterprise" (vendor + AAGUID pinned)
PSD2 SCA / FAPI 2.0 / NIST AAL3                               → "direct" (regulator requires)
Healthcare PHI / HIPAA-regulated access                       → "direct" (audit trail must prove device class)
Pure UX nice-to-have ("show user their device name")          → "none" + parse `transports` only — never request attestation for cosmetics
```

Two reasons to default to `"none"`: (a) `"direct"` reveals the
authenticator make/model to the server (a tracking vector across
relying parties — Apple's Touch ID and Yubikey 5C have distinct AAGUIDs),
(b) some authenticators emit `none` even when asked for `direct` (Apple
platform authenticator omits attestation by design); your verifier must
gracefully degrade to `none` rather than refuse enrolment.

## Install

```bash
pnpm -F @sveltesentio/auth add \
  @simplewebauthn/server@^13 \
  @simplewebauthn/browser@^13
pnpm -F @sveltesentio/auth add -D \
  @types/node
```

FIDO MDS3 BLOB is fetched server-side at boot (and refreshed daily) —
no extra package needed; Node 24 native `fetch` + `crypto.verify`
suffice.

## Shape — `+server.ts` register-options endpoint

```ts
// src/routes/api/auth/webauthn/register/options/+server.ts
import { json, type RequestHandler } from '@sveltejs/kit';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { z } from 'zod';
import { rpId, rpName, originAllowlist } from '$lib/auth/webauthn/config';
import { requireSession } from '$lib/auth/session';

const Body = z.object({
  flow: z.enum(['standard', 'admin', 'workforce']),
});

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = await requireSession(locals);
  const { flow } = Body.parse(await request.json());

  const attestation =
    flow === 'admin'     ? 'direct' :
    flow === 'workforce' ? 'enterprise' :
                           'none';

  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userID: new TextEncoder().encode(session.userId),
    userName: session.email,
    attestationType: attestation,
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
      authenticatorAttachment: flow === 'workforce' ? 'cross-platform' : undefined,
    },
    excludeCredentials: await listExistingCredentials(session.userId),
  });

  await stashChallenge(session.userId, options.challenge, { flow, ttl: 5 * 60 });
  return json(options);
};
```

Three invariants:

- **Flow drives attestation, not the client** — never let client pick
  `attestationType`; high-security flows are server-policy decisions.
- **Stash flow alongside challenge** — verify endpoint reads it back to
  decide the verification path; client-supplied `flow` on verify is
  spoofable.
- **`residentKey: 'required'` + `userVerification: 'required'`** for
  high-security flows — discoverable credential + biometric/PIN gate
  on every use.

## Shape — verify endpoint with MDS validation

```ts
// src/routes/api/auth/webauthn/register/verify/+server.ts
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { z } from 'zod';
import { rpId, originAllowlist } from '$lib/auth/webauthn/config';
import { mdsLookup } from '$lib/auth/webauthn/mds';
import { requireSession } from '$lib/auth/session';

const RegistrationResponse = z.object({
  id: z.string(),
  rawId: z.string(),
  response: z.object({
    clientDataJSON: z.string(),
    attestationObject: z.string(),
    transports: z.array(z.string()).optional(),
  }),
  type: z.literal('public-key'),
  clientExtensionResults: z.record(z.unknown()),
});

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = await requireSession(locals);
  const body = RegistrationResponse.parse(await request.json());
  const stash = await consumeChallenge(session.userId);
  if (!stash) throw error(400, 'challenge_expired');

  const verification = await verifyRegistrationResponse({
    response: body,
    expectedChallenge: stash.challenge,
    expectedOrigin: originAllowlist,
    expectedRPID: rpId,
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw error(400, 'attestation_invalid');
  }

  const { aaguid, fmt, attestationObject } = verification.registrationInfo;
  const attested = stash.flow !== 'standard';

  if (attested) {
    const mds = await mdsLookup(aaguid);
    if (!mds) throw error(400, 'authenticator_unknown');
    if (!mds.statusReports.some((r) => r.status === 'FIDO_CERTIFIED_L1' || r.status === 'FIDO_CERTIFIED_L2')) {
      throw error(400, 'authenticator_uncertified');
    }
    if (stash.flow === 'workforce' && !workforceAaguidAllowlist.includes(aaguid)) {
      throw error(400, 'authenticator_not_in_fleet');
    }
  }

  await persistCredential(session.userId, {
    credentialId: verification.registrationInfo.credentialID,
    publicKey: verification.registrationInfo.credentialPublicKey,
    counter: verification.registrationInfo.counter,
    transports: body.response.transports,
    aaguid,
    attestationFmt: fmt,
    attestationVerified: attested,
    flow: stash.flow,
    createdAt: new Date(),
  });

  return json({ verified: true, aaguid, fmt, attested });
};
```

Five invariants:

- **MDS lookup only when `flow !== 'standard'`** — saves a round-trip
  on the hot path; standard-flow attestation is `"none"` anyway.
- **Status check** — `mds.statusReports` may include `REVOKED`,
  `USER_VERIFICATION_BYPASS`, `KEY_COMPROMISE`; any negative entry must
  fail enrolment. Don't just check "in MDS"; check "currently
  certified".
- **Workforce AAGUID allowlist** — managed-device fleets enrol
  pre-approved authenticator models only (e.g., Yubikey 5C NFC, Feitian
  K27); enterprise attestation conveys the unique serial, but
  AAGUID-pinning is the gate.
- **Persist `attestationVerified` flag** — `permissions.md` reads it to
  gate flows; never re-verify on every login (attestation is registration-time).
- **Apple-platform `fmt: 'apple'`** — accept it for `flow: 'standard'`
  even if attestation requested; for admin/workforce, document explicitly
  whether `apple` counts (Apple's anonymized attestation can't bind to a
  specific device — typically rejected for workforce, accepted for
  admin if MDS includes it).

## MDS3 fetch + cache

```ts
// src/lib/auth/webauthn/mds.ts
import { z } from 'zod';
import { createPublicKey, verify } from 'node:crypto';

const MDS_URL = 'https://mds3.fidoalliance.org/';
const MDS_CACHE_TTL = 24 * 60 * 60 * 1000;
let cache: { entries: Map<string, MdsEntry>; fetchedAt: number } | null = null;

const StatusReport = z.object({
  status: z.string(),
  effectiveDate: z.string().optional(),
});

const MdsEntry = z.object({
  aaguid: z.string(),
  metadataStatement: z.object({
    description: z.string(),
    authenticatorVersion: z.number(),
    attestationTypes: z.array(z.string()),
  }),
  statusReports: z.array(StatusReport),
  timeOfLastStatusChange: z.string(),
});

export async function mdsLookup(aaguid: string): Promise<MdsEntry | null> {
  if (!cache || Date.now() - cache.fetchedAt > MDS_CACHE_TTL) {
    await refreshMds();
  }
  return cache!.entries.get(aaguid) ?? null;
}

async function refreshMds(): Promise<void> {
  const blob = await fetch(MDS_URL, { headers: { accept: 'application/jose' } }).then((r) => r.text());
  const payload = await verifyJwsAgainstFidoRoot(blob);
  const entries = new Map<string, MdsEntry>();
  for (const raw of payload.entries) {
    const parsed = MdsEntry.safeParse(raw);
    if (parsed.success) entries.set(parsed.data.aaguid, parsed.data);
  }
  cache = { entries, fetchedAt: Date.now() };
}
```

Three MDS rules:

- **JWS verification mandatory** — MDS BLOB is signed by the FIDO
  Alliance root certificate; verify the chain (`x5c` header) against the
  pinned FIDO root or MDS is a trust-on-first-use anti-pattern.
- **24-hour cache TTL** — MDS BLOB is ~3 MB; refreshing per-verify
  burns latency. Daily refresh is the FIDO recommendation.
- **Fail-closed on refresh failure** — if MDS fetch fails and cache is
  stale, refuse new attestation enrolments rather than serving stale
  data; logins against already-enrolled credentials proceed (attestation
  was verified at enrolment).

## Enterprise attestation specifics

```text
fmt: 'packed' / 'tpm' / 'android-key'   → standard direct attestation, AAGUID identifies model
fmt: 'fido-u2f'                         → legacy FIDO U2F, AAGUID is all-zero, use cert subject
fmt: 'apple'                            → Apple anonymized attestation, no per-device binding
fmt: 'none'                             → no attestation conveyed (Apple platform default)
```

Enterprise attestation (`AttestationConveyancePreference.enterprise`) is
the only mode that conveys per-device unique identifiers (cert serial,
Yubikey serial). Two requirements: (a) authenticator must be
configured to emit it (Yubikey via `ykman config` enabling enterprise
attestation), (b) RP ID must be in the authenticator's enterprise
attestation allowlist. If either is missing, the authenticator silently
downgrades to `direct` — your verifier must handle this without error
(fall back to AAGUID-pinning) or the workforce enrolment fails for
non-configured devices.

## Verification telemetry

```ts
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('webauthn');

const span = tracer.startSpan('webauthn.attestation.verify', {
  attributes: {
    'webauthn.flow': stash.flow,
    'webauthn.fmt': fmt,
    'webauthn.aaguid': aaguid,
    'webauthn.mds_found': !!mds,
  },
});
try {
  // ... verification ...
  span.setAttribute('webauthn.verified', verification.verified);
} finally {
  span.end();
}
```

Per [observability.md](observability.md): `aaguid` is bounded
cardinality (~5,000 known authenticators) — safe as a span attribute.
Never include the `credentialId` (PII — per-user identifier).

## Session elevation

```ts
// src/lib/auth/session.ts
export type Session = {
  userId: string;
  email: string;
  attestationVerified: boolean;
  attestationFmt: string | null;
  authMethod: 'password' | 'passkey' | 'oidc';
  elevatedAt: Date | null;
};

export function requireAttestedSession(locals: App.Locals): Session {
  const session = requireSession(locals);
  if (!session.attestationVerified) {
    throw error(403, 'attestation_required');
  }
  if (!session.elevatedAt || Date.now() - session.elevatedAt.getTime() > 5 * 60 * 1000) {
    throw error(403, 'elevation_expired');
  }
  return session;
}
```

Two session rules:

- **Attestation-verified credential ≠ elevated session** — the
  credential proves device class; the session proves "this user just
  re-authenticated with that credential". Re-prompt for the attested
  passkey on every sensitive action with a 5-minute elevation window
  (NIST AAL3 reauthentication).
- **Elevation expires** — 5–15 minutes per FAPI 2.0; never persist
  elevation across page reloads via cookie alone (HttpOnly cookie can't
  enforce time decay; check server-side).

## Testing

```ts
import { describe, it, expect, vi } from 'vitest';
import { mdsLookup } from '$lib/auth/webauthn/mds';

vi.mock('$lib/auth/webauthn/mds', () => ({
  mdsLookup: vi.fn(),
}));

describe('attestation verify', () => {
  it('rejects uncertified authenticator for admin flow', async () => {
    vi.mocked(mdsLookup).mockResolvedValueOnce({
      aaguid: 'test-aaguid',
      metadataStatement: { /* ... */ },
      statusReports: [{ status: 'NOT_FIDO_CERTIFIED' }],
      timeOfLastStatusChange: '2026-01-01',
    });
    await expect(verifyAttestation(/* ... */)).rejects.toThrow('authenticator_uncertified');
  });

  it('falls back to none when Apple platform authenticator emits no attestation', async () => {
    const result = await verifyAttestation({ flow: 'standard', fmt: 'none' });
    expect(result.attested).toBe(false);
  });
});
```

Playwright `virtualAuthenticator` (per [passkeys.md](passkeys.md))
supports `attestation: 'direct'` — assert end-to-end enrolment
including MDS lookup with a stubbed cache.

## Anti-patterns

- **`attestation: 'direct'` as default** — leaks authenticator
  fingerprint across all RPs; only opt-in for flows that need it.
- **Trusting client-supplied `flow` on verify** — server-stash flow with
  challenge; verify reads from stash.
- **Skip MDS verification** — accepting any direct attestation without
  MDS lookup is no-op security theatre; an attacker can self-sign.
- **Skip JWS verification on MDS BLOB** — trusting unsigned MDS data
  defeats the purpose; verify against pinned FIDO Alliance root cert.
- **Reject `fmt: 'apple'` blanket** — Apple platform authenticator is
  the most common authenticator on iOS/macOS; accept it for `standard`
  flow, document policy for `admin`/`workforce`.
- **Reject `fmt: 'none'` when attestation requested** — some
  authenticators downgrade silently; gracefully fall back rather than
  failing enrolment.
- **MDS lookup per-verify without cache** — 3 MB BLOB per registration
  burns bandwidth + latency; daily refresh.
- **Verifying attestation on login** — attestation is registration-time;
  login verifies signature against stored public key only.
- **Persisting raw attestation object** — attestation statement is
  one-time-use proof; persist `aaguid` + `fmt` + `attestationVerified`
  flag, discard the rest.
- **Elevation without time decay** — attested-passkey use ≠ permanent
  elevation; re-prompt on a sliding 5–15 minute window.
- **`enterprise` attestation without authenticator pre-configuration**
  — silently downgrades to `direct`; your verifier must handle this or
  workforce enrolment fails for unconfigured devices.
- **Including `credentialId` in spans/logs** — PII, per-user identifier;
  use `aaguid` (bounded cardinality) instead.
- **`AAGUID` allowlist without status check** — an authenticator model
  may be in your allowlist but `REVOKED` in MDS (key-compromise
  disclosure); always intersect both.

## References

- [WebAuthn L3 — Attestation](https://www.w3.org/TR/webauthn-3/#sctn-attestation)
- [FIDO Metadata Service v3](https://fidoalliance.org/metadata/)
- [SimpleWebAuthn `verifyRegistrationResponse`](https://simplewebauthn.dev/docs/packages/server#verifying-attestation)
- [NIST SP 800-63B Rev.4 §5.1.9](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [FIDO Alliance — Enterprise Attestation](https://fidoalliance.org/specs/fido-v2.1-rd-20210309/fido-client-to-authenticator-protocol-v2.1-rd-20210309.html#sctn-feature-descriptions-enterp-attstn)
