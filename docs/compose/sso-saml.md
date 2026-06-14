# SSO SAML — enterprise SAML 2.0 + SCIM 2.0 provisioning opt-in

OIDC ([auth-oidc.md](auth-oidc.md)) covers consumer + most B2B
login; enterprise customers (banks, healthcare, multinational
corps) typically require SAML 2.0 + SCIM provisioning as a
contractual non-negotiable. This recipe codifies the contract:
**SAML 2.0 HTTP-POST binding via WorkOS or Ory-Hydra as default**,
**SCIM 2.0 v2 provisioning endpoint with bearer-auth + scoped per
tenant**, **per-tenant IdP metadata (entityID, x509 cert, SSO URL)
stored encrypted**, **JIT (Just-In-Time) provisioning fallback
for IdPs without SCIM**, **AssertionConsumerService URL per-tenant
discriminator so multi-tenant SAML works**, **XML signature
verification always, assertion encryption when the IdP requires
it**.

Per [principles.md §2.2](../principles.md) (OWASP ASVS L2 V8 —
authentication) and enterprise-sales realities, the posture is:
**SAML is opt-in per tenant (not default)**, **configured by admins
via UI + metadata-upload-or-URL**, **every assertion signature-
verified + replay-checked**, **SCIM provisioning through separate
bearer-token-per-tenant**, **audit every IdP-initiated login and
every SCIM mutation**.

## Related

- [auth-oidc.md](auth-oidc.md) — OIDC for non-enterprise; SSO
  config UI shares session/cookie contract with OIDC.
- [permissions.md](permissions.md) — SAML-assigned groups map to
  roles via a per-tenant group-to-role mapping table.
- [audit-log.md](audit-log.md) — every SAML login, SCIM CREATE/
  UPDATE/DELETE, and config change is audited with IdP metadata.
- [webhooks.md](webhooks.md) — SCIM is inbound webhook shape
  (POST/PUT/PATCH/DELETE with bearer-auth); reuses HMAC-verified
  receiver primitives.
- [cookies-authoritative.md](cookies-authoritative.md) — post-SAML
  session cookie contract identical to OIDC.
- [observability.md](observability.md) — `auth.provider='saml'`,
  `auth.idp` bounded label, `saml.assertion.status`.
- [feature-flags.md](feature-flags.md) — SAML is typically gated
  behind `enterprise_saml` flag + Stripe plan check.
- [onboarding.md](onboarding.md) — first-SAML-login JIT-provisions
  a new user; treat as onboarding-completed for enterprise tenants.
- [cron-jobs.md](cron-jobs.md) — daily cert-expiry check; 30-day
  warning before IdP signing cert expires.
- [secrets-management.md](secrets-management.md) — SP signing key
  + SCIM bearer tokens live in the secrets manager, never DB.
- [principles.md §2.2](../principles.md) — OWASP ASVS L2 V8.

## When to reach for SAML

```text
Consumer / prosumer self-signup           → auth-oidc.md (Google/GitHub/Microsoft-personal)
SMB B2B with SSO-wanting admin            → auth-oidc.md (Google Workspace OIDC, Azure OIDC)
Enterprise customer with Okta/OneLogin    → sso-saml.md (this)
Enterprise customer with ADFS / custom    → sso-saml.md (this)
Enterprise customer with SCIM required    → sso-saml.md + provisioning
Federal / HIPAA / FINRA customers         → sso-saml.md + attestation
```

**Three build rules:**

1. **Don't build SAML yourself.** Use `samlify`, `@node-saml/passport-saml`,
   WorkOS (SaaS), or Ory-Hydra (self-host). XML Signature, XML
   Canonicalization, and assertion-encryption are where CVEs
   come from — use hardened libraries.
2. **SAML is opt-in per tenant, not global.** Default remains OIDC
   in [auth-oidc.md](auth-oidc.md); SAML is a per-tenant
   configuration that costs engineering + support overhead per
   customer.
