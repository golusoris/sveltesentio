# oauth-app-marketplace.md — composition recipe

> **Third-party app marketplace surface for sveltesentio:** developer-
> portal app registration, install-flow per-tenant (admin-consented
> scopes), **scoped access tokens** (JWT) with **refresh-token rotation**,
> revocation endpoints (RFC 7009), **per-app rate limits + quotas**,
> webhook subscriptions for installed apps, **app review** before
> public listing, **scope-deprecation** flow when scopes change,
> uninstall-and-purge. Per
> [ADR-0032](../adr/0032-auth-oidc-relay.md) +
> [ADR-0034](../adr/0034-auth-cookie-and-csrf-contract.md) the
> marketplace runs **on top of** [oauth-provider.md](oauth-provider.md)
> (Ory Hydra) — never reinvent the OAuth machinery, but layer the
> developer-experience + tenant-installation flow on the same
> Hydra-issued tokens.

## Related

- [oauth-provider.md](oauth-provider.md) — base layer; this recipe
  extends it with the marketplace + install-flow surface
- [auth-oidc.md](auth-oidc.md) — first-party OIDC relay; marketplace
  apps use a different `client_id` per app
- [permissions.md](permissions.md) + [rbac-modeling.md](rbac-modeling.md) —
  scope→permission mapping for installed apps
- [audit-log.md](audit-log.md) — every install, scope grant, and
  revocation lands here
- [webhooks-outbound.md](webhooks-outbound.md) — installed apps
  subscribe to outbound events
- [rate-limiting.md](rate-limiting.md) — per-app token-bucket
- [secrets-management.md](secrets-management.md) — app `client_secret`
  storage + rotation
- [account-deletion.md](account-deletion.md) — uninstall = purge tenant
  data held by the app
- [pricing-plans-changes.md](pricing-plans-changes.md) — paid apps
  go through Stripe Connect (out of scope for this recipe but linked)
- [ADR-0032](../adr/0032-auth-oidc-relay.md)
- [ADR-0034](../adr/0034-auth-cookie-and-csrf-contract.md)

## When to use what

```text
First-party app (your own UI on your own backend)        → auth-oidc.md
Be the OAuth provider for arbitrary third-party clients  → oauth-provider.md
Curated marketplace of approved third-party integrations → THIS recipe
Mobile-app-only OAuth (no marketplace UI)                → oauth-provider.md
                                                           + PKCE-public-client + custom URL scheme
SAML SSO from enterprise IdP                             → sso-saml.md
```

If you're building Slack-style "App Directory", Notion-style
"Integrations", or Stripe-style "Apps" — this recipe is the spine.

## Lifecycle (the chart that breaks teams)

```text
   Developer creates app          ← developer portal
        ↓
   App in `draft` (private)       ← installable only by developer's tenant
        ↓
   Developer submits for review   ← app moves to `pending_review`
        ↓
   Trust + Safety review          ← OAuth scopes audited; manifest checked
        ↓                          (see content-moderation.md for the queue)
   App `approved` + `listed`      ← public in marketplace
        ↓
   Tenant admin clicks Install    ← admin-consented scopes flow
        ↓
   `app_installations` row        ← tenant_id × app_id (unique)
        ↓
   App requests OAuth token       ← Ory Hydra issues w/ install-bound subject
        ↓
   App calls API w/ scoped token  ← per-app rate-limit applies
        ↓
   App publishes new version      ← new manifest_version row
        ↓                          if scopes change → re-consent required
   Tenant admin clicks Uninstall  ← tokens revoked + purge job enqueued
        ↓
   Developer deprecates app       ← `deprecated`; new installs blocked
        ↓
   Developer deletes app          ← all installs revoked + purged
```

## Install

```bash
pnpm add -F @sveltesentio/marketplace zod jose
# `jose` for JWT verification of Hydra-issued tokens; we don't sign
# tokens here (Hydra does), only verify in our resource server.
```

## Shape — bounded Zod for everything

