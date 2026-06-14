# Secrets management — runtime access + rotation + dev-vs-prod discipline

Secrets (`STRIPE_SECRET`, `CRON_SECRET`, `DB_PASSWORD`, `SAML_SP_PRIVATE_KEY`,
OAuth client secrets, JWT signing keys) are the single category of
configuration whose exposure is catastrophic and whose management
discipline separates mature operations from everything else. This
recipe codifies the contract: **runtime secrets loaded from a
secrets manager (Infisical default / Vault for self-host / Doppler
SaaS / cloud-native KMS-backed secrets)**, **dev-vs-prod strict
separation (dev never reads prod secrets; prod never reads dev)**,
**rotation schedule per-class with automated where possible**,
**fail-closed on missing secrets**, **never-in-git + never-in-logs
+ never-in-error-messages enforcement**.

Per [principles.md §2.2](../principles.md) (OWASP ASVS L2 V7 —
cryptographic secrets handling) and [principles.md §2.5](../principles.md)
(supply-chain — no secrets in client bundles), the posture is:
**`$env/static/private` is the ONLY server-side secret access
boundary**, **staging/prod secrets live in the secrets manager with
audited access**, **dev uses a shared dev-only manager or per-dev
`.env.local` never committed**, **rotate automatically OR on a
calendar OR on suspected compromise**, **pre-commit hook + CI
secret-scan blocks commits containing real secrets**.

## Related

- [backup-recovery.md](backup-recovery.md) — KMS CMKs for backup
  encryption are themselves secrets with distinct IAM role
  (`role:backup-operator`).
- [sso-saml.md](sso-saml.md) — SCIM tokens + SAML SP signing keys
  live in secrets manager.
- [payments.md](payments.md) — `STRIPE_SECRET` + `STRIPE_WEBHOOK_SECRET`
  per-environment separation prevents test→prod confusion.
- [auth-oidc.md](auth-oidc.md) — OIDC client secrets per-tenant or
  per-IdP.
- [monorepo-releases.md](monorepo-releases.md) — secret-audit job
  runs on every release; rotation events logged.
- [audit-log.md](audit-log.md) — secret access events (who read
  what, when) logged by the secrets manager, mirrored to app audit.
- [cron-jobs.md](cron-jobs.md) — scheduled rotation for keys that
  rotate (not for human-managed third-party tokens).
- [observability.md](observability.md) — `secret.scope` bounded
  label; `secret.rotation.age_days` gauge.
- [webhooks.md](webhooks.md) — webhook signing secrets (per-endpoint
  `whsec_*`) managed same as app secrets.
- [email-deliverability.md](email-deliverability.md) — DKIM private
  key, SPF-included provider tokens.
- [principles.md §2.2](../principles.md) — OWASP ASVS L2 V7.
- [principles.md §2.5](../principles.md) — supply-chain.

## Secret classes

```text
Class 1  Platform / infra       AWS keys, DB passwords, KMS CMKs
Class 2  Third-party integrations Stripe, Postmark, OpenAI, Sentry DSNs
Class 3  App-owned cryptography  JWT signing, cookie MACs, CRON_SECRET
Class 4  Per-tenant              SCIM tokens, tenant-specific webhook secrets
Class 5  Development-only        dev DB password, local-mock provider keys
```

**Four class rules:**

1. **Each class has distinct rotation policy + storage.** Class 1
   rotates quarterly via cloud IAM; Class 3 rotates yearly or on
   incident; Class 4 rotates per-tenant admin action.
2. **Class 5 never reaches prod.** Enforced by environment-scoped
   secrets managers + CI preventing `.env` upload to prod paths.
3. **Class 2 secrets have TEST and LIVE variants** — Stripe
   `sk_test_*` vs `sk_live_*`. Store separately; naming prefix
   (`STRIPE_SECRET_TEST` vs `STRIPE_SECRET_LIVE`) is less safe
   than a separate env var per env.
4. **Per-tenant secrets (Class 4) live in DB encrypted-at-rest**
   with the app-signing key from Class 3. Two-level hierarchy.

## Build-vs-buy matrix