3. **SCIM is the enterprise-ask, not the mandatory.** Most
   enterprise customers want SAML-only; SCIM is the "full
   provisioning" tier. Start with SAML + JIT; add SCIM per
   customer demand.

## Build-vs-buy matrix

| Option | Use when | Avoid when |
|---|---|---|
| **WorkOS** (DEFAULT new) | Want zero-SAML-library-code; per-tenant IdP via WorkOS dashboard | Data residency outside WorkOS regions; budget-constrained |
| **Ory Hydra + Ory Kratos** (ESCAPE self-host) | Full self-host; OSS; willing to operate | Small team; want managed |
| **`@node-saml/passport-saml`** | Need direct SAML lib integration | Don't want to own XML-DSIG edge cases |
| **`samlify`** | TypeScript-native SAML lib | Same as above |
| **Auth0 / Okta as SP** | Already on Auth0 | New projects prefer WorkOS or Hydra |
| **Build your own XML-DSIG** | Never | Always |

**Three provider rules:**

1. **WorkOS is default for new projects.** Per-connection
   dashboard, SCIM included, responsive support, transparent
   pricing — the friction cost of SAML is their value prop.
2. **Ory Hydra when self-host is required.** Banks / gov /
   air-gapped. Expect 2-4 engineer-weeks for a hardened setup.
3. **`@node-saml/passport-saml` or `samlify` only when the above
   don't fit.** Library-level integration puts XML-signature
   correctness on you; audit quarterly.

## Install — WorkOS default path

```bash
pnpm add @workos-inc/node
```

For self-host with samlify:

```bash
pnpm add samlify @authenio/samlify-node-xmllint
```

## Shape

```text
src/lib/auth/saml/
├── config.ts            per-tenant IdP config resolver
├── verify.ts            SAML assertion verification (if not WorkOS)
└── schemas.ts           SAMLConfig + SCIMUser Zod schemas

src/lib/auth/scim/
├── handlers.ts          SCIM Users / Groups endpoint handlers
└── mapper.ts            SCIM schema → internal user shape

src/routes/api/auth/saml/
├── [tenant]/login/+server.ts           SP-initiated SSO redirect
├── [tenant]/callback/+server.ts        AssertionConsumerService (ACS)
├── [tenant]/metadata/+server.ts        SP metadata XML for IdP
└── [tenant]/logout/+server.ts          SP-initiated SLO

src/routes/api/auth/scim/v2/
├── Users/+server.ts                    SCIM Users collection
├── Users/[id]/+server.ts               SCIM Users resource
├── Groups/+server.ts                   SCIM Groups collection
├── Groups/[id]/+server.ts              SCIM Groups resource
└── ServiceProviderConfig/+server.ts    SCIM discovery

src/routes/(admin)/saml/
├── +page.svelte                         per-tenant SAML config UI
└── +page.server.ts                      save metadata / generate tokens

supabase/migrations/NNN_saml.sql
                                         tenant_saml_configs + scim_tokens
```

## Reference pattern — WorkOS default

### 1. Per-tenant SAML configuration

```sql
CREATE TABLE tenant_saml_configs (
  tenant_id              UUID PRIMARY KEY REFERENCES tenants(id),
  workos_connection_id   TEXT NOT NULL,
  sp_entity_id           TEXT NOT NULL,
  enforced               BOOLEAN NOT NULL DEFAULT false,
  default_role           TEXT NOT NULL DEFAULT 'member',
  group_mappings         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scim_tokens (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  token_hash    TEXT NOT NULL,
  label         TEXT NOT NULL,
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX scim_tokens_tenant_idx ON scim_tokens (tenant_id) WHERE revoked_at IS NULL;
```

**Six config rules:**

1. **`workos_connection_id`** is the per-tenant foreign-key into
   WorkOS. Self-host: replace with `sp_entity_id` + `idp_metadata_url`
   + `x509_cert` columns.
