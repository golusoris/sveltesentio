# api-key-management.md — composition recipe

> **Personal access tokens (PATs) + service tokens** for programmatic
> access to sveltesentio APIs. Complementary to
> [oauth-app-marketplace.md](oauth-app-marketplace.md) — OAuth is for
> **third-party** apps installed by users/tenants; this recipe is
> for **first-party** keys the user holds themselves (CI pipelines,
> CLI tools, automation). Per
> [ADR-0032](../adr/0032-auth-oauth-stack.md) OAuth is never
> reinvented; per
> [ADR-0034](../adr/0034-auth-cookie-and-csrf-contract.md) bearer
> tokens are **not** cookies and do **not** participate in CSRF.
> Per [ADR-0035](../adr/0035-rbac-authorization-model.md) a token
> can **never exceed** the scope of its owning principal.

> **The invariant: a key is a bearer secret, shown once.** The UI
> surfaces the raw token exactly one time, immediately after
> creation. The DB stores only `sha256(prefix + secret)`. There is no
> "show me the token again" affordance, ever — that's a rotation
> flow, not a reveal.

## Related

- [oauth-app-marketplace.md](oauth-app-marketplace.md) — third-party
  OAuth is the installed-app path; this recipe is the
  user-holds-the-key path
- [auth-oidc.md](auth-oidc.md) — session cookies are the browser
  path; PATs are the no-browser path
- [rbac-modeling.md](rbac-modeling.md) — token scopes are a **subset**
  of the owner's scopes; `authorize()` checks both
- [rate-limiting.md](rate-limiting.md) — per-key buckets prevent one
  leaked key from draining a tenant quota
- [audit-log.md](audit-log.md) — every create / rotate / revoke / use
  is an audit event
- [secrets-management.md](secrets-management.md) — server-side signing
  secret for HMAC-prefixed tokens lives in Infisical
- [observability.md](observability.md) — token-id + key-id join to
  traces; never the raw secret
- [webhooks-outbound.md](webhooks-outbound.md) — outbound webhook
  HMAC secrets follow the same lifecycle
- [csrf-double-submit.md](csrf-double-submit.md) — PAT requests do
  NOT need CSRF (bearer, not cookie)
- [ADR-0032](../adr/0032-auth-oauth-stack.md),
  [ADR-0034](../adr/0034-auth-cookie-and-csrf-contract.md),
  [ADR-0035](../adr/0035-rbac-authorization-model.md)

## When to use what

```text
CLI / CI / automation that acts as a user       → Personal access token (PAT)
                                                  Scoped to a subset of user's permissions
Service-to-service inside same tenant           → Service token (tenant-owned, not user-owned)
                                                  Survives user offboarding
Third-party app installed by a tenant           → OAuth via oauth-app-marketplace.md
                                                  NOT a PAT
Webhook signing (outbound)                      → HMAC secret, not a PAT
                                                  See webhooks-outbound.md
Webhook signing (inbound from provider)         → Provider-issued HMAC, not a PAT
                                                  See webhooks.md
Session in browser                              → Cookie via auth-oidc.md
                                                  NOT a PAT ever
Mobile app for end-user                         → OAuth device flow / OIDC native
                                                  NOT a PAT (user can't rotate easily)
Admin break-glass                               → Separate admin token class with 1-hour TTL
                                                  Requires MFA + step-up; audit every use
SDK quickstart ("paste this key")               → Scoped PAT via onboarding wizard
                                                  Default scopes = read-only
```

## Token anatomy — the prefix matters

```text
sk_live_01JC3R...abc123      ← shown to the user, stored hashed
│   │    │
│   │    └─ 22 URL-safe base64 chars = 132 bits of entropy (random)
│   └──── environment: `live` / `test` — visible in logs, searchable for leaks
└──────── kind: `sk` secret-key / `pk` publishable / `svc` service
```

**Why the `sk_live_` prefix is non-negotiable:**
- GitHub secret-scanning, GitLeaks, TruffleHog, AWS Secret Scanner all
  key off prefixes. A token that looks like a UUID is unscannable.
- Operators grepping logs can recognize "this is a live secret" at a
  glance.