```ts
// packages/marketplace/src/types.ts
import { z } from 'zod';

export const AppStatus = z.enum([
  'draft', 'pending_review', 'approved', 'rejected',
  'listed', 'deprecated', 'deleted',
]);

export const AppCategory = z.enum([
  'analytics', 'communication', 'crm', 'developer-tools',
  'finance', 'marketing', 'productivity', 'security', 'other',
]);

// Scope catalog — must match what permissions.md exposes.
export const Scope = z.enum([
  'read:profile', 'read:tenant',
  'read:contacts', 'write:contacts',
  'read:messages', 'write:messages',
  'read:files', 'write:files',
  'webhook:events',
  // NEVER: 'admin:*' — admin scopes are not grantable to third parties.
]);
export type Scope = z.infer<typeof Scope>;

export const AppManifest = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(3).max(80),
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
  description: z.string().min(20).max(2000),
  category: AppCategory,
  homepageUrl: z.string().url(),
  privacyUrl: z.string().url(),
  termsUrl: z.string().url(),
  iconUrl: z.string().url(), // 256×256 PNG, must be CDN-hosted
  // OAuth client config — Hydra-issued client_id stored separately.
  redirectUris: z.array(z.string().url()).min(1).max(10),
  // Allowed redirect URIs — strict-equality match per RFC 6819.
  postLogoutRedirectUris: z.array(z.string().url()).max(10).optional(),
  scopes: z.array(Scope).min(1).max(20),
  // Webhook config — only present if 'webhook:events' scope requested.
  webhook: z.object({
    url: z.string().url(),
    eventTypes: z.array(z.string().min(1).max(64)).min(1).max(50),
  }).nullable(),
  // Per-app rate-limit — defaults if absent.
  rateLimit: z.object({
    requestsPerMinute: z.number().int().min(1).max(6000).default(120),
    requestsPerDay: z.number().int().min(1).max(1_000_000).default(10_000),
  }).default({}),
});
export type AppManifest = z.infer<typeof AppManifest>;

export const App = z.object({
  id: z.string().uuid(),
  developerId: z.string().uuid(),
  status: AppStatus,
  manifest: AppManifest,
  manifestVersion: z.number().int().min(1),
  hydraClientId: z.string().min(1).max(128),
  // Visibility flags
  isPublic: z.boolean(),
  isFeatured: z.boolean(),
  // Counters denormalized from app_installations
  installCount: z.number().int().min(0),
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  deprecatedAt: z.string().datetime().nullable(),
});

export const AppInstallation = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  appId: z.string().uuid(),
  installedBy: z.string().uuid(), // user who clicked Install
  installedAt: z.string().datetime(),
  // Scopes granted at install — may be a subset of manifest scopes if
  // tenant admin opts to deny optional ones (future enhancement).
  grantedScopes: z.array(Scope).min(1).max(20),
  // Pinned manifest version — re-consent required if app's current
  // manifest_version > pinned and scopes changed.
  manifestVersionPinned: z.number().int().min(1),
  status: z.enum(['active', 'reauth_required', 'revoked']),
  revokedAt: z.string().datetime().nullable(),
});
```

## Reference patterns

### 1. Developer creates an app

```ts
// src/routes/api/marketplace/apps/+server.ts
import { json } from '@sveltejs/kit';
import { v7 as uuidv7 } from 'uuid';
import { AppManifest } from '@sveltesentio/marketplace';
import { hydraAdmin } from '$lib/server/hydra';
import { db } from '$lib/server/db';
import { recordAudit } from '$lib/server/audit';

export async function POST({ request, locals }) {
  const parsed = AppManifest.safeParse(await request.json());
  if (!parsed.success) {
    return json({ type: 'about:blank', title: 'Invalid manifest', status: 422, errors: parsed.error.issues }, { status: 422 });
  }

  const appId = uuidv7();

  // Provision an OAuth client in Hydra — confidential client w/ PKCE
  // required (per ADR-0032, even confidential clients use PKCE).
  const hydraClient = await hydraAdmin.adminCreateOAuth2Client({
    body: {
      client_name: parsed.data.name,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      redirect_uris: parsed.data.redirectUris,
      post_logout_redirect_uris: parsed.data.postLogoutRedirectUris,
      scope: parsed.data.scopes.join(' '),
      token_endpoint_auth_method: 'client_secret_post',
      // PKCE-S256 required even with client_secret — see oauth-provider.md
    },
  });

  await db.query(
    `INSERT INTO marketplace_apps
       (id, developer_id, status, manifest, manifest_version,
        hydra_client_id, hydra_client_secret_encrypted, is_public,
        is_featured, install_count, created_at)
     VALUES ($1,$2,'draft',$3,1,$4,$5,false,false,0,NOW())`,
    [appId, locals.user.id, parsed.data, hydraClient.client_id,
     await encryptSecret(hydraClient.client_secret)],
  );

  await recordAudit({
    actor: locals.user.id,
    action: 'marketplace.app.created',
    payload: { appId, name: parsed.data.name, slug: parsed.data.slug },
  });

  // Return the client_secret ONCE — developer must store it.
  return json({ appId, clientId: hydraClient.client_id, clientSecret: hydraClient.client_secret }, { status: 201 });
}
```