| Option | Use when | Avoid when |
|---|---|---|
| **Infisical** (DEFAULT OSS) | Want OSS + per-env scoping + CI integration | Need Vault-level HSM |
| **HashiCorp Vault** (ESCAPE self-host) | High-assurance; on-prem; dynamic secrets | Small team; ops overhead |
| **Doppler** | SaaS; great DX; CLI-first | Budget-constrained |
| **AWS Secrets Manager / GCP Secret Manager** | Already on that cloud; KMS-backed | Multi-cloud deploy |
| **1Password Secrets Automation** | Team already on 1Password | Large-scale automation |
| **`.env` files in git (encrypted via SOPS or git-crypt)** | Solo dev / early stage | >2 engineers / prod-critical |
| **Bare `.env` in git** | NEVER | ALWAYS |

**Three provider rules:**

1. **Infisical is the default** — OSS, self-hostable, env-scoped,
   SDK + CLI + GitHub Actions integration. Good DX without vendor
   lock-in.
2. **Vault when enterprise requirements demand it** — HSM-backed,
   dynamic secrets (DB creds generated per-session), PKI.
3. **Cloud-native (AWS SM / GCP SM) when single-cloud** — IAM
   integration is seamless; no extra service to operate.

## Install

```bash
pnpm add -D infisical-node
```

Or for cloud-native (AWS example):

```bash
pnpm add @aws-sdk/client-secrets-manager
```

## Shape

```text
.env.example              TEMPLATE committed; real keys never committed
.env.local                GITIGNORED; dev overrides; per-machine
.env                      GITIGNORED; loaded by Vite / SvelteKit in dev

src/lib/config/
├── env.ts                SvelteKit $env/static/private boundary + Zod validation
└── secrets.ts            (optional) runtime rotation-aware fetcher

src/routes/api/_internal/secrets-health/+server.ts
                          internal health check (no auth on failure, but no-content)

.infisical.json           Infisical project config (committed)
.gitignore                .env* entries non-negotiable
.github/workflows/
├── secret-scan.yml       gitleaks / trufflehog on every PR
└── rotate-cron.yml       scheduled rotation workflow for Class 3
```

## Reference pattern

### 1. The `$env/static/private` boundary

SvelteKit imports secrets via two paths:

```typescript
// src/lib/config/env.ts
import { z } from 'zod';
import {
  STRIPE_SECRET,
  STRIPE_WEBHOOK_SECRET,
  CRON_SECRET,
  JWT_SIGNING_KEY,
  DATABASE_URL,
  POSTMARK_TOKEN,
  INFISICAL_TOKEN,
} from '$env/static/private';
import { PUBLIC_ORIGIN, PUBLIC_DOMAIN } from '$env/static/public';

const EnvSchema = z.object({
  STRIPE_SECRET: z.string().regex(/^sk_(test|live)_[a-zA-Z0-9]+$/),
  STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_[a-zA-Z0-9]+$/),
  CRON_SECRET: z.string().min(32),
  JWT_SIGNING_KEY: z.string().min(64),
  DATABASE_URL: z.string().url(),
  POSTMARK_TOKEN: z.string().uuid(),
  INFISICAL_TOKEN: z.string().min(1).optional(),

  PUBLIC_ORIGIN: z.string().url(),
  PUBLIC_DOMAIN: z.string(),
});

export const env = EnvSchema.parse({
  STRIPE_SECRET,
  STRIPE_WEBHOOK_SECRET,
  CRON_SECRET,
  JWT_SIGNING_KEY,
  DATABASE_URL,
  POSTMARK_TOKEN,
  INFISICAL_TOKEN,
  PUBLIC_ORIGIN,
  PUBLIC_DOMAIN,
});
```

**Eight boundary rules:**

1. **`$env/static/private` ONLY for server-side secrets.** Never
   `$env/static/public` (bundled to client), never `$env/dynamic`
   for actual secrets (bypasses Vite's DCE + exposes via runtime
   manifest).
2. **Every secret is Zod-validated.** Missing / malformed →
   fail-closed at startup, never at first-use. Typo in
   `STRIPE_SCRET` discovered on first webhook, not on deploy.