- Revocation via scanner partnership requires a registered prefix.
- Register your prefix with GitHub's [secret scanning partner
  program](https://docs.github.com/en/developers/overview/secret-scanning-partner-program).

## Shape — bounded Zod for key records

```ts
// packages/auth/src/api-keys/types.ts
import { z } from 'zod';

export const KeyKind = z.enum(['personal', 'service']);
export type KeyKind = z.infer<typeof KeyKind>;

export const KeyEnvironment = z.enum(['live', 'test']);

export const KeyScope = z.enum([
  'read:profile', 'write:profile',
  'read:data', 'write:data',
  'read:admin',
  // `admin:*` and `write:admin` are NEVER tokenable — require session + MFA.
]);

export const ApiKey = z.object({
  id: z.string().uuid(),                                   // UUIDv7
  kind: KeyKind,
  environment: KeyEnvironment,
  // First 12 chars of the token — safe to display + index.
  // Never the full secret.
  prefix: z.string().regex(/^(sk|svc)_(live|test)_[A-Z0-9]{5}$/),
  // sha256(full token). Lookup key. Never reversible.
  secretHash: z.string().regex(/^[a-f0-9]{64}$/),
  ownerKind: z.enum(['user', 'tenant']),
  ownerId: z.string().uuid(),
  createdBy: z.string().uuid(),
  name: z.string().trim().min(1).max(80),                  // human label
  scopes: z.array(KeyScope).min(1).max(20),
  createdAt: z.string().datetime({ offset: true }),
  lastUsedAt: z.string().datetime({ offset: true }).nullable(),
  expiresAt: z.string().datetime({ offset: true }).nullable(), // nullable = never expires (discouraged)
  revokedAt: z.string().datetime({ offset: true }).nullable(),
  revokedReason: z.enum(['user_rotation', 'leaked_detected', 'owner_offboarded', 'tenant_disabled', 'admin_action']).nullable(),
  // IP allowlist (optional). CIDR list.
  ipAllowlist: z.array(z.string().regex(/^[0-9a-f.:\/]+$/i)).max(20).default([]),
});
export type ApiKey = z.infer<typeof ApiKey>;
```

Key invariants baked into the schema:
- `prefix` is a fixed shape — predictable for log-grep and scanner.
- `scopes.min(1)` — a scope-less token has no purpose; reject at the
  boundary.
- `expiresAt` nullable but **default expiry is 90 days** at the issuance
  policy layer (not in the schema — policy is separately tested).
- No `admin:*` scope exists here; admin work requires an interactive
  session with MFA.

## Reference pattern

### 1. Token generation

```ts
// packages/auth/src/api-keys/generate.ts
import { randomBytes, createHash } from 'node:crypto';

export type GeneratedKey = {
  token: string;          // shown once: sk_live_XXXXXRANDOMBASE64
  prefix: string;         // sk_live_XXXXX
  secretHash: string;     // sha256 hex
};

export function generateApiKey(
  kind: 'personal' | 'service',
  environment: 'live' | 'test',
): GeneratedKey {
  const kindTag = kind === 'personal' ? 'sk' : 'svc';
  const publicPart = randomBytes(3).toString('hex').slice(0, 5).toUpperCase();
  const secret = randomBytes(16)
    .toString('base64url')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 22);
  const prefix = `${kindTag}_${environment}_${publicPart}`;
  const token = `${prefix}${secret}`;
  const secretHash = createHash('sha256').update(token).digest('hex');
  return { token, prefix, secretHash };
}
```

The **entire token** is hashed — not just the random-secret tail. That
way a leaked prefix alone doesn't let you brute-force the secret by
pre-hashing all possible secrets for a known prefix (the prefix is
random too).

### 2. Create endpoint — the one moment the secret is shown

```ts
// src/routes/account/api-keys/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms/server';
import { zod } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import { generateApiKey } from '@sveltesentio/auth/api-keys';
import { insertApiKey } from '$lib/server/db/api-keys';
import { writeAuditEvent } from '@sveltesentio/audit';

const CreateKey = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.string()).min(1).max(20),
  expiresInDays: z.coerce.number().int().min(1).max(365).default(90),
  environment: z.enum(['live', 'test']).default('live'),
});

export const actions = {
  create: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, '/login');
    const form = await superValidate(request, zod(CreateKey));
    if (!form.valid) return fail(400, { form });

    // Enforce: user cannot grant scopes they don't hold themselves.
    const illegal = form.data.scopes.filter((s) => !locals.user!.scopes.includes(s as never));
    if (illegal.length > 0) return fail(403, { form, message: `Cannot grant scopes you do not hold: ${illegal.join(', ')}` });

    const { token, prefix, secretHash } = generateApiKey('personal', form.data.environment);
    const record = await insertApiKey({
      id: crypto.randomUUID(),
      kind: 'personal',
      environment: form.data.environment,
      prefix,
      secretHash,
      ownerKind: 'user',
      ownerId: locals.user.id,
      createdBy: locals.user.id,
      name: form.data.name,
      scopes: form.data.scopes,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      expiresAt: new Date(Date.now() + form.data.expiresInDays * 86400_000).toISOString(),
      revokedAt: null,
      revokedReason: null,
      ipAllowlist: [],
    });

    await writeAuditEvent({
      kind: 'apikey.created',
      subjectId: locals.user.id,
      payload: { keyId: record.id, prefix, scopes: record.scopes, expiresAt: record.expiresAt },
    });

    // Flash-surface: the ONLY time the raw token appears.
    return message(form, { kind: 'revealed-once', keyId: record.id, token }, { status: 201 });
  },
};
```

```svelte
<!-- excerpt — the one-time reveal UI -->
{#if $message?.kind === 'revealed-once'}
  <aside role="alert" class="key-revealed" aria-live="assertive">
    <h3>Copy this token now. It will not be shown again.</h3>
    <code class="token-display" aria-label="Personal access token">{$message.token}</code>
    <button type="button" onclick={() => navigator.clipboard.writeText($message.token)}>
      Copy to clipboard
    </button>
    <p>
      Store it in your secret manager or CI variable now. You can
      <a href="/account/api-keys/{$message.keyId}/rotate">rotate</a>
      it later if needed.
    </p>
  </aside>
{/if}
```

### 3. Bearer auth middleware (server hook)

```ts
// packages/auth/src/api-keys/handle.ts
import { createHash, timingSafeEqual } from 'node:crypto';
import { db } from '@sveltesentio/db';
import { apiKey } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export async function handleApiKey({ event, resolve }) {
  const auth = event.request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return resolve(event);

  const token = auth.slice(7);
  // Fast prefix-shape check — reject obviously malformed tokens.
  if (!/^(sk|svc)_(live|test)_[A-Z0-9]{5}[A-Za-z0-9_-]{22}$/.test(token)) {
    return new Response(null, { status: 401 });
  }

  const prefix = token.slice(0, 13);        // `sk_live_XXXXX` = 13 chars
  const candidateHash = createHash('sha256').update(token).digest('hex');

  // Lookup by prefix (indexed). Fetch hash, compare with timingSafeEqual.
  const row = await db.select().from(apiKey).where(eq(apiKey.prefix, prefix)).limit(1);
  if (row.length === 0) return new Response(null, { status: 401 });
  const k = row[0];

  const a = Buffer.from(k.secretHash, 'hex');
  const b = Buffer.from(candidateHash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response(null, { status: 401 });
  }

  if (k.revokedAt) return new Response(null, { status: 401 });
  if (k.expiresAt && new Date(k.expiresAt) < new Date()) return new Response(null, { status: 401 });

  // IP allowlist check (if set).
  if (k.ipAllowlist.length > 0) {
    const ip = event.getClientAddress();
    if (!k.ipAllowlist.some((cidr) => ipInCidr(ip, cidr))) {
      return new Response(null, { status: 403 });
    }
  }

  // Attach to event.locals — scopes are the intersection of key + owner.
  const owner = await loadOwner(k.ownerKind, k.ownerId);
  if (!owner || owner.disabled) return new Response(null, { status: 401 });
  const effectiveScopes = k.scopes.filter((s) => owner.scopes.includes(s));

  event.locals.auth = {
    kind: 'apikey',
    keyId: k.id,
    prefix: k.prefix,
    subject: { kind: k.ownerKind, id: k.ownerId },
    scopes: effectiveScopes,
  };

  // lastUsedAt update — fire-and-forget, NOT blocking, coalesced.
  queueLastUsedUpdate(k.id, new Date());

  return resolve(event);
}
```

Critical details:
- **`timingSafeEqual` on equal-length buffers** — prevents timing
  oracles on the hash comparison.
- **Effective scopes = intersection of key scopes and owner scopes.**
  If the owner loses a scope, all their keys lose it too — no lag.
- **`lastUsedAt` is coalesced**, not written on every request. Per-key
  write storm otherwise on high-QPS keys.

### 4. Key list + revoke UI

```svelte
<!-- src/routes/account/api-keys/+page.svelte -->
<h1>API keys</h1>

<table>
  <thead>
    <tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Last used</th><th>Expires</th><th></th></tr>
  </thead>
  <tbody>
    {#each data.keys as k}
      <tr class:revoked={k.revokedAt}>
        <td>{k.name}</td>
        <td><code>{k.prefix}…</code></td>
        <td>{k.scopes.join(', ')}</td>
        <td>{k.lastUsedAt ?? 'Never'}</td>
        <td>{k.expiresAt ?? '—'}</td>
        <td>
          {#if !k.revokedAt}
            <form method="POST" action="?/revoke" use:enhance>
              <input type="hidden" name="keyId" value={k.id} />
              <button class="btn-danger">Revoke</button>
            </form>
          {:else}
            <span class="muted">Revoked {k.revokedAt}</span>
          {/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>
```

### 5. Rotation (the correct "regenerate" flow)

```ts
// src/routes/account/api-keys/[id]/rotate/+server.ts
export async function POST({ params, locals }) {
  const existing = await loadKey(params.id);
  if (!existing || existing.ownerId !== locals.user.id) throw error(404);

  // Generate NEW token. Mark OLD revoked with reason=user_rotation.
  // Copy metadata (name, scopes, ipAllowlist, expiresAt) to new.
  const { token, prefix, secretHash } = generateApiKey(existing.kind, existing.environment);
  const newId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(apiKey).values({
      ...existing,
      id: newId,
      prefix,
      secretHash,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    });
    await tx.update(apiKey)
      .set({ revokedAt: new Date().toISOString(), revokedReason: 'user_rotation' })
      .where(eq(apiKey.id, existing.id));
  });

  await writeAuditEvent({
    kind: 'apikey.rotated',
    subjectId: locals.user.id,
    payload: { oldKeyId: existing.id, newKeyId: newId, prefix },
  });

  return json({ token, keyId: newId });
}
```

Rotation is **revoke-old + create-new**, never "update secret in
place". The old key is left with a `revokedReason='user_rotation'`
tombstone so audit can distinguish rotations from panic-revokes.

### 6. Secret scanner integration

```ts
// src/routes/api/internal/secret-scanner-webhook/+server.ts
// GitHub's secret-scanning partner webhook hits this endpoint when a
// token matching our registered prefix is found in a public repo.
import { verifyGithubSignature } from '$lib/server/github/secret-scanning';

export async function POST({ request }) {
  const body = await request.text();
  const sig = request.headers.get('github-public-key-signature') ?? '';
  const keyId = request.headers.get('github-public-key-identifier') ?? '';
  if (!(await verifyGithubSignature(body, sig, keyId))) throw error(401);

  const reports = JSON.parse(body) as Array<{ token: string; type: string; url: string; source: string }>;
  for (const r of reports) {
    const hash = createHash('sha256').update(r.token).digest('hex');
    await db.update(apiKey)
      .set({ revokedAt: new Date().toISOString(), revokedReason: 'leaked_detected' })
      .where(eq(apiKey.secretHash, hash));
    await writeAuditEvent({
      kind: 'apikey.leaked_auto_revoked',
      subjectId: 'system',
      payload: { tokenHashPrefix: hash.slice(0, 16), reportedSource: r.source, reportedUrl: r.url },
    });
    await notifyOwnerOfLeak(hash, r.source, r.url);
  }
  return json({ received: reports.length });
}
```

Auto-revocation on scanner hit is **mandatory**. A token in a public
GitHub repo is compromised; waiting for the user to act is reckless.

### 7. Rate-limit bucket per key

```ts
// packages/auth/src/api-keys/rate-limit.ts
import { rateLimiter } from '@sveltesentio/rate-limit';

export const keyRateLimiter = rateLimiter({
  tokenBucket: { capacity: 600, refillPerSecond: 10 },
  identify: (event) => {
    const auth = event.locals.auth;
    if (auth?.kind !== 'apikey') return null;
    return `apikey:${auth.keyId}`;
  },
});
```

Bucket-per-`keyId` so one leaked key doesn't drain the
owner's quota. Owner-level bucket is a second layer (see
[rate-limiting.md](rate-limiting.md)).