2. **`enforced: true` blocks password + OIDC login.** Enterprise
   customers want "only SAML works" so user accounts can't be
   created outside IdP control.
3. **`default_role`** is what new JIT-provisioned users get
   (usually `member`). Upgrade via group mapping or manual admin
   action.
4. **`group_mappings`** is a JSON array `[{samlGroup, internalRole}]`.
   Bounded — changes via PR or admin UI, not runtime-arbitrary.
5. **SCIM tokens are hashed (SHA-256) before storage.** The
   plaintext is shown exactly once at creation, then never again.
6. **Tokens are labeled** (`"Okta prod"`, `"Azure staging"`) so
   admins can revoke the right one. Multiple tokens per tenant
   allowed for zero-downtime rotation.

### 2. SP metadata endpoint

```typescript
// src/routes/api/auth/saml/[tenant]/metadata/+server.ts
import type { RequestHandler } from './$types';
import { PUBLIC_ORIGIN } from '$env/static/public';
import { WORKOS_API_KEY } from '$env/static/private';
import { WorkOS } from '@workos-inc/node';

const workos = new WorkOS(WORKOS_API_KEY);

export const GET: RequestHandler = async ({ params }) => {
  const connection = await workos.sso.getConnection(params.connection_id);
  const metadata = buildSPMetadata({
    entityId: `${PUBLIC_ORIGIN}/api/auth/saml/${params.tenant}`,
    acsUrl: `${PUBLIC_ORIGIN}/api/auth/saml/${params.tenant}/callback`,
    sloUrl: `${PUBLIC_ORIGIN}/api/auth/saml/${params.tenant}/logout`,
    nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  });

  return new Response(metadata, {
    headers: { 'content-type': 'application/samlmetadata+xml' },
  });
};
```

**Five metadata rules:**

1. **Per-tenant entityID**. `https://example.com/api/auth/saml/{tenant}`
   — not global `https://example.com`. Prevents IdP cert confusion
   and enables per-tenant metadata rotation.
2. **ACS URL contains tenant discriminator.** Assertions for
   tenant A arrive at `/saml/A/callback`; same for B.
3. **`NameIDFormat: emailAddress`** as default. Some IdPs require
   `persistent` or `transient`; accept per-tenant override.
4. **Include SP signing cert** in metadata if you sign
   AuthnRequests (recommended for enforced tenants).
5. **Metadata is PUBLIC.** No auth gate — IdP fetches anonymously.
   Don't embed secrets.

### 3. SP-initiated login

```typescript
// src/routes/api/auth/saml/[tenant]/login/+server.ts
import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { WorkOS } from '@workos-inc/node';
import { WORKOS_API_KEY } from '$env/static/private';
import { db } from '$lib/db';

const workos = new WorkOS(WORKOS_API_KEY);

export const GET: RequestHandler = async ({ params, url }) => {
  const config = await db.oneOrNone(
    `SELECT workos_connection_id FROM tenant_saml_configs WHERE tenant_id = $1`,
    [params.tenant],
  );
  if (!config) throw redirect(303, '/login?error=saml_not_configured');

  const next = url.searchParams.get('next') ?? '/';

  const authorizationUrl = workos.sso.getAuthorizationUrl({
    connection: config.workos_connection_id,
    redirectUri: `${PUBLIC_ORIGIN}/api/auth/saml/${params.tenant}/callback`,
    state: signState({ tenantId: params.tenant, next }),
  });

  throw redirect(303, authorizationUrl);
};
```

**Four login rules:**

1. **`state` parameter carries `tenantId` + `next`**, HMAC-signed.
   Prevents open-redirect on `next`, prevents cross-tenant
   assertion-replay.
2. **No user input in state** — only signed server-derived values.
3. **`redirect(303)` not `302`** — POST semantics clearer.
4. **Error path via `/login?error=...`** — user-facing; never a
   raw 500 to an IdP-following user.

### 4. ACS callback