Critical contract:

- **`client_secret` is returned exactly once.** We store the encrypted
  version; the developer never gets it again — they must rotate.
- **PKCE required even with client_secret.** Defense in depth per
  RFC 6749 + RFC 7636 — see [oauth-provider.md](oauth-provider.md).
- **Status starts as `draft`.** Submit-for-review is a separate action.

### 2. Submit for review + Trust & Safety

```ts
export async function submitForReview(appId: string) {
  const app = await db.query(`SELECT * FROM marketplace_apps WHERE id = $1 AND developer_id = $2 AND status = 'draft'`, [appId, locals.user.id]).then(r => r.rows[0]);
  if (!app) throw new Error('app not in draft');

  // Auto-checks before queueing for human review.
  const checks = await runAutomatedChecks(app.manifest);
  if (!checks.passed) {
    await db.query(`UPDATE marketplace_apps SET status = 'rejected' WHERE id = $1`, [appId]);
    return { status: 'rejected', reasons: checks.failedReasons };
  }

  await db.query(`UPDATE marketplace_apps SET status = 'pending_review' WHERE id = $1`, [appId]);
  // Push into the moderation queue from content-moderation.md
  await moderationQueue.add({ kind: 'marketplace_app', subjectId: appId, priority: 'normal' });
  await recordAudit({ actor: locals.user.id, action: 'marketplace.app.submitted', payload: { appId } });
  return { status: 'pending_review' };
}

async function runAutomatedChecks(manifest: AppManifest) {
  const failedReasons: string[] = [];
  // Privacy URL must resolve.
  if (!(await urlResolves(manifest.privacyUrl))) failedReasons.push('privacy_url_unreachable');
  // No admin-* scopes (already enforced by Zod, but defense-in-depth).
  if (manifest.scopes.some(s => s.startsWith('admin:'))) failedReasons.push('admin_scopes_forbidden');
  // Webhook URL must be HTTPS + non-loopback.
  if (manifest.webhook && !isPublicHttps(manifest.webhook.url)) failedReasons.push('webhook_must_be_public_https');
  // Icon must be on approved CDN.
  if (!isApprovedCdn(manifest.iconUrl)) failedReasons.push('icon_must_be_on_approved_cdn');
  return { passed: failedReasons.length === 0, failedReasons };
}
```

The human reviewer sees the queue from
[content-moderation.md](content-moderation.md). Their decision flips
status to `approved` (then `listed` if `isPublic = true`) or
`rejected` with feedback.

### 3. Tenant admin installs the app

```ts
// src/routes/marketplace/apps/[slug]/install/+page.server.ts
import { redirect } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/auth';

export async function load({ params, locals, url }) {
  await requirePermission(locals.user, 'tenant.apps.install');

  const app = await db.query(
    `SELECT id, manifest, manifest_version, hydra_client_id, status
     FROM marketplace_apps WHERE manifest->>'slug' = $1 AND status IN ('approved','listed')`,
    [params.slug],
  ).then(r => r.rows[0]);
  if (!app) throw redirect(302, '/marketplace?error=not_found');

  // Show install consent screen — render the full scope list with
  // human-readable descriptions (NOT raw `read:contacts`).
  return {
    app: {
      id: app.id,
      name: app.manifest.name,
      iconUrl: app.manifest.icon_url,
      scopes: app.manifest.scopes.map(humanizeScope),
      privacyUrl: app.manifest.privacy_url,
      termsUrl: app.manifest.terms_url,
    },
    installToken: signInstallIntent({ tenantId: locals.tenant.id, appId: app.id, ttlSec: 600 }),
  };
}
```