3. **Shape-matching regex** — `sk_test_*` vs `sk_live_*` are both
   valid Stripe keys; the Zod regex captures either. Rejects
   obviously-wrong values (`changeme`, `TODO`, empty).
4. **Minimum-length for random secrets** — `CRON_SECRET` < 32
   chars fails; `JWT_SIGNING_KEY` < 64. Prevents weak secrets
   from ever working.
5. **Public prefix `PUBLIC_*`** — compile-time visible in bundle;
   explicitly opted-in. Anything without the prefix is private.
6. **No `process.env` access anywhere in app code.** SvelteKit's
   `$env` is the single channel; direct `process.env` reads bypass
   Vite's tree-shaking and risk leaking to the client.
7. **Single validated `env` export** — all code imports
   `{ env }` from `$lib/config/env`; nothing re-imports raw
   `$env/static/private`.
8. **Validation runs at module top-level.** Throws at boot;
   deploys fail visibly rather than 50% of requests crashing.

### 2. `.env.example` — the template contract

```bash
# .env.example — copy to .env.local and fill in.
# NEVER commit .env.local.

# Public — compile-time bundled, visible in client bundle
PUBLIC_ORIGIN="http://localhost:5173"
PUBLIC_DOMAIN="localhost"

# Private — server-only, required
STRIPE_SECRET="sk_test_REPLACE_ME"
STRIPE_WEBHOOK_SECRET="whsec_REPLACE_ME"
CRON_SECRET="REPLACE_ME_32_PLUS_CHARS"
JWT_SIGNING_KEY="REPLACE_ME_64_PLUS_CHARS_HEX"
DATABASE_URL="postgres://sveltesentio:dev@localhost:5432/sveltesentio"
POSTMARK_TOKEN="REPLACE_ME_UUID"

# Private — optional (dev can skip)
INFISICAL_TOKEN=""
SENTRY_DSN=""
```

**Four template rules:**

1. **Every env var the app reads is listed here** — a missing
   entry in `.env.example` is a bug. New-joiner onboarding takes
   5 minutes, not a hunt through source.
2. **Placeholder values are obvious** — `REPLACE_ME` prefix.
   Pre-commit hook can scan for `REPLACE_ME` in actual `.env`
   files and warn.
3. **Comments explain grouping** — "Private — required" vs
   "Private — optional" communicates severity of missing values.
4. **Dev-safe example values for non-secrets** — `DATABASE_URL`
   with local dev DSN. New joiner starts up without external
   setup.

### 3. Per-environment secrets sources

```text
Local dev          .env.local          (per-machine, gitignored)
Shared dev         Infisical env=dev   (optional; via CLI 'infisical run')
CI                 GitHub secrets      (scoped per-workflow)
Staging            Infisical env=staging
Production         Infisical env=prod  (MFA-gated access)
```

**Seven environment rules:**

1. **Local-dev `.env.local`** is per-machine; never shared. Two
   devs on same machine share; cross-machine don't.
2. **Shared-dev Infisical env** lets the team share provider test
   keys (Stripe test mode, Postmark sandbox) without email-ing
   secrets around. Optional.
3. **CI uses GitHub Secrets** scoped per-workflow. Prod-deploy
   workflow has access to prod secrets; PR-check workflow has
   none (tests use mocks / CI-scoped test env).
4. **Staging has its own secrets** — separate Stripe test account,
   separate Postmark account. A staging leak never exposes prod
   data.
5. **Prod access is MFA-gated.** Infisical / Vault audit every
   read from prod env; unusual patterns page oncall.
6. **Secrets manager is the source of truth.** `.env` files on
   prod servers (if any) are generated at deploy-time from the
   manager, not edited in place.
7. **Rotation updates the manager; deployment picks up on next
   restart.** No "edit env var on the server" flow.

### 4. Fail-closed boot

```typescript
// src/hooks.server.ts (excerpt)
import { env } from '$lib/config/env';
import { validateSecretsHealth } from '$lib/config/health';

validateSecretsHealth(env);
```