```typescript
// src/routes/api/auth/saml/[tenant]/callback/+server.ts
import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { WorkOS } from '@workos-inc/node';
import { WORKOS_API_KEY } from '$env/static/private';
import { verifyState } from '$lib/auth/state';
import { jitProvisionUser } from '$lib/auth/saml/provision';
import { createSession } from '$lib/auth/session';
import { recordAudit } from '$lib/audit';

const workos = new WorkOS(WORKOS_API_KEY);

export const GET: RequestHandler = async ({ params, url, cookies, getClientAddress }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) throw redirect(303, '/login?error=saml_missing_code');

  const verified = verifyState(state);
  if (!verified || verified.tenantId !== params.tenant) {
    throw redirect(303, '/login?error=saml_state_mismatch');
  }

  const { profile } = await workos.sso.getProfileAndToken({ code });

  const user = await jitProvisionUser({
    tenantId: params.tenant,
    externalId: profile.id,
    email: profile.email,
    firstName: profile.firstName,
    lastName: profile.lastName,
    groups: profile.groups ?? [],
  });

  await createSession(cookies, user);

  await recordAudit({
    actor: `saml:${profile.idp}`,
    action: 'auth.saml.login',
    targetUserId: user.id,
    tenantId: params.tenant,
    metadata: { ip: getClientAddress(), idp: profile.idp },
  });

  throw redirect(303, sanitizeNext(verified.next));
};
```

**Seven callback rules:**

1. **WorkOS verifies the SAML assertion** — signature, audience,
   NotBefore/NotOnOrAfter, InResponseTo, replay. Self-host with
   `samlify`: do ALL of these manually — each is a CVE class.
2. **State-verify BEFORE trusting tenant**. `verified.tenantId`
   MUST match `params.tenant`. Cross-tenant assertion-injection
   attempts fail here.
3. **JIT-provision on first login.** Look up user by
   `(tenant_id, external_id)` OR `(tenant_id, email)`; create
   if missing; update if found. Upsert, not insert.
4. **`externalId` from IdP is stable** — prefer it over email for
   lookup. Emails change (marriage, domain moves); IdP IDs don't.
5. **Group → role mapping** applied on every login, not just
   first. User added to `admins` group in Okta → next login they
   get admin role.
6. **Session cookie same as OIDC path.** [cookies-authoritative.md](cookies-authoritative.md)
   contract — `__Host-session`, `httpOnly`, `secure`, `sameSite:
   lax`.
7. **Audit with `actor: 'saml:<idp>'`** not user-actor. The user
   didn't authorize themselves; the IdP did. Makes audit
   queries sensible.

### 5. JIT provisioning

```typescript
// src/lib/auth/saml/provision.ts
import { db } from '$lib/db';
import { uuidv7 } from '$lib/observability';
import { now } from '$lib/clock';

interface JITInput {
  tenantId: string;
  externalId: string;
  email: string;
  firstName: string;
  lastName: string;
  groups: string[];
}

export async function jitProvisionUser(input: JITInput): Promise<User> {
  return db.tx(async (t) => {
    const existing = await t.oneOrNone<User>(
      `SELECT * FROM users
        WHERE tenant_id = $1 AND (external_id = $2 OR email = $3)`,
      [input.tenantId, input.externalId, input.email.toLowerCase()],
    );

    if (existing) {
      await t.none(
        `UPDATE users SET
            external_id = $1,
            first_name = $2,
            last_name = $3,
            last_login_at = $4
          WHERE id = $5`,
        [input.externalId, input.firstName, input.lastName, now(), existing.id],
      );
    }

    const config = await t.one(
      `SELECT default_role, group_mappings FROM tenant_saml_configs WHERE tenant_id = $1`,
      [input.tenantId],
    );

    const role = resolveRole(config.default_role, config.group_mappings, input.groups);

    if (existing) {
      await t.none(`UPDATE users SET role = $1 WHERE id = $2`, [role, existing.id]);
      return { ...existing, role };
    }

    const id = uuidv7();
    await t.none(
      `INSERT INTO users (id, tenant_id, email, external_id, first_name, last_name, role, created_at, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [id, input.tenantId, input.email.toLowerCase(), input.externalId, input.firstName, input.lastName, role, now()],
    );

    return { id, tenantId: input.tenantId, email: input.email, role, externalId: input.externalId };
  });
}