```ts
// src/routes/marketplace/apps/[slug]/install/+page.server.ts (action)
export const actions = {
  default: async ({ request, locals, params }) => {
    const form = await request.formData();
    const installToken = form.get('installToken');
    const intent = verifyInstallIntent(installToken);
    if (!intent || intent.tenantId !== locals.tenant.id) throw error(403);

    const app = /* fetch app */;
    const installationId = uuidv7();

    await db.query(
      `INSERT INTO app_installations
         (id, tenant_id, app_id, installed_by, installed_at,
          granted_scopes, manifest_version_pinned, status)
       VALUES ($1,$2,$3,$4,NOW(),$5,$6,'active')
       ON CONFLICT (tenant_id, app_id) DO UPDATE SET
         status = 'active', granted_scopes = EXCLUDED.granted_scopes,
         manifest_version_pinned = EXCLUDED.manifest_version_pinned,
         revoked_at = NULL`,
      [installationId, locals.tenant.id, app.id, locals.user.id,
       app.manifest.scopes, app.manifest_version],
    );

    await db.query(`UPDATE marketplace_apps SET install_count = install_count + 1 WHERE id = $1`, [app.id]);

    await recordAudit({
      tenantId: locals.tenant.id, actor: locals.user.id,
      action: 'marketplace.app.installed',
      payload: { appId: app.id, scopes: app.manifest.scopes },
    });

    // Now redirect the user to the app's OAuth start endpoint —
    // the app then bounces to Hydra, gets a code, and exchanges for tokens.
    throw redirect(302, `${app.manifest.homepage_url}/oauth/start?installation_id=${installationId}`);
  },
};
```

### 4. App requests an OAuth token (delegated to Hydra)

The app follows standard OAuth 2.1 + PKCE. **We don't write this code
— Hydra does.** What we own is the **consent screen** (per
[oauth-provider.md](oauth-provider.md)) and the **token-introspection**
hook that maps the issued token → installation row:

```ts
// src/routes/api/oauth/introspect/+server.ts
// Called by our resource server (not by the app) to check whether a
// presented token is still valid + grants the requested scope.
import { hydraAdmin } from '$lib/server/hydra';

export async function POST({ request }) {
  const body = await request.formData();
  const token = body.get('token');

  const intro = await hydraAdmin.adminIntrospectOAuth2Token({
    body: new URLSearchParams({ token: String(token) }) as never,
  });

  if (!intro.active) return json({ active: false });

  // Hydra's `sub` is our app installation id (we set it during consent).
  const installation = await db.query(
    `SELECT * FROM app_installations WHERE id = $1 AND status = 'active'`,
    [intro.sub],
  ).then(r => r.rows[0]);

  if (!installation) return json({ active: false });

  return json({
    active: true,
    scope: intro.scope,
    sub: installation.id,
    tenant_id: installation.tenant_id,
    app_id: installation.app_id,
    exp: intro.exp,
  });
}
```

### 5. Per-app rate-limit middleware

```ts
// src/lib/server/marketplace/rate-limit.ts
import { rateLimiter } from '$lib/server/rate-limiter';

export async function enforceAppRateLimit(installationId: string) {
  const inst = await getInstallation(installationId);
  const app = await getApp(inst.appId);
  const { requestsPerMinute, requestsPerDay } = app.manifest.rateLimit;

  const minute = await rateLimiter.consume(`app:${app.id}:tenant:${inst.tenantId}:m`, 1, { capacity: requestsPerMinute, refillPerSec: requestsPerMinute / 60 });
  const day = await rateLimiter.consume(`app:${app.id}:tenant:${inst.tenantId}:d`, 1, { capacity: requestsPerDay, refillPerSec: requestsPerDay / 86400 });

  if (!minute.allowed || !day.allowed) {
    throw new RfcProblem(429, 'Too many requests', {
      retryAfter: Math.max(minute.retryAfterSec, day.retryAfterSec),
    });
  }
}
```

Per [rate-limiting.md](rate-limiting.md): `RateLimit-*` headers per
RFC 9530, `Retry-After` per RFC 7231.

### 6. Webhook subscriptions for installed apps

```ts
// src/lib/server/marketplace/webhook-fanout.ts
import { signHmac } from '$lib/server/webhooks';

export async function emitMarketplaceEvent(eventType: string, payload: unknown, tenantId: string) {
  const installations = await db.query(
    `SELECT i.id, a.manifest->'webhook' AS webhook
     FROM app_installations i
     JOIN marketplace_apps a ON a.id = i.app_id
     WHERE i.tenant_id = $1 AND i.status = 'active'
       AND a.manifest->'webhook'->>'url' IS NOT NULL
       AND a.manifest->'webhook'->'eventTypes' ? $2`,
    [tenantId, eventType],
  ).then(r => r.rows);

  for (const inst of installations) {
    await webhookQueue.add('deliver', {
      url: inst.webhook.url,
      eventType,
      payload,
      installationId: inst.id,
    }, { jobId: `${inst.id}:${eventType}:${uuidv7()}` });
  }
}
```