### 8. Service tokens — the tenant-owned variant

```ts
// src/routes/tenant/[tenant]/service-tokens/+page.server.ts
// Tenant admins create service tokens that survive user offboarding.
// Owner is the tenant, not the admin who creates it.
export const actions = {
  create: async ({ request, locals, params }) => {
    if (!locals.user?.permissions.includes('tenant:admin')) throw error(403);
    const form = await superValidate(request, zod(CreateServiceToken));
    if (!form.valid) return fail(400, { form });

    const { token, prefix, secretHash } = generateApiKey('service', form.data.environment);
    await insertApiKey({
      /* ... */
      kind: 'service',
      ownerKind: 'tenant',
      ownerId: params.tenant,
      createdBy: locals.user.id,     // audit: who created it
      // Scopes cannot exceed the tenant's configured service-scope allowlist.
      scopes: form.data.scopes.filter((s) => tenantServiceScopes.includes(s)),
    });
    return message(form, { kind: 'revealed-once', token });
  },
};
```

Service tokens are **revoked automatically when the tenant is
disabled** (subscription cancelled, plan downgrade to a tier without
service tokens, or suspension).

## A11y invariants

- **The one-time reveal uses `role="alert"` with `aria-live="assertive"`**
  so SR users immediately hear "Copy this token now, it will not be
  shown again."