function resolveRole(
  defaultRole: string,
  mappings: Array<{ samlGroup: string; internalRole: string }>,
  samlGroups: string[],
): string {
  for (const m of mappings) {
    if (samlGroups.includes(m.samlGroup)) return m.internalRole;
  }
  return defaultRole;
}
```

**Five JIT rules:**

1. **Email-normalized (lowercase)** for lookups. `User@Example.com`
   and `user@example.com` must resolve to same user.
2. **Upsert on `(tenant_id, external_id)` OR `(tenant_id, email)`**
   — tenant-scoped. Cross-tenant email collisions are OK; each
   tenant's user is separate.
3. **Role recomputed on every login.** Group removal in Okta →
   role demotion on next login. Never "sticky" elevated role.
4. **First-match wins in group mapping.** Order in the mappings
   array matters; documented in admin UI.
5. **Tx wraps upsert + role update** — can't have a user row
   without a role. Atomic.

## SCIM 2.0 endpoint

### 6. SCIM auth middleware

```typescript
// src/lib/auth/scim/authn.ts
import { error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { createHash } from 'node:crypto';

export async function verifyScimToken(
  request: Request,
  tenantId: string,
): Promise<void> {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    throw error(401, { type: 'urn:sveltesentio:scim:unauthorized', title: 'Unauthorized' });
  }

  const token = auth.slice('Bearer '.length);
  const hash = createHash('sha256').update(token).digest('hex');

  const row = await db.oneOrNone(
    `SELECT id FROM scim_tokens
      WHERE tenant_id = $1 AND token_hash = $2 AND revoked_at IS NULL`,
    [tenantId, hash],
  );

  if (!row) throw error(401, { type: 'urn:sveltesentio:scim:unauthorized', title: 'Unauthorized' });

  await db.none(`UPDATE scim_tokens SET last_used_at = now() WHERE id = $1`, [row.id]);
}
```

**Four SCIM-auth rules:**

1. **Bearer token, SHA-256 hashed at rest.** Plaintext shown once
   at creation.
2. **Per-tenant tokens** — no global "admin" SCIM token.
3. **`last_used_at` updated on every call** — zombie-token
   detection (IdP unplugged, token still exists → revoke).
4. **Rotation: issue new, IdP configures, revoke old.** Two-
   token-active-window = zero-downtime.

### 7. SCIM Users endpoint

```typescript
// src/routes/api/auth/scim/v2/Users/+server.ts
import type { RequestHandler } from './$types';
import { verifyScimToken } from '$lib/auth/scim/authn';
import { scimCreate, scimList } from '$lib/auth/scim/handlers';

export const GET: RequestHandler = async ({ request, locals, url }) => {
  await verifyScimToken(request, locals.tenantId);
  const filter = url.searchParams.get('filter');
  const result = await scimList(locals.tenantId, { filter });
  return new Response(JSON.stringify(result), {
    headers: { 'content-type': 'application/scim+json' },
  });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  await verifyScimToken(request, locals.tenantId);
  const body = await request.json();
  const user = await scimCreate(locals.tenantId, body);
  return new Response(JSON.stringify(user), {
    status: 201,
    headers: {
      'content-type': 'application/scim+json',
      location: `/api/auth/scim/v2/Users/${user.id}`,
    },
  });
};
```

**Six SCIM-endpoint rules:**

1. **SCIM errors are RFC 7644 JSON envelopes** with `status`,
   `scimType`, `detail`. IdPs expect them verbatim.
2. **`application/scim+json` content-type** (not
   `application/json`). IdP SCIM clients check the header.
3. **Filter support minimum: `userName eq "..."`** + `externalId
   eq "..."`. Okta/Azure use these for dedup before CREATE.
4. **Soft-delete on DELETE.** SCIM DELETE = user deactivated;
   their data stays for audit. Restore via PUT active=true.
5. **Partial update via PATCH.** SCIM PATCH is a mini-DSL
   (`op`, `path`, `value`); implement at minimum `replace` and
   `add` on `active` + `emails` + `displayName`.
6. **Rate-limit SCIM bucket.** IdP bulk-imports can be 10k
   requests in minutes; cap at 100/minute per token to prevent
   accidental DoS.

## Logout (Single Logout — SLO)

```typescript
// src/routes/api/auth/saml/[tenant]/logout/+server.ts
import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { destroySession } from '$lib/auth/session';