```typescript
// src/lib/config/health.ts
import type { Env } from './env';

export function validateSecretsHealth(env: Env): void {
  const isLive = env.STRIPE_SECRET.startsWith('sk_live_');
  const isProd = env.PUBLIC_ORIGIN.includes('example.com')
    && !env.PUBLIC_ORIGIN.includes('staging');

  if (isProd && !isLive) {
    throw new Error('CONFIG MISMATCH: prod origin with non-live Stripe key');
  }
  if (!isProd && isLive) {
    throw new Error('CONFIG MISMATCH: non-prod origin with live Stripe key');
  }

  if (env.PUBLIC_ORIGIN.startsWith('http://') && isProd) {
    throw new Error('CONFIG MISMATCH: prod must use https');
  }
}
```

**Five fail-closed rules:**

1. **Cross-env contamination check.** Prod with test Stripe key =
   payments stuck in test mode; test with live key = real charges
   in testing. Detectable pattern; detect it.
2. **HTTPS-only in prod.** Reject startup if prod origin uses
   `http://`.
3. **Origin vs key consistency** — the Stripe prefix and the
   origin should agree on which environment we're in. If they
   disagree, one of them is wrong.
4. **Throw at boot, not at first request.** Visible deploy failure;
   no "works then fails 10 minutes later."
5. **Each secret-pair that must agree has its own check.** Stripe
   live/test, Postmark per-server-ID, OAuth client per-domain.
   Don't accumulate ad-hoc checks in one function; one checker
   per pair.

### 5. Runtime rotation-aware (optional, Vault / Infisical SDK)

For secrets that rotate mid-process (Vault dynamic secrets,
Infisical hot-reload), use a fetcher:

```typescript
// src/lib/config/secrets.ts
import { InfisicalClient } from 'infisical-node';

const client = new InfisicalClient({
  token: process.env.INFISICAL_TOKEN,
});

const cache = new Map<string, { value: string; fetchedAt: number }>();
const TTL_MS = 5 * 60 * 1000;

export async function getSecret(key: string): Promise<string> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.value;

  const secret = await client.getSecret({ secretName: key, environment: process.env.NODE_ENV });
  cache.set(key, { value: secret.secretValue, fetchedAt: Date.now() });
  return secret.secretValue;
}

export function invalidateSecret(key: string): void {
  cache.delete(key);
}
```

**Four runtime-rotation rules:**

1. **TTL cache** — refresh every 5 minutes. Balances rotation-
   responsiveness against fetch overhead.
2. **Webhook-triggered invalidation** — secrets manager can
   notify on rotation; `invalidateSecret(key)` flushes the
   cache so next read hits fresh.
3. **Fallback to env-var if fetch fails** — network partition
   to Infisical shouldn't down the app. Fall back to last
   known value OR boot-time env value.
4. **Never log the secret value** — log only `key` + `fetchedAt`.

### 6. Dev-mode secret scrubbing

```typescript
// src/lib/log/redact.ts
const SECRET_KEYS = new Set([
  'authorization',
  'cookie',
  'x-api-key',
  'x-webhook-signature',
  'stripe-signature',
]);

const SECRET_PATTERNS = [
  /sk_(test|live)_[a-zA-Z0-9]{20,}/g,
  /whsec_[a-zA-Z0-9]{20,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/g,
  /postgres:\/\/[^@]+@/g,
];

export function redact(input: unknown): unknown {
  if (typeof input === 'string') {
    let out = input;
    for (const p of SECRET_PATTERNS) out = out.replace(p, '[REDACTED]');
    return out;
  }
  if (Array.isArray(input)) return input.map(redact);
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return input;
}
```

**Five redaction rules:**

1. **Pattern-match known shapes** (Stripe, webhook, JWT, DB URL)
   — catches accidental leak in error messages and logs.
2. **Header-name match + redact** — `authorization`, `cookie`,
   etc. always redacted in request logs.
3. **Applied at LOG boundary, not at source.** Cheaper than
   threading redaction through every caller.
4. **False positives favor redaction.** If a pattern might be
   a secret, treat it as one.
5. **Apply to OTel span attributes too** — spans end up in
   the same backends as logs.

## Rotation schedule