- **The token is rendered in `<code>` with a clear `aria-label`** so
  SR users can navigate to it by role.
- **"Copy to clipboard" is a real `<button>`** with visible focus.
- **Revoked keys have `aria-label="revoked"` on the row** so SR users
  hear state without relying on the strikethrough styling.
- The token text itself is selectable — do not override `user-select:
  none`.

## Security invariants

- **Secret is hashed with SHA-256**. Argon2/bcrypt are the wrong
  primitive (too slow for per-request verification); SHA-256 is
  correct because the secret has ≥128 bits of entropy — brute-force
  is infeasible without needing KDF stretching.
- **`timingSafeEqual`** on the hash comparison is mandatory.
- **Prefix registered with GitHub secret scanner** + webhook for
  auto-revoke.
- **IP allowlist is optional**, but when set, is a deny-by-default
  additional gate.
- **No `admin:*` scope is tokenable.** Admin work requires interactive
  MFA.
- **Scopes are intersection** with owner at request time, not at
  creation time.
- **`lastUsedAt` is never precise to the second** — coalesced to
  nearest minute to reduce per-request writes.
- **Response body never echoes the raw token** in any list/detail
  endpoint. Only `POST /api-keys` returns the token, exactly once.
- **Audit events never contain the raw token.** Log the prefix and
  the hash-prefix (first 16 chars of the hex).