export const POST: RequestHandler = async ({ cookies }) => {
  await destroySession(cookies);
  throw redirect(303, '/?logged_out=1');
};

export const GET = POST;
```

**Three SLO rules:**

1. **SLO is BEST-EFFORT.** SAML SLO spec is under-implemented by
   IdPs. Destroy local session always; the IdP-side logout is
   whatever the IdP supports.
2. **Accept both GET and POST** — different IdPs send different.
3. **Never trust logout-response to "log out other SPs"** —
   that's the IdP's job; attempting cross-SP logout from our
   side is a security hazard.

## Certificate expiry monitoring

```typescript
// src/routes/api/cron/saml-cert-expiry/+server.ts
import { withCronRun } from '../_shared/runner';
import { verifyCronRequest } from '../_shared/authn';
import { db } from '$lib/db';
import { daysUntil } from '$lib/time';
import { sendEmail } from '$lib/email/send';

export const POST: RequestHandler = async ({ request }) => {
  verifyCronRequest(request);

  return withCronRun('saml-cert-expiry', async () => {
    const configs = await db.manyOrNone(
      `SELECT tenant_id, idp_x509_cert, idp_cert_expires_at FROM tenant_saml_configs`,
    );

    let warned = 0;
    for (const c of configs) {
      const days = daysUntil(c.idp_cert_expires_at);
      if ([30, 14, 7, 1].includes(days)) {
        await notifyTenantAdmins(c.tenant_id, {
          template: 'saml_cert_expiring',
          data: { days, certExpiresAt: c.idp_cert_expires_at },
        });
        warned++;
      }
    }

    return { processed: configs.length, skipped: 0, details: { warned } };
  });
};
```

**Three cert-monitoring rules:**

1. **Alert at 30/14/7/1 days.** Enterprise customers need lead
   time to coordinate cert rotation with their IT team.
2. **Email tenant admins, not just us.** We can't rotate their
   IdP cert for them; they need warning.
3. **Expired cert = SAML-broken.** Users see redirect-loop or
   `invalid signature`. Monitor for `saml.assertion.status=failed`
   spike; cross-reference against expiry dates.

## Observability

```text
Attribute                Values
──────────────────────────────────────────────────────
auth.provider            'password' | 'oidc' | 'saml' | 'scim'
auth.idp                 bounded enum: 'okta' | 'azure_ad' | 'google' | 'onelogin' | 'adfs' | 'other'
auth.tenant_id           UUID (span attribute only; not label)
saml.assertion.status    'ok' | 'signature_failed' | 'replay' | 'audience_mismatch' | 'expired' | 'clock_skew'
scim.action              'create' | 'update' | 'delete' | 'list' | 'get' | 'patch'

