# tenant-custom-domains.md — composition recipe

> **Tenants bring their own domain.** Instead of
> `tenant-slug.sveltesentio.app`, `app.acme.com` points at the
> platform. Three sub-systems compose: **CNAME verification**
> (tenant owns the domain), **automatic TLS provisioning**
> (ACME-01/HTTP-01/DNS-01 via [Caddy](https://caddyserver.com/)
> or managed edge like Cloudflare for SaaS / Fly.io), and **per-
> request tenant routing** (hostname → tenantId lookup with
> cache). Per [ADR-0050](../adr/0050-tenant-theming.md) tenant
> theming resolves from `locals.tenant`; per
> [ADR-0034](../adr/0034-auth-cookie-and-csrf-contract.md)
> custom-domain requests use `__Secure-*` cookies with `Domain=`
> set, not `__Host-` (which forbids `Domain=`).

> **Do not roll your own ACME.** Use a managed primitive — Caddy
> on-demand TLS, Cloudflare for SaaS, Fly.io Certificates API,
> Vercel / Netlify domains, or Let's Encrypt behind a dedicated
> cert-manager. The failure modes of ACME edge cases (CAA records,
> rate limits, OCSP stapling, ECDSA vs RSA selection) are tuned by
> people whose full-time job is TLS.

## Related

- [tenant-provisioning.md](tenant-provisioning.md) — tenant exists
  before domain; domain is an attached resource
- [tenant-theming.md](tenant-theming.md) — theming resolves off
  `locals.tenant`; custom domain doesn't change the theming path
- [cookies-authoritative.md](cookies-authoritative.md) — `__Host-`
  forbids `Domain=`; custom-domain requests must use `__Secure-`
- [auth-oidc.md](auth-oidc.md) — OIDC redirect URIs must include
  every verified custom domain
- [observability.md](observability.md) — per-domain metrics
  (`http_requests_total{host}`) for DNS/TLS troubleshooting
- [rate-limiting.md](rate-limiting.md) — verification endpoint is
  rate-limited by tenant + IP (DNS lookup is expensive)
- [audit-log.md](audit-log.md) — domain add/remove/verify events
- [multi-region-deployment.md](multi-region-deployment.md) —
  anycast routing; domain apex vs subdomain differ
- [rbac-modeling.md](rbac-modeling.md) — `tenant:admin:domains`
- [ADR-0050](../adr/0050-tenant-theming.md),
  [ADR-0034](../adr/0034-auth-cookie-and-csrf-contract.md)

## When to use what

```text
Platform-native subdomain (default)               → tenant-slug.sveltesentio.app
                                                    Zero-config; included in every plan
Tenant-chosen subdomain on platform apex          → acme.sveltesentio.app
                                                    Same wildcard cert; no provisioning
Tenant custom apex / subdomain                    → app.acme.com, portal.acme.com
                                                    THIS RECIPE; ACME per-hostname
Apex (naked) domain                               → acme.com
                                                    Special case: requires ALIAS / ANAME
                                                    Not all DNS providers support it
Cloudflare proxied (orange cloud)                 → CF for SaaS flow; tenant keeps CF
                                                    Additional "Custom Hostnames" API
Enterprise white-label (full DNS delegation)      → out-of-scope for self-serve
                                                    Run-book; manual DNS cutover
Per-tenant subdomain + per-route path             → subdomain for multi-tenant isolation
                                                    path prefixes are i18n / sections
```

## Verification strategies

```text
TXT-record verification (recommended)       _sentio-challenge.app.acme.com TXT "verify=abc123"
                                            DNS-level; no interruption to existing traffic
                                            Tenant can verify before flipping CNAME

CNAME + direct traffic (after verification) app.acme.com CNAME domains.sveltesentio.app
                                            This is the LIVE CNAME after verification passes
                                            Caddy on-demand TLS issues cert on first hit

HTTP-01 file challenge (fallback)           GET /.well-known/acme-challenge/<token>
                                            Works when tenant can't set TXT
                                            Requires the CNAME to already be live
                                            Do NOT use as the verification step;
                                            only as the TLS-issuance step
```

The production flow: **TXT verification → CNAME flip → on-demand
TLS**. Verification must complete before the CNAME flips — otherwise
a malicious tenant could claim a domain they don't control.

## Shape — bounded Zod

```ts
// packages/shell/src/domains/types.ts
import { z } from 'zod';

// RFC 1035 + practical limits.
// Max length 253, labels 1-63, LDH (letters, digits, hyphen), no leading/trailing hyphen per label.
export const DomainName = z.string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);

export const DomainStatus = z.enum([
  'pending_verification',  // TXT not yet seen
  'verifying',              // active polling
  'verified',               // TXT matches; awaiting CNAME
  'active',                 // CNAME live + TLS issued
  'renewal_failed',         // TLS renewal failure; alert
  'disabled',               // admin disabled OR tenant removed
  'revoked',                // tenant offboarded; ACME cert revoked
]);
export type DomainStatus = z.infer<typeof DomainStatus>;

export const CustomDomain = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  hostname: DomainName,
  verificationToken: z.string().regex(/^[A-Za-z0-9]{32}$/),
  status: DomainStatus,
  isApex: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  verifiedAt: z.string().datetime({ offset: true }).nullable(),
  activatedAt: z.string().datetime({ offset: true }).nullable(),
  lastCheckedAt: z.string().datetime({ offset: true }).nullable(),
  certProvider: z.enum(['caddy', 'cloudflare-saas', 'fly-certs', 'managed-other']).default('caddy'),
  // Cert fingerprint — monitor for unexpected rotations.
  certFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  certExpiresAt: z.string().datetime({ offset: true }).nullable(),
});
export type CustomDomain = z.infer<typeof CustomDomain>;
```

## Reference pattern

### 1. Add a domain — issue verification token

```ts
// src/routes/tenant/[tenant]/domains/+page.server.ts
import { fail, error } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { DomainName } from '@sveltesentio/shell/domains';
import { superValidate } from 'sveltekit-superforms/server';
import { zod } from 'sveltekit-superforms/adapters';
import { z } from 'zod';

const AddDomain = z.object({ hostname: DomainName });

const RESERVED = new Set([
  'sveltesentio.app', 'localhost', 'invalid',
]);

export const actions = {
  add: async ({ request, locals, params }) => {
    if (!locals.user?.permissions.includes('tenant:admin:domains')) throw error(403);
    const form = await superValidate(request, zod(AddDomain));
    if (!form.valid) return fail(400, { form });
    const hostname = form.data.hostname;

    // Reject platform-owned domains.
    if (RESERVED.has(hostname) || hostname.endsWith('.sveltesentio.app')) {
      return fail(422, { form, message: 'Cannot claim a platform-owned domain' });
    }

    // Reject duplicates (a domain can only be claimed by one tenant).
    const existing = await findActiveDomain(hostname);
    if (existing && existing.tenantId !== params.tenant) {
      return fail(409, { form, message: 'Domain already claimed by another tenant' });
    }

    const token = randomBytes(16).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 32).padEnd(32, 'a');
    await insertCustomDomain({
      id: crypto.randomUUID(),
      tenantId: params.tenant,
      hostname,
      verificationToken: token,
      status: 'pending_verification',
      isApex: hostname.split('.').length === 2,
      createdAt: new Date().toISOString(),
      verifiedAt: null,
      activatedAt: null,
      lastCheckedAt: null,
      certProvider: 'caddy',
      certFingerprint: null,
      certExpiresAt: null,
    });

    await writeAuditEvent({
      kind: 'domain.added',
      subjectId: locals.user.id,
      payload: { tenantId: params.tenant, hostname, token },
    });
  },
};
```

### 2. Show the tenant the DNS records to create

```svelte
<!-- src/routes/tenant/[tenant]/domains/[id]/+page.svelte -->
<h1>Configure {data.domain.hostname}</h1>

<ol>
  <li>
    <h2>Step 1 — Verification TXT record</h2>
    <p>Add this TXT record at your DNS provider:</p>
    <dl>
      <dt>Name</dt>
      <dd><code>_sentio-challenge.{data.domain.hostname}</code></dd>
      <dt>Type</dt>
      <dd><code>TXT</code></dd>
      <dt>Value</dt>
      <dd><code>verify={data.domain.verificationToken}</code></dd>
      <dt>TTL</dt>
      <dd>3600 (or provider default)</dd>
    </dl>
    {#if data.domain.status === 'pending_verification'}
      <form method="POST" action="?/check" use:enhance>
        <button>Check verification</button>
      </form>
    {:else if data.domain.status === 'verified'}
      <p>✓ Verified at {data.domain.verifiedAt}</p>
    {/if}
  </li>
  <li>
    <h2>Step 2 — CNAME record (after verification)</h2>
    {#if data.domain.isApex}
      <p>Because <code>{data.domain.hostname}</code> is an apex domain, you must use either:</p>
      <ul>
        <li><strong>ALIAS / ANAME record</strong> (if your DNS provider supports it)</li>
        <li><strong>Flattening at Cloudflare / Route 53</strong></li>
      </ul>
      <dl><dt>Target</dt><dd><code>domains.sveltesentio.app</code></dd></dl>
    {:else}
      <dl>
        <dt>Name</dt><dd><code>{data.domain.hostname}</code></dd>
        <dt>Type</dt><dd><code>CNAME</code></dd>
        <dt>Value</dt><dd><code>domains.sveltesentio.app</code></dd>
      </dl>
    {/if}
  </li>
  <li>
    <h2>Step 3 — TLS</h2>
    <p>Issued automatically on first HTTPS request to <code>{data.domain.hostname}</code>.</p>
    {#if data.domain.status === 'active'}
      <p>✓ Active. Cert expires {data.domain.certExpiresAt?.slice(0, 10)}.</p>
    {/if}
  </li>
</ol>
```

### 3. Verification endpoint — DNS-over-HTTPS query

```ts
// packages/shell/src/domains/verify.ts
export async function verifyDomain(domain: CustomDomain): Promise<'verified' | 'not_found' | 'mismatch'> {
  // DNS-over-HTTPS via Cloudflare or Google. Avoids platform DNS cache issues.
  const url = `https://cloudflare-dns.com/dns-query?name=_sentio-challenge.${encodeURIComponent(domain.hostname)}&type=TXT`;
  const res = await fetch(url, {
    headers: { accept: 'application/dns-json' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error('dns_query_failed');
  const body = await res.json() as { Answer?: Array<{ data: string }> };
  const txts = (body.Answer ?? []).map((a) => a.data.replace(/^"|"$/g, ''));
  const expected = `verify=${domain.verificationToken}`;
  if (txts.length === 0) return 'not_found';
  if (!txts.some((t) => t === expected)) return 'mismatch';

  await markDomainVerified(domain.id);
  return 'verified';
}
```

### 4. Request-time hostname → tenant resolution

```ts
// src/hooks.server.ts — excerpt
import { getTenantForHostname } from '$lib/server/domains';

export async function handle({ event, resolve }) {
  const host = event.url.host;
  const platformSuffix = '.sveltesentio.app';

  let tenant;
  if (host.endsWith(platformSuffix) || host === 'sveltesentio.app') {
    // Platform domain — extract slug from subdomain.
    const slug = host.slice(0, -platformSuffix.length);
    tenant = await getTenantBySlug(slug);
  } else {
    // Custom domain — look up by hostname.
    tenant = await getTenantForHostname(host);
  }

  if (!tenant) {
    return new Response('Tenant not found', { status: 404 });
  }

  event.locals.tenant = tenant;
  event.locals.isCustomDomain = !host.endsWith(platformSuffix);
  return resolve(event);
}
```

`getTenantForHostname` is **cached** in Redis with a 60-second TTL.
A DB hit per request at the edge would saturate the pool during a
launch spike. Cache busting fires on domain add/remove/status
changes.

### 5. Cookies — `__Host-` vs `__Secure-`

```ts
// packages/auth/src/cookies.ts
export function setSessionCookie(event: RequestEvent, token: string) {
  if (event.locals.isCustomDomain) {
    event.cookies.set('__Secure-session', token, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      // NO `domain=` — cookie scopes to exact host. No subdomains.
      maxAge: 60 * 60 * 24 * 7,
    });
  } else {
    event.cookies.set('__Host-session', token, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    });
  }
}
```

**`__Host-` is the stronger primitive** (platform default). On
custom domains we downgrade to `__Secure-` because `__Host-` forbids
`Domain=` — which is fine since we also omit `Domain=`. The cookie
is still scoped to the exact host, but the `__Host-` prefix is
explicitly denied by browsers when reading from a non-platform
context (the platform's own JS running on `acme.example.com` would
not share `__Host-session` with `sveltesentio.app`).

### 6. Caddy on-demand TLS config

```caddy
# Caddyfile — edge routing
{
    on_demand_tls {
        ask http://verify.internal/domain-allowed
        interval 2m
        burst 5
    }
}

:443 {
    tls {
        on_demand
        issuer acme {
            email tls-ops@sveltesentio.app
        }
    }
    reverse_proxy app-svelte:3000
}

domains.sveltesentio.app, *.sveltesentio.app {
    tls {
        dns cloudflare {env.CF_API_TOKEN}
    }
    reverse_proxy app-svelte:3000
}
```

The `ask` endpoint answers "is this hostname allowed to receive a
cert?" — a simple HTTP 200 / 404 lookup against our custom-domains
table. **Without the `ask` gate**, any attacker could point their
domain at us and force ACME requests, hitting Let's Encrypt rate
limits.

```ts
// src/routes/internal/domain-allowed/+server.ts
export async function GET({ url }) {
  const host = url.searchParams.get('domain');
  if (!host) return new Response(null, { status: 404 });
  const d = await findActiveDomain(host);
  if (d && d.status === 'verified') return new Response(null, { status: 200 });
  if (d && d.status === 'active') return new Response(null, { status: 200 });
  return new Response(null, { status: 404 });
}
```

### 7. OIDC redirect URIs + CORS allowlist updates

```ts
// packages/auth/src/oidc.ts — excerpt
export async function buildOidcRedirectUris(): Promise<string[]> {
  const platform = ['https://sveltesentio.app/auth/callback'];
  const customDomains = await listActiveCustomDomains();
  const custom = customDomains.map((d) => `https://${d.hostname}/auth/callback`);
  return [...platform, ...custom];
}
```

Every new active domain triggers an OIDC provider config update. For
Ory Hydra: call `adminUpdateOAuth2Client` with the new
`redirect_uris` list. For Auth0/WorkOS: API equivalent.

**Propagation delay matters** — between domain going active and
redirect-URI propagation, auth on that domain fails. Gate the
`active` transition on the OIDC update succeeding.

### 8. Removal + revocation

```ts
// packages/shell/src/domains/remove.ts
export async function removeDomain(domainId: string, operatorId: string) {
  const d = await loadDomain(domainId);
  if (!d) return;

  // Best-effort ACME cert revocation (ACME providers support this).
  // Caddy's cert storage has the key; it handles revoke on API call.
  try {
    await caddyApi.deleteCertificate(d.hostname);
  } catch (e) {
    logger.warn('cert_revocation_failed', { domain: d.hostname, error: e });
  }

  await updateDomainStatus(domainId, 'revoked');

  // Invalidate the hostname→tenant cache.
  await redis.del(`domain:hostname:${d.hostname}`);

  // Remove from OIDC redirect URIs.
  await removeOidcRedirectUri(`https://${d.hostname}/auth/callback`);

  await writeAuditEvent({
    kind: 'domain.removed',
    subjectId: operatorId,
    payload: { hostname: d.hostname, domainId },
  });
}
```

## A11y invariants

- DNS setup instructions use `<ol>` for step-by-step.
- Each record's name/type/value is a `<dl>` with copy-buttons; copy
  feedback via `role="status"` + `aria-live="polite"`.
- Status transitions announced via `aria-live="polite"` polling
  banner: "Domain verification succeeded."
- Code samples are `<code>` in preformatted blocks, not images.
- Error messages include actionable next step, not just "failed".

## Security invariants

- Verification **before** any CNAME flip — TXT check is the only
  proof of ownership.
- DNS queries via DoH to avoid platform resolver cache poisoning.
- **Single-tenant claim** — unique constraint on `(hostname)` for
  non-revoked rows.
- `ask` endpoint gate on on-demand TLS — prevents ACME abuse.
- OIDC redirect URIs strictly equal-match (not prefix) — covered by
  [oauth-provider.md](oauth-provider.md).
- Cookies: `__Host-` on platform, `__Secure-` on custom.
- No `Domain=` attribute — cookies stay host-scoped.
- Cert fingerprint watched for unexpected rotation (Let's Encrypt
  rotates on renewal; unexpected rotation = flag).
- Domain removal revokes cert + removes OIDC URI + invalidates cache.

## Testing

```ts
test('verification succeeds when TXT matches', async () => {
  const domain = await insertDomainForTest();
  mockDns(`_sentio-challenge.${domain.hostname}`, `"verify=${domain.verificationToken}"`);
  const result = await verifyDomain(domain);
  expect(result).toBe('verified');
});

test('verification fails when TXT mismatches', async () => {
  const domain = await insertDomainForTest();
  mockDns(`_sentio-challenge.${domain.hostname}`, '"verify=wrongtoken"');
  const result = await verifyDomain(domain);
  expect(result).toBe('mismatch');
});
```

## Anti-patterns

1. **CNAME-first verification** — attacker points their domain at
   you, forces ACME, claims a cert before owner notices.
2. **Rolling your own ACME client** — Let's Encrypt rate limits
   and edge cases cripple weekend projects.
3. **Using `__Host-` cookie prefix on custom domain** — fails
   silently; browser strips cookies.
4. **Cookie with `Domain=example.com`** on custom domain — exposes
   cookie to subdomains attacker might control.
5. **Per-request DB lookup for hostname→tenant** — latency + DB
   load during launch spikes. Cache.
6. **No `ask` endpoint on Caddy on-demand TLS** — ACME rate-limit
   exhaustion within hours of launch.
7. **Treating apex domain like subdomain** — ALIAS/ANAME needed;
   CNAME at apex is invalid per RFC 1034.
8. **Not revoking cert on removal** — leaves an unowned cert
   outstanding; minor but dirty.
9. **OIDC URIs updated after `active` transition** — auth breaks
   for 30-60s on new domains.
10. **Case-sensitive hostname storage** — DNS is case-insensitive;
    lowercase at the boundary.
11. **Not rate-limiting verification checks** — each hits DNS; a
    spinny "check now" button in a loop DoSes Cloudflare DoH.
12. **Allowing claim of `*.sveltesentio.app` as custom** — reserve
    platform TLD.
13. **Allowing same domain on two tenants** — split-brain; unique
    constraint mandatory.
14. **Silent cert-renewal failures** — set alerting on
    `certExpiresAt < now + 14 days AND status != active`.
15. **Accepting IDN / punycode inconsistently** — always normalize to
    ASCII (punycode) via `new URL('http://' + host).host`.
16. **TLS termination on different host than app** (e.g. TLS in
    Cloudflare, app-cert on origin mismatches) — investigate mTLS
    or consistent CF-for-SaaS.
17. **CORS allowlist not updated with domain** — third-party script
    fails.
18. **CSP `frame-ancestors` not accounting for custom domains** —
    embedded iframe workflows break.
19. **Analytics / cookie-consent banner keyed on platform domain
    only** — custom-domain tenants don't count.
20. **Missing `sameSite: 'lax'`** on custom-domain cookies —
    cross-site auth leak.
21. **Not supporting IPv6 in verification** — DoH answers for
    AAAA/A aren't queried; `CNAME` answer is; still test.
22. **Deleting the row on domain removal** — audit loses history;
    mark `revoked` instead.
23. **Renewal at 5-day margin** — Let's Encrypt recommends 30 days;
    5 days gives no retry window.
24. **Allowing tenant to add the platform's own domain** — claim
    spoof on platform.
25. **Self-signed cert fallback** — browsers refuse; users get
    invalid-cert error. Fail the TLS handshake outright instead.

## References

- ADRs: [0050](../adr/0050-tenant-theming.md),
  [0034](../adr/0034-auth-cookie-and-csrf-contract.md)
- Siblings:
  [tenant-provisioning.md](tenant-provisioning.md),
  [tenant-theming.md](tenant-theming.md),
  [cookies-authoritative.md](cookies-authoritative.md),
  [auth-oidc.md](auth-oidc.md),
  [oauth-provider.md](oauth-provider.md)
- Caddy on-demand TLS: https://caddyserver.com/docs/automatic-https#on-demand-tls
- Cloudflare for SaaS: https://developers.cloudflare.com/cloudflare-for-saas/
- Let's Encrypt rate limits: https://letsencrypt.org/docs/rate-limits/
- RFC 1034 (CNAME at apex invalidity), RFC 6555 (Happy Eyeballs)