Delivery follows [webhooks-outbound.md](webhooks-outbound.md): HMAC
signing + retry-with-backoff + SSRF defense + per-installation
suppression on repeated 4xx.

### 7. Scope-deprecation: re-consent flow

When a developer publishes a new `manifest_version` with **added** or
**broadened** scopes:

```ts
export async function publishNewManifest(appId: string, newManifest: AppManifest) {
  const current = await getApp(appId);
  const oldScopes = new Set(current.manifest.scopes);
  const newScopes = new Set(newManifest.scopes);

  const scopesAdded = [...newScopes].filter(s => !oldScopes.has(s));
  const requiresReConsent = scopesAdded.length > 0;

  await db.query(
    `UPDATE marketplace_apps SET manifest = $1, manifest_version = manifest_version + 1 WHERE id = $2`,
    [newManifest, appId],
  );

  if (requiresReConsent) {
    // Mark all installs as reauth_required. Their tokens still work
    // until they hit a scope check; admin sees a banner + click-to-reauth.
    await db.query(
      `UPDATE app_installations SET status = 'reauth_required'
       WHERE app_id = $1 AND status = 'active'`,
      [appId],
    );
    await emitTenantNotification('marketplace.app.reauth_required', { appId });
  }
}
```

Scope **removal** does not require re-consent — narrower is always
backwards-compatible.

### 8. Uninstall + purge

```ts
export async function uninstallApp(installationId: string, actor: string) {
  const inst = await getInstallation(installationId);

  // 1. Revoke active tokens via Hydra RFC 7009.
  await hydraAdmin.revokeOAuth2LoginSessions({ subject: installationId });
  await hydraAdmin.revokeOAuth2ConsentSessions({ subject: installationId });

  // 2. Mark installation revoked.
  await db.query(
    `UPDATE app_installations SET status = 'revoked', revoked_at = NOW() WHERE id = $1`,
    [installationId],
  );
  await db.query(`UPDATE marketplace_apps SET install_count = GREATEST(0, install_count - 1) WHERE id = $1`, [inst.appId]);

  // 3. Notify the app — they MUST purge tenant data per their TOS.
  await webhookQueue.add('deliver', {
    url: inst.webhook?.url,
    eventType: 'app.uninstalled',
    payload: { installationId, tenantId: inst.tenantId, deadline: addDays(30) },
  });

  // 4. Audit.
  await recordAudit({
    tenantId: inst.tenantId, actor,
    action: 'marketplace.app.uninstalled',
    payload: { installationId, appId: inst.appId },
  });
}
```

The 30-day purge deadline mirrors GDPR Art.17 erasure — see
[account-deletion.md](account-deletion.md). After 30 days, a
follow-up audit checks the app declared compliance via a status
endpoint.

## Marketplace listing UI invariants

- **Always show**: app name, icon, developer name (verified badge if
  applicable), category, install count, average rating, "Last
  updated" date.
- **Required scope list before install** with human descriptions.
  "Read your contacts" not `read:contacts`.
- **Privacy + Terms URLs** linked, not buried.
- **"Report this app"** affordance per DSA Art.16. Reports flow to
  [content-moderation.md](content-moderation.md).
- **Reauth banner** on installations with `status = 'reauth_required'`
  with one-click resolution.
- **Uninstall** is a single click on the installation row (with a
  confirm — uninstalling is reversible only by re-installing, but
  data may be purged).

## Anti-patterns

- **Reinventing OAuth in the marketplace endpoint.** Always delegate
  to Hydra (or your chosen OAuth provider). Marketplace is a layer
  ON TOP of OAuth, not a replacement.
- **Granting `admin:*` scopes to third-party apps.** Admin scopes
  should be unreachable from the marketplace. Enforce in Zod + the
  scope-allowlist + the consent UI.
- **Silent re-consent on scope expansion.** Every new scope requires
  a fresh admin click. Auto-granting is a security incident.
- **Trusting the `redirect_uri` to be substring-matched.** Strict
  equality only — `https://app.example.com/cb` ≠
  `https://app.example.com/cb?stuff` per RFC 6819 §5.2.3.5.
- **Returning `client_secret` more than once.** First-class lost-secret
  vector. Force rotation; never re-display.
- **No PKCE on confidential clients.** PKCE is required for *all*
  clients per OAuth 2.1, even with `client_secret`. Defense in depth.