Metrics
──────────────────────────────────────────────────────
auth.saml.assertion.count       counter, labels: idp, status
auth.saml.login.latency         histogram, labels: idp
scim.request.count              counter, labels: action, status
scim.token.usage                counter, labels: token_label (bounded, ≤10 per tenant)
```

**Five observability rules:**

1. **Assertion-failure reasons are bounded** — track which failure
   mode dominates. `clock_skew` spike → investigate NTP.
2. **`tenant_id` is span attribute, not metric label** — hundreds
   of tenants would explode cardinality.
3. **IdP bounded enum** — five + `other`. New major IdP = enum
   bump.
4. **Alert on `assertion.status != 'ok'` >5% for any tenant** —
   something wrong with their config.
5. **SCIM-token usage zero for 30 days = alert** — token likely
   unused, should be revoked.

## Anti-patterns

1. **Build-your-own XML-DSIG.** Where CVEs come from. Use
   hardened libraries (WorkOS, samlify, passport-saml).
2. **Global entityID for all tenants.** Same entityID + different
   assertions = IdP confusion. Per-tenant.
3. **No state-parameter verification.** Open-redirect attack via
   `next=` manipulation. HMAC-sign state always.
4. **Lookup user by email only, not externalId.** Email changes;
   externalId doesn't. Lookup breaks on marriage/domain-rename.
5. **Stick role on first login, don't recompute.** User removed
   from admin group in Okta keeps admin role forever.
6. **No JIT provisioning.** First user gets "no account found,"
   contacts support. JIT is the point of SAML.
7. **SCIM token stored plaintext in DB.** Breach = all tenants'
   IdP-level-write access compromised.
8. **Global SCIM endpoint with tenant in body.** Body-injection
   → cross-tenant writes. Tenant in URL path, verified at auth.
9. **Enforce SAML globally for a tenant without offering
   break-glass.** Admin locked out when IdP is down. Provide a
   break-glass admin-local-password for the primary admin.
10. **No cert-expiry monitoring.** Cert expires at 3 AM Sunday;
    Monday morning no one can log in; enterprise customer
    escalation.
11. **SCIM DELETE = hard-delete.** Breaks audit trail, breaks
    data-retention. Soft-delete + separate "purge" for legal
    erasure only.
12. **Trusting `Destination` attribute in assertion without
    strict match.** Attacker with valid-for-another-SP assertion
    replays; audience check must be strict.
13. **`Vary: Cookie` missing on cached SAML error pages.** Per-
    user error content leaks across cache.
14. **Per-tenant SAML config editable via API without audit.**
    Attacker with admin token swaps IdP cert → takes over all
    logins. Audit every config change.
15. **SAML enabled by default for all tenants.** SAML is opt-in;
    enabling creates attack surface for tenants that don't use
    it.

## References

- [ADR-0019 — structured errors](../adr/0019-structured-errors.md) —
  SCIM error envelope compatibility.
- [ADR-0032 — auth OIDC](../adr/0032-auth-oidc.md) — session cookie
  shared contract.
- [ADR-0034 — cookies](../adr/0034-cookies.md) — `__Host-` prefix.
- [auth-oidc.md](auth-oidc.md) — sibling OIDC recipe.
- [audit-log.md](audit-log.md) — SAML + SCIM audit.
- [secrets-management.md](secrets-management.md) — SP signing key
  + SCIM token storage.
- [observability.md](observability.md) — bounded auth labels.
- [cron-jobs.md](cron-jobs.md) — cert-expiry monitoring.
- [OASIS SAML 2.0 Core](http://docs.oasis-open.org/security/saml/v2.0/saml-core-2.0-os.pdf) — spec reference.
- [RFC 7644 — SCIM Protocol](https://datatracker.ietf.org/doc/html/rfc7644) — SCIM 2.0 HTTP.
- [RFC 7643 — SCIM Core Schema](https://datatracker.ietf.org/doc/html/rfc7643) — User/Group shapes.
- [WorkOS docs](https://workos.com/docs) — SaaS SAML+SCIM integration.
- [NIST SP 800-63C — Federation](https://pages.nist.gov/800-63-3/sp800-63c.html) — federation assurance levels.
- [OWASP SAML Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SAML_Security_Cheat_Sheet.html) — attack-mode reference.