## Testing

```ts
// tests/auth/api-keys/generate.test.ts
import { test, expect } from 'vitest';
import { generateApiKey } from '@sveltesentio/auth/api-keys';

test('generated tokens match expected shape', () => {
  for (let i = 0; i < 1000; i++) {
    const { token, prefix, secretHash } = generateApiKey('personal', 'live');
    expect(token).toMatch(/^sk_live_[A-Z0-9]{5}[A-Za-z0-9_-]{22}$/);
    expect(prefix).toBe(token.slice(0, 13));
    expect(secretHash).toMatch(/^[a-f0-9]{64}$/);
  }
});

test('prefixes are sufficiently unique', () => {
  const prefixes = new Set<string>();
  for (let i = 0; i < 10_000; i++) prefixes.add(generateApiKey('personal', 'live').prefix);
  expect(prefixes.size).toBeGreaterThan(9990); // 24 bits of entropy in prefix
});
```

```ts
// tests/auth/api-keys/middleware.test.ts
test('leaked-token auto-revoke flow', async () => {
  const { token, secretHash } = generateApiKey('personal', 'live');
  await insertApiKey({ /* ... */ secretHash });
  await simulateGithubSecretScannerWebhook({ token, source: 'github.com/foo/bar' });
  const row = await loadBySecretHash(secretHash);
  expect(row.revokedAt).not.toBeNull();
  expect(row.revokedReason).toBe('leaked_detected');
});
```