```text
Class                 Typical rotation cadence        Automation level
────────────────────────────────────────────────────────────────────────
DB passwords          90 days                         automated (Vault dynamic)
Cloud IAM keys        90 days                         automated (IAM role preferred)
JWT signing key       yearly + on incident            manual via PR + cron-rotate
Cookie MAC key        yearly + on incident            manual
CRON_SECRET           yearly + on incident            manual
Stripe keys           never (rotate only on incident) manual (Stripe-triggered)
Webhook secrets       on incident / on renewal        manual (provider dashboard)
SCIM tokens (per-tenant) on admin action              manual (admin UI)
SAML SP signing key   yearly (aligns with IdP)        manual
DKIM key              yearly                          manual + DNS update
KMS CMK               yearly                          automated (AWS KMS auto-rotate)
```

**Six rotation rules:**

1. **Automated rotation where possible.** Vault dynamic DB creds;
   AWS IAM role instead of long-lived access keys; KMS
   auto-rotation.
2. **Manual rotation with PR** for app-owned crypto (JWT signing,
   cookie MAC) — audit trail + reviewer sign-off.
3. **Two-key-active window.** Issue new, deploy to verify
   workers, expire old. Zero-downtime. Single-key rotation causes
   split-brain during deploy.
4. **Document each rotation in audit log.** Key fingerprint +
   rotation timestamp + rotator identity.
5. **Alert on keys overdue for rotation** — `secret.rotation.age_days
   > policy_days` gauge with per-class thresholds.
6. **Rotate immediately on suspected compromise** — lost laptop,
   ex-employee, repo accidentally made public. Have a runbook.

## Pre-commit + CI scanning

```yaml
# .github/workflows/secret-scan.yml
name: secret-scan
on: [pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITLEAKS_LICENSE: ${{ secrets.GITLEAKS_LICENSE }}
```

```toml
# .gitleaks.toml
[allowlist]
paths = ["\\.env\\.example$", "docs/.*\\.md$"]

[[rules]]
id = "generic-api-key"
description = "Generic API key"
regex = '''(?i)(api[_-]?key|secret|token)\s*[:=]\s*["']?[a-zA-Z0-9]{32,}'''
```

**Four scanning rules:**

1. **Pre-commit hook runs gitleaks locally** — catches leaks
   before push.
2. **CI scans PR diff + full history on base-branch pushes** —
   secrets committed historically are still compromised even if
   later removed.
3. **Allowlist `.env.example` + docs** — placeholder values
   trigger false positives otherwise.
4. **Block merge on any finding.** Override requires security
   sign-off; never self-approve secret-scan bypass.

## Observability

```text
Attribute              Values
──────────────────────────────────────────────────────
secret.scope           'boot' | 'runtime' | 'rotation'
secret.manager         'infisical' | 'vault' | 'aws_sm' | 'env_file'
secret.class           1 | 2 | 3 | 4 | 5

Metrics
──────────────────────────────────────────────────────
secret.rotation.age_days       gauge, labels: key_name (bounded)
secret.fetch.count             counter, labels: manager, status
secret.fetch.duration          histogram, labels: manager
secret.validation.failure      counter, labels: reason
```

**Four observability rules:**

1. **`key_name` is a bounded enum**, not arbitrary. Known secret
   names ship as code; unknown names = misconfig.
2. **Never log secret VALUES**, only fetch-status and key-name.
3. **Rotation-age gauge per-key** — alerts trigger on overdue
   rotation.
4. **Fetch-duration histogram** — secrets-manager slowness is a
   liveness concern; a 30-second Vault timeout takes down boot.

## Testing — three lanes

```typescript
it('env schema rejects malformed Stripe key', () => {
  expect(() =>
    EnvSchema.parse({ ...validEnv, STRIPE_SECRET: 'invalid' }),
  ).toThrow(/STRIPE_SECRET/);
});

it('refuses boot on prod origin with test Stripe key', () => {
  expect(() => validateSecretsHealth({
    ...validEnv,
    PUBLIC_ORIGIN: 'https://example.com',
    STRIPE_SECRET: 'sk_test_abc',
  })).toThrow(/CONFIG MISMATCH/);
});

it('redact strips Stripe key from log', () => {
  const line = 'error: Stripe returned 401 for sk_live_abc123XYZ456DEFghi';
  expect(redact(line)).toBe('error: Stripe returned 401 for [REDACTED]');
});

it('gitleaks scan detects committed key', async () => {
  const result = await runGitleaks({ fixture: 'with-leaked-key.txt' });
  expect(result.findings).toHaveLength(1);
});
```

