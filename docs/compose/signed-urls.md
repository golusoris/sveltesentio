# signed-urls.md — composition recipe

> **Signed-URL contract for sveltesentio:** one builder, three stores
> (S3 / Cloudflare R2 / Google Cloud Storage), uniform **expiry
> policy**, **method binding** (PUT-vs-GET URLs aren't fungible),
> **content-type + size constraints** baked into the signature,
> **optional IP binding** (hardening for financial docs),
> **revocation via rotating access keys**, **audit trail for every
> URL issued**, **CDN fronting** for public-immutable content. Per
> [ADR-0041](../adr/0041-uploads-tus-s3.md) +
> [ADR-0034](../adr/0034-auth-cookie-and-csrf-contract.md) the
> server is the only code that signs; clients never hold credentials.

This recipe is the **common substrate** under
[uploads.md](uploads.md) (tus direct-to-S3), [video-streaming.md](video-streaming.md)
(signed CDN cookies for segments), [gdpr-data-export.md](gdpr-data-export.md)
(72h download URLs), [pdf-generation.md](pdf-generation.md) (1h
rendered-PDF URLs). Each of those uses the same builder; this recipe
documents the builder + its invariants.

## Related

- [uploads.md](uploads.md) — upload direction (PUT)
- [uploads-uppy.md](uploads-uppy.md) — same as above with UI
- [video-streaming.md](video-streaming.md) — signed CDN cookies
  (different but sibling mechanism)
- [gdpr-data-export.md](gdpr-data-export.md) — 72h downloads
- [pdf-generation.md](pdf-generation.md) — 1h PDF downloads
- [backup-recovery.md](backup-recovery.md) — signed URLs for
  cross-region PITR snapshots
- [secrets-management.md](secrets-management.md) — access key
  rotation is how we revoke
- [rate-limiting.md](rate-limiting.md) — URL-issuance endpoints are
  rate-limited per user
- [audit-log.md](audit-log.md) — URL issuance + access are audit
  events
- [observability.md](observability.md) — signed URL hit rate +
  expiry-miss rate are SLO signals
- [caching.md](caching.md) — `Cache-Control` rules for signed vs
  public content
- [ADR-0041](../adr/0041-uploads-tus-s3.md)
- [ADR-0034](../adr/0034-auth-cookie-and-csrf-contract.md)

## When to use what

```text
Public immutable asset (CSS/JS/image build output)   → plain CDN URL (NO signing)
                                                       Cache-Control: immutable
Public mutable asset (user avatar)                   → signed GET URL,
                                                       short TTL (15 min),
                                                       CDN with private Vary: Cookie
Private download (invoice, export bundle)            → signed GET URL,
                                                       bound to {sub, exp, method, path}
                                                       TTL 1h (invoice) / 72h (export)
Direct upload (tus PUT or S3 multipart)              → signed PUT URL,
                                                       TTL 15 min,
                                                       constrained size + content-type
Tenant-scoped read of many objects                   → signed cookies (CloudFront / Signed URL Prefix)
                                                       scoped to path prefix; 1h TTL
Compliance PDF that must never cache                 → signed GET URL + response-
                                                       override-cache-control: no-store
Static S3 website (small app, no CDN)                → don't; always front with CDN
Temporary webhook callback URL for third-party       → signed URL w/ one-time nonce;
                                                       revoke on first use
```

## TTL policy (one table, one source of truth)

```text
Upload PUT                 → 15 min
Upload MultipartInit       → 1 hour
Upload MultipartPart PUT   → 15 min (per part)
Download GET (generic)     → 1 hour
Download GET (PDF invoice) → 1 hour
Download GET (GDPR export) → 72 hours  ← Art.12 §3 SLA-driven
Download GET (public avatar)→ 15 min    ← short enough to rotate cheaply
Signed-cookie (video seg)  → 1 hour     ← see video-streaming.md
Signed-cookie (admin UI)   → 30 min     ← sensitive data
One-time webhook callback  → 15 min + one-use nonce
```

Anything > 72h requires a written exception (ADR amendment). Long-
lived signed URLs are a leak primitive.

## Install

```bash
# S3 / R2 (R2 is S3-compatible; same SDK, different endpoint)
pnpm add -F @sveltesentio/storage @aws-sdk/client-s3 @aws-sdk/s3-request-presigner zod

# Google Cloud Storage (uses its own SDK for V4 signing)
# pnpm add -F @sveltesentio/storage @google-cloud/storage
```

## Shape — bounded Zod

```ts
// packages/storage/src/types.ts
import { z } from 'zod';

export const StoreKind = z.enum(['s3', 'r2', 'gcs']);

export const Method = z.enum(['GET', 'PUT', 'DELETE']);

export const SignRequest = z.object({
  kind: StoreKind,
  bucket: z.string().min(3).max(63).regex(/^[a-z0-9.-]+$/),
  key: z.string().min(1).max(1024),
  method: Method,
  // TTL in seconds, clamped per store (S3 allows <=7d, we clamp to <=72h).
  expiresSec: z.number().int().min(60).max(72 * 3600),
  // Content-type must be pinned for PUT — prevents type-laundering.
  contentType: z.string().min(3).max(256).optional(),
  // Size constraint for PUT — prevents gigabyte surprise uploads.
  maxSizeBytes: z.number().int().positive().max(50 * 1024 * 1024 * 1024).optional(),
  // For GET: response-* overrides (S3 specific).
  responseCacheControl: z.string().max(128).optional(),
  responseContentDisposition: z.string().max(256).optional(),
  // Optional IP binding (S3 only; CloudFront signed URLs support it natively).
  sourceIpCidr: z.string().regex(/^[\d.]+\/\d{1,2}$|^[0-9a-f:]+\/\d{1,3}$/i).optional(),
  // Caller-supplied audit id.
  requestedBy: z.string().uuid(),
});
export type SignRequest = z.infer<typeof SignRequest>;

export const SignedUrl = z.object({
  url: z.string().url(),
  method: Method,
  expiresAt: z.string().datetime(),
  key: z.string(),
  bucket: z.string(),
  // SHA-256 of URL + expiry — used in audit events to prove issuance
  // without storing the whole URL (which contains a secret signature).
  urlFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
```

## Reference patterns

### 1. The builder (S3 / R2 shared)

```ts
// packages/storage/src/sign.ts
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ObjectCannedACL } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SignRequest, SignedUrl } from './types';
import { recordAudit } from '$lib/server/audit';
import { sha256 } from '$lib/server/crypto';

const clients = new Map<string, S3Client>();

function clientFor(kind: 's3' | 'r2'): S3Client {
  const key = kind;
  const existing = clients.get(key);
  if (existing) return existing;
  const c = new S3Client({
    region: process.env[`${key.toUpperCase()}_REGION`] ?? 'auto',
    endpoint: process.env[`${key.toUpperCase()}_ENDPOINT`], // R2 requires explicit
    forcePathStyle: kind === 'r2',
    credentials: {
      accessKeyId:     process.env[`${key.toUpperCase()}_ACCESS_KEY_ID`]!,
      secretAccessKey: process.env[`${key.toUpperCase()}_SECRET_ACCESS_KEY`]!,
    },
  });
  clients.set(key, c);
  return c;
}

export async function signUrl(input: unknown): Promise<ReturnType<typeof SignedUrl.parse>> {
  const req = SignRequest.parse(input);
  if (req.kind === 'gcs') return signGcsUrl(req); // separate path

  const client = clientFor(req.kind);
  let command;
  switch (req.method) {
    case 'GET':
      command = new GetObjectCommand({
        Bucket: req.bucket,
        Key: req.key,
        ResponseCacheControl: req.responseCacheControl,
        ResponseContentDisposition: req.responseContentDisposition,
      });
      break;
    case 'PUT':
      command = new PutObjectCommand({
        Bucket: req.bucket,
        Key: req.key,
        ContentType: req.contentType,
        // ContentLength enforcement happens via Condition in POST-policy
        // form; PUT signed URLs don't enforce size, so attach a
        // size-limiting gateway (nginx client_max_body_size) in front.
        ServerSideEncryption: 'AES256',
      });
      break;
    case 'DELETE':
      command = new DeleteObjectCommand({ Bucket: req.bucket, Key: req.key });
      break;
  }

  const url = await getSignedUrl(client, command, { expiresIn: req.expiresSec });
  const expiresAt = new Date(Date.now() + req.expiresSec * 1000).toISOString();
  const fingerprint = await sha256(`${url}|${expiresAt}`);

  await recordAudit({
    actor: req.requestedBy,
    action: 'storage.signed_url.issued',
    payload: {
      kind: req.kind, bucket: req.bucket, key: req.key,
      method: req.method, expiresAt, urlFingerprint: fingerprint,
      hasIpBinding: Boolean(req.sourceIpCidr),
    },
  });

  return SignedUrl.parse({
    url, method: req.method, expiresAt, key: req.key, bucket: req.bucket,
    urlFingerprint: fingerprint,
  });
}
```

Contract notes:

- **One builder** — callers supply `{ kind, bucket, key, method }`,
  builder picks the right client.
- **Audit is mandatory.** Every URL issued has a fingerprint in the
  audit log. The URL itself is never logged (secret).
- **`ServerSideEncryption: AES256`** on PUTs — AWS won't accept the
  upload otherwise if the bucket policy requires SSE.

### 2. GCS V4 signing

```ts
// packages/storage/src/sign-gcs.ts
import { Storage } from '@google-cloud/storage';
import { SignRequest } from './types';

const gcs = new Storage({ keyFilename: process.env.GCS_KEY_PATH });

export async function signGcsUrl(req: SignRequest) {
  const [url] = await gcs.bucket(req.bucket).file(req.key).getSignedUrl({
    version: 'v4',
    action: req.method === 'GET' ? 'read' : req.method === 'PUT' ? 'write' : 'delete',
    expires: Date.now() + req.expiresSec * 1000,
    contentType: req.contentType,
    responseDisposition: req.responseContentDisposition,
    // GCS doesn't support IP binding in signed URLs; compensate with
    // VPC Service Controls or Access Context Manager if needed.
  });
  return url;
}
```

### 3. Issuance endpoint (with authz)

```ts
// src/routes/api/storage/sign/+server.ts
import { json, error } from '@sveltejs/kit';
import { SignRequest, signUrl } from '@sveltesentio/storage';
import { requirePermission } from '$lib/server/auth';
import { rateLimiter } from '$lib/server/rate-limiter';

export async function POST({ request, locals, getClientAddress }) {
  const parsed = SignRequest.safeParse({ ...await request.json(), requestedBy: locals.user?.id });
  if (!parsed.success) throw error(422, JSON.stringify(parsed.error.issues));

  // Scope authz — resolve the object's owning tenant + permission-gate.
  const obj = await db.query(
    `SELECT tenant_id, owner_id, visibility FROM storage_objects WHERE bucket = $1 AND key = $2`,
    [parsed.data.bucket, parsed.data.key],
  ).then(r => r.rows[0]);

  if (!obj) throw error(404);
  if (obj.tenant_id !== locals.tenant.id) throw error(403);
  if (parsed.data.method === 'GET') await requirePermission(locals.user, `storage.read:${obj.visibility}`);
  else                               await requirePermission(locals.user, 'storage.write');

  // Per-user rate-limit — stops enumeration + URL-harvest attacks.
  const check = await rateLimiter.consume(`sign:${locals.user.id}`, 1, { capacity: 120, refillPerSec: 2 });
  if (!check.allowed) return json({ type: 'about:blank', title: 'rate limited', status: 429 }, { status: 429, headers: { 'Retry-After': String(check.retryAfterSec) } });

  // Optional: bind to request IP for high-sensitivity objects.
  if (obj.visibility === 'confidential') {
    parsed.data.sourceIpCidr = `${getClientAddress()}/32`;
  }

  const signed = await signUrl(parsed.data);
  return json(signed);
}
```

Critical path:

- **Authz resolves the owning tenant** of the object, **not** the
  caller's tenant from the token alone. Prevents tenant-boundary
  leaks if key enumeration works.
- **404 on missing object** — never return 403 (leaks existence).
- **Rate-limit per-user** is aggressive (120/min) — signing is cheap
  but enumeration is easy.
- **IP binding** for confidential visibility — makes URL-steal-and-
  share impossible.

### 4. Upload direction (PUT) — with content-type pinning

```ts
// src/routes/api/uploads/initiate/+server.ts
import { signUrl } from '@sveltesentio/storage';

const ALLOWED_UPLOAD_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/avif',
  'application/pdf',
]);

export async function POST({ request, locals }) {
  const { filename, contentType, sizeBytes } = await request.json();
  if (!ALLOWED_UPLOAD_TYPES.has(contentType)) throw error(422, 'disallowed content type');
  if (sizeBytes > 50 * 1024 * 1024) throw error(422, 'too large');

  const key = `uploads/${locals.tenant.id}/${crypto.randomUUID()}`;
  const signed = await signUrl({
    kind: 's3', bucket: 'user-uploads', key,
    method: 'PUT', expiresSec: 15 * 60,
    contentType,          // BAKED INTO the signature — client can't change
    requestedBy: locals.user.id,
  });

  // Record the pending object BEFORE returning the URL — so if the
  // upload completes out-of-band, we know what it was for.
  await db.query(
    `INSERT INTO storage_objects (id, tenant_id, bucket, key, content_type, size_bytes, status, owner_id)
     VALUES ($1, $2, 'user-uploads', $3, $4, $5, 'pending', $6)`,
    [crypto.randomUUID(), locals.tenant.id, key, contentType, sizeBytes, locals.user.id],
  );

  return json({ uploadUrl: signed.url, key, expiresAt: signed.expiresAt });
}
```

When the client uploads, it **must** send `Content-Type: image/png`
(matching what was signed). Mismatched content-type = signature
invalid = 403. This is the mechanism that stops type laundering.

### 5. Completion webhook / finalization

Uploads finish out-of-band; confirm before exposing the object:

```ts
// src/routes/api/uploads/finalize/+server.ts
export async function POST({ request, locals }) {
  const { key } = await request.json();
  const obj = await db.query(`SELECT * FROM storage_objects WHERE key = $1 AND owner_id = $2 AND status = 'pending'`, [key, locals.user.id]).then(r => r.rows[0]);
  if (!obj) throw error(404);

  // HEAD the object — only exists if upload completed.
  const head = await s3.send(new HeadObjectCommand({ Bucket: obj.bucket, Key: key }));
  if (!head.ContentLength || head.ContentLength > 50 * 1024 * 1024) {
    await s3.send(new DeleteObjectCommand({ Bucket: obj.bucket, Key: key }));
    throw error(422, 'upload verification failed');
  }

  // Confirm + kick off downstream (virus scan, thumbnail).
  await db.query(
    `UPDATE storage_objects SET status = 'uploaded', size_bytes = $1, uploaded_at = NOW() WHERE id = $2`,
    [head.ContentLength, obj.id],
  );
  await postProcessQueue.add('virus-scan', { objectId: obj.id });
  return json({ ok: true });
}
```

### 6. Revocation — via key rotation

Signed URLs cannot be individually revoked; the fastest revocation
channel is **rotate the access key** used to sign. Rotation policy:

```text
Normal rotation cadence                              → every 90 days
Emergency rotation (suspected leak)                  → immediate
Detection window after rotation                      → 24h overlap (old key
                                                       still valid for reads,
                                                       new key for writes)
```

Rotate via [secrets-management.md](secrets-management.md):

```bash
# 1. Issue new key
aws iam create-access-key --user-name sveltesentio-signer
# 2. Push into Infisical, fan-out to all signer pods
infisical secrets set S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
# 3. Wait 5 min — all pods reloaded
# 4. Disable old key (still valid for existing signed URLs until they expire)
aws iam update-access-key --status Inactive --access-key-id OLD
# 5. After 72h (longest TTL) delete old key
aws iam delete-access-key --access-key-id OLD
```

Bucket policy **must** require signed requests for the signer user
only (not for viewer / processor roles).

### 7. Download flow for end users

```svelte
<!-- src/lib/components/DownloadButton.svelte -->
<script lang="ts">
  let { objectKey, filename }: { objectKey: string; filename: string } = $props();
  let loading = $state(false);

  async function onClick() {
    loading = true;
    try {
      const res = await fetch('/api/storage/sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': readCookie('__Host-csrf') ?? '' },
        body: JSON.stringify({ kind: 's3', bucket: 'user-uploads', key: objectKey, method: 'GET', expiresSec: 600 }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const { url } = await res.json();
      // Trigger the download via a transient anchor — the URL is single-use
      // in spirit; discard it from memory after click.
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      loading = false;
    }
  }
</script>

<button type="button" onclick={onClick} disabled={loading} aria-busy={loading}>
  {loading ? 'Preparing…' : `Download ${filename}`}
</button>
```

Never put the signed URL on the page statically — server-side renders
would leak it to caches, logs, Sentry replays.

### 8. Signed cookies (cross-object prefix access)

For video segments / large export bundles, issue signed cookies scoped
to a path prefix:

```ts
// CloudFront signed cookie (AWS SDK v3)
import { getSignedCookies } from '@aws-sdk/cloudfront-signer';

const cookies = getSignedCookies({
  url: `https://cdn.example.com/tenants/${tenantId}/streams/*`,
  keyPairId: process.env.CF_KEY_PAIR_ID!,
  privateKey: fs.readFileSync('cf-private.pem', 'utf8'),
  dateLessThan: new Date(Date.now() + 3600 * 1000).toISOString(),
  ipAddress: `${clientIp}/32`, // optional
});