## Anti-patterns

1. **Bcrypt/Argon2 the API key** — wasteful. SHA-256 of a
   high-entropy secret is correct.
2. **Storing the raw token** — one DB leak = full compromise.
3. **Showing the token again later** "because the user asked nicely" —
   there is no safe implementation.
4. **No prefix** — unscannable by GitHub/GitLeaks, invisible in logs.
5. **UUID-as-token** — looks like a normal id, no prefix, no
   entropy distinction.
6. **Short tokens (< 128 bits)** — brute-forceable given enough
   requests.
7. **`expiresAt` defaulting to `null`** — everlasting tokens are
   the biggest source of stale credentials. Default to 90 days.
8. **Granting scopes broader than the owner holds** — privilege
   escalation via token.
9. **Checking scopes only at creation time** — the owner might lose
   the scope later; intersection at every request.
10. **Writing `lastUsedAt` synchronously on every request** — per-key
    write amplification kills the DB.
11. **Including `admin:*` as a tokenable scope** — admin work needs
    step-up MFA, not a bearer.
12. **Sending the token in URL query strings** — gets logged, ends
    up in referrers. Header only.
13. **Rotating via `UPDATE ... SET secret=...`** — use
    revoke-old + create-new.
14. **No IP allowlist option for service tokens** — at least expose
    it; tenant admins want to pin CI IP ranges.
15. **Reusing session cookies as "API keys"** — sessions are
    browser-scoped + CSRF-coupled; bearer APIs are different contract.
16. **Treating PATs as OAuth tokens** — no refresh flow, no client id,
    no consent screen; different domain entirely.
17. **Not revoking on leak detection** — waiting for the user is
    reckless.
18. **Truncating the prefix in logs/UI** too aggressively — ≥12 chars
    is searchable, 4 chars is not.
19. **Shared service account with one hard-coded key across CI** —
    rotate per-pipeline; individual service tokens.
20. **No `createdBy` field** — service tokens need an audit chain
    when the creator offboards.
21. **Key list endpoint returns `secretHash`** — pointless leak.
    Return `id`, `name`, `prefix`, `scopes`, `createdAt`,
    `lastUsedAt`, `expiresAt`, `revokedAt`.
22. **Ignoring `revokedAt` in middleware** — revocation is instant,
    not eventual.
23. **Constant-time comparison on non-equal-length inputs** —
    `timingSafeEqual` throws if lengths differ; normalize first.
24. **Allowing CSRF token to be a PAT** — different threat models,
    different contracts.
25. **Key-per-environment collision** — `sk_live_` and `sk_test_`
    point at different DBs; a test key in production should 401, not
    succeed.

## References

- ADRs: [0032](../adr/0032-auth-oauth-stack.md),
  [0034](../adr/0034-auth-cookie-and-csrf-contract.md),
  [0035](../adr/0035-rbac-authorization-model.md)
- Siblings:
  [oauth-app-marketplace.md](oauth-app-marketplace.md),
  [auth-oidc.md](auth-oidc.md),
  [rbac-modeling.md](rbac-modeling.md),
  [rate-limiting.md](rate-limiting.md),
  [audit-log.md](audit-log.md),
  [secrets-management.md](secrets-management.md)
- GitHub: [Secret scanning partner program](https://docs.github.com/en/developers/overview/secret-scanning-partner-program)
- RFC 6750 — OAuth 2.0 Bearer Token Usage (applied without the OAuth
  ceremony for first-party PATs)
- OWASP: Cheat Sheet — Authentication / Credential Storage