- **Storing `client_secret` plaintext in DB.** Encrypt at rest with
  envelope encryption (KMS DEK + tenant CMK). Treat like a password.
- **Per-app rate-limit shared with first-party traffic.** Bucket per
  `app_id × tenant_id`; don't let one buggy app DoS the tenant's
  first-party usage.
- **No per-installation token introspection cache.** Hitting Hydra on
  every API call adds 30ms × QPS. Cache introspection result for
  ≤30s with active=true.
- **Trusting the app's webhook URL without revalidating.** Re-resolve
  DNS on each delivery (SSRF defense per
  [webhooks-outbound.md](webhooks-outbound.md)) — manifest URL can be
  swapped on the developer's DNS.
- **Allowing arbitrary HTTP webhook URLs.** HTTPS-only, public,
  non-loopback. Reject `http://`, `localhost`, `169.254.*`, `10.*`,
  `192.168.*`.
- **No `app_installations.unique(tenant_id, app_id)` constraint.**
  Multiple installs per tenant create token-pollution + double
  webhook delivery.
- **Letting deleted apps keep webhook subscriptions alive.** Cascade
  delete `app_installations` when `marketplace_apps.status = 'deleted'`,
  revoke all tokens.
- **Marketplace listing without "report" affordance.** DSA Art.16
  violation in EU. Add it.
- **No human review before public listing.** Allows phishing apps in
  the directory. Trust & Safety review is non-negotiable.
- **Auto-rejecting submissions for trivial reasons without feedback.**
  Tell the developer *which* check failed. They cannot fix what they
  cannot see.
- **Pinning `manifest_version` only on install but never re-checking
  on token use.** Stale installs against deprecated manifests.
  Re-check at introspection cache miss.
- **Counting installs in a hot loop.** Use a denormalized counter
  with an event sourcing on insert/uninstall; don't `COUNT(*)` on
  every listing render.
- **Leaking developer revenue/ratings via the public app endpoint.**
  Public-facing fields are a strict subset of internal fields.
- **No deprecation pathway.** "How do I sunset an app I built?"
  must have a one-click answer with notification to all installs.
- **Not pushing the `app.uninstalled` event to the developer's
  webhook.** They cannot purge user data they don't know to purge.
- **Treating "approved" as the same as "listed".** Approved means
  installable by direct link; listed means in the public directory.
  Keep them separate so developers can soft-launch.
- **Rate-limit headers missing on third-party API calls.** The
  developer cannot back off. Always emit `RateLimit-*` per
  [rate-limiting.md](rate-limiting.md).
- **Unbounded `eventTypes` array in webhook subscription.** Cap (≤50);
  otherwise an app subscribes to 10k events and the fanout queue
  collapses.
- **Not auditing every install / uninstall / scope-grant.** Auditors
  + customers expect a paper trail. See [audit-log.md](audit-log.md).
- **Allowing third-party app branding to mimic first-party UI.** Apps
  must show the developer name + a "Third-party app" badge in any
  embedded surface (iframe, OAuth consent screen).

## References

- ADRs: [0032](../adr/0032-auth-oidc-relay.md),
  [0034](../adr/0034-auth-cookie-and-csrf-contract.md),
  [0035](../adr/0035-permissions-and-rbac.md),
  [0036](../adr/0036-mfa-structured-errors.md)
- Sibling recipes: [oauth-provider.md](oauth-provider.md),
  [auth-oidc.md](auth-oidc.md),
  [permissions.md](permissions.md),
  [rbac-modeling.md](rbac-modeling.md),
  [audit-log.md](audit-log.md),
  [webhooks-outbound.md](webhooks-outbound.md),
  [rate-limiting.md](rate-limiting.md),
  [secrets-management.md](secrets-management.md),
  [content-moderation.md](content-moderation.md),
  [account-deletion.md](account-deletion.md),
  [pricing-plans-changes.md](pricing-plans-changes.md)
- External: OAuth 2.1 draft (`draft-ietf-oauth-v2-1`); RFC 7636 PKCE;
  RFC 7009 Token Revocation; RFC 6819 OAuth Threat Model §5.2.3;
  Ory Hydra docs (admin API for client management); EU Digital
  Services Act Art.16 (notice & takedown); Slack App Directory
  developer docs; Stripe Connect platform docs (paid-app patterns);
  Notion + Atlassian Marketplace developer guidelines