**Four test rules:**

1. **Env-schema parse tests** — every secret's regex validated
   against known-good + known-bad samples.
2. **Cross-env-consistency tests** — catches the "prod with test
   key" class of bugs.
3. **Redaction smoke tests** — feed realistic log lines with
   embedded secrets; assert all redacted.
4. **Gitleaks fixture test** — ensures the config catches what
   it should and ignores allowlisted paths.

## Anti-patterns

1. **`.env` committed to git.** Not even once. History persists;
   rotation is the only remediation.
2. **`process.env.SECRET` directly in component code.** Bypass
   of `$env` boundary; SvelteKit may bundle it to client.
3. **`PUBLIC_` prefix on a real secret.** Exposed in client
   bundle visible in DevTools.
4. **Secrets in error messages.** `throw new Error(\`Invalid key
   ${env.STRIPE_SECRET}\`)` gets logged, sent to Sentry, stored
   forever.
5. **Same secret across environments.** Test leak → prod
   compromised.
6. **No rotation schedule.** Keys in production for 5+ years;
   ex-employees retain access.
7. **Rotation without two-key-active window.** Deploy flips key;
   in-flight requests sign with old, verify with new → failures.
8. **Hardcoded fallback defaults.** `const key = env.CRON_SECRET
   ?? 'dev-cron-secret';` — dev fallback ships to prod.
9. **Secrets in CI logs.** `echo $STRIPE_SECRET` in a debug
   workflow → CI logs retain forever; GitHub masks only exact
   matches, not substrings.
10. **Secrets in Docker image layers.** Base image built with
    `ENV SECRET=...` — anyone pulling the image extracts it.
    Mount at runtime.
11. **Sharing prod secrets via Slack / email / chat.** No audit,
    no expiry, no revocation. Always through the manager with
    access logged.
12. **`.env.local` lost when a dev machine dies.** Secrets
    manager restores; `.env.local` is for your local-only
    overrides, not your only source.
13. **No incident runbook for compromised secret.** Rotation
    during incident is the highest-pressure time; document
    which keys, which systems, what order.
14. **Redaction only in production.** Dev logs also end up
    shared; redact everywhere.
15. **Storing per-tenant secrets unencrypted in DB.** `scim_tokens.token`
    plaintext = breach exfiltrates all tenants' IdP-level access.
    Hash (one-way) or envelope-encrypt at rest.
16. **Long-lived cloud access keys when IAM roles exist.** IAM
    role rotates automatically; access-key doesn't.
17. **`public` Infisical / Vault projects.** Anyone with URL
    reads secrets. Default to private; explicit public only for
    public non-secrets.

## References

- [ADR-0019 — structured errors](../adr/0019-structured-errors.md) —
  secret-validation failures raise typed errors at boot.
- [ADR-0023 — observability](../adr/0023-observability.md) — bounded
  `secret.scope` label.
- [ADR-0005 — env contract](../adr/0005-env-contract.md) — SvelteKit
  `$env` boundaries.
- [backup-recovery.md](backup-recovery.md) — KMS CMK for backup
  encryption with separate IAM role.
- [sso-saml.md](sso-saml.md) — SCIM + SAML secret lifecycle.
- [payments.md](payments.md) — Stripe test/live key separation.
- [observability.md](observability.md) — bounded labels.
- [Infisical docs](https://infisical.com/docs) — OSS secrets
  manager.
- [HashiCorp Vault](https://developer.hashicorp.com/vault) — self-host
  secrets + PKI.
- [gitleaks](https://github.com/gitleaks/gitleaks) — pre-commit +
  CI secret scanning.
- [trufflehog](https://github.com/trufflesecurity/trufflehog) —
  alternative scanner.
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) — canonical guidance.
- [NIST SP 800-57 — Key Management](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-57pt1r5.pdf) — rotation cadence formalism.
- [12-factor app — Config](https://12factor.net/config) — env-based
  config principle.