// Return via Set-Cookie: scoped to CDN origin only
for (const [name, value] of Object.entries(cookies)) {
  event.cookies.set(name, value, { domain: '.cdn.example.com', path: '/', httpOnly: true, secure: true, sameSite: 'none' });
}
```

See [video-streaming.md](video-streaming.md) for the full pattern;
this is the same mechanism as a signed URL but amortized across many
object fetches.

## Anti-patterns

- **Trusting the client to supply the bucket.** Client says
  `{ bucket: 'user-uploads' }`; the server should pick the bucket
  based on the operation, not accept it as input.
- **Expiry > 72h on any URL.** Everything longer requires an ADR
  amendment. See the TTL table.
- **Signing URLs for arbitrary keys the user doesn't own.** Resolve
  the object's tenant in the signing endpoint; enforce authz there.
- **Content-type not baked into PUT signatures.** Attacker uploads
  `image/png` with an `.exe` payload; your downstream processor
  thinks it's an image. Pin content-type in the signature.
- **Logging the signed URL in request logs.** Signature is a secret.
  Log the fingerprint (`sha256(url + exp)`) instead.
- **Storing signed URLs in Sentry / session replay.** Both will
  scrub `?signature=` on a naive config; verify your scrubbing
  rules actually match.
- **Putting signed URLs on server-rendered HTML.** Caches + logs
  pick them up. Generate on click.
- **Long-lived signed URLs for logged-out sharing.** If the link
  should survive the session, use a separate "share link" feature
  with its own revocation table, not a raw signed URL.
- **Not rate-limiting the sign endpoint.** Enumeration vector; an
  attacker iterates keys looking for valid ones.
- **Returning 403 on missing object.** Leaks existence. Return 404.
- **Using `__Host-`-prefixed cookies for CDN-domain signed cookies.**
  `__Host-` forbids `Domain`; CDN signed cookies need a shared
  domain. Use `__Secure-` instead.
- **Shared access key across signer + viewer + worker.** One leak
  compromises everything; rotation touches all paths. Separate IAM
  roles per purpose.
- **No audit on URL issuance.** Security events vanish. Always audit
  with fingerprint.
- **No audit on URL access.** Log access at the CDN / object layer
  too; correlate with issuance via bucket access logs.
- **Relying on S3 bucket-policy `Condition: Deny unless signed` for
  security** without verifying the policy. One typo → world-readable
  bucket.
- **Using `s3:GetObject` on the signer role.** Signer should only
  have `s3:PutObject` / `s3:GetObject` scoped via `aws:ResourceTag`
  conditions to the bucket prefix; not broad.
- **Not setting `ServerSideEncryption` on PUT.** Many buckets require
  it via policy; signature fails confusingly without it.
- **Using `Access-Control-Allow-Origin: *` on the bucket.** Combined
  with a leaked URL, any site can fetch the content. Restrict to app
  origin.
- **Issuing MultipartUpload URLs without `maxParts` cap.** An attacker
  initiates 10k-part uploads and wastes your quota.
- **Not finalizing uploads server-side** (HEAD verify + DB commit).
  Orphaned S3 objects accumulate; users think upload succeeded when
  the row is missing.
- **Mixing public + private objects in one bucket without prefix
  discipline.** Path prefixes drift; access rules leak. Two buckets,
  two policies, one code path.
- **Using GCS with `version: 'v2'` signing.** V4 is the current
  standard; V2 HMAC is deprecated. Always V4.
- **R2 via the S3 client without `forcePathStyle: true`.** Signature
  mismatches at runtime; obscure failures in prod.
- **Not verifying signature parameters client-side before upload
  attempt.** Clients that send the wrong method (PUT vs POST) eat
  the retry budget. Validate shape before dispatch.
- **Allowing arbitrary `Cache-Control` override via signed URL.**
  `responseCacheControl` must come from the server policy, not the
  client's request body.
- **Caching private signed URLs in any CDN config.** Response must
  include `Cache-Control: private, no-store` or the CDN caches and
  serves to the next user.

## References

- ADRs: [0041](../adr/0041-uploads-tus-s3.md),
  [0034](../adr/0034-auth-cookie-and-csrf-contract.md),
  [0019](../adr/0019-server-state-discipline.md)
- Sibling recipes: [uploads.md](uploads.md),
  [uploads-uppy.md](uploads-uppy.md),
  [video-streaming.md](video-streaming.md),
  [gdpr-data-export.md](gdpr-data-export.md),
  [pdf-generation.md](pdf-generation.md),
  [backup-recovery.md](backup-recovery.md),
  [secrets-management.md](secrets-management.md),
  [rate-limiting.md](rate-limiting.md),
  [audit-log.md](audit-log.md),
  [observability.md](observability.md),
  [caching.md](caching.md)
- External: AWS S3 Presigned URLs (SigV4) docs; Cloudflare R2 S3
  compatibility docs; GCS V4 signing docs; CloudFront signed URLs +
  signed cookies docs; OWASP ASVS L2 §12 (file / resource); RFC 6749
  §10.3 (credential storage); AWS Identity-Based Policy Examples
  (scoping via `aws:ResourceTag`)
