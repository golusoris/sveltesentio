# `gdpr-data-export.md` — GDPR Art.20 data portability recipe for sveltesentio

GDPR **Art.20 (Right to data portability)** entitles every EU data
subject to receive their personal data in a "structured, commonly
used and machine-readable format" — and to transmit it to another
controller without hindrance. CCPA §1798.130 has parallel
"right-to-know-disclosure" obligations; UK GDPR mirrors EU GDPR;
Brazil LGPD Art.18 §V; California CPRA. This recipe covers the
self-serve export flow as the data-portability sibling to
[account-deletion.md](account-deletion.md), per
[ADR-0034](../adr/0034-cookies-auth-boundary.md) +
[ADR-0023](../adr/0023-compliance-observability.md).

The hard parts are **not the format** — they are **completeness**
(every dataset that contains the user's data must be enumerated, in
sync with the data map), **categorization** (regulators require
data sorted by category, not by your internal table layout),
**third-party data exclusion** (other users' messages to this user
must be redacted), and **media-bundle handling** (avatars + uploads
+ generated reports + audit excerpts ship as a manifest-indexed
bundle, not a single JSON blob).

## Related

- [account-deletion.md](account-deletion.md) — sibling Art.17
  recipe; same governance, opposite direction
- [audit-log.md](audit-log.md) — export request itself logs as a
  user action
- [queue-workers.md](queue-workers.md) — export build runs as a
  worker (≤ 1h SLA per Art.12 §3)
- [notifications-center.md](notifications-center.md) — completion
  notification with download link
- [secrets-management.md](secrets-management.md) — signed-URL secret
  rotation
- [rate-limiting.md](rate-limiting.md) — request-export endpoint
  protection against abuse
- [content-moderation.md](content-moderation.md) — DSA transparency
  reports use the same aggregation primitives
- [ADR-0034](../adr/0034-cookies-auth-boundary.md)
- [ADR-0023](../adr/0023-compliance-observability.md)
- GDPR Art.20: `gdpr-info.eu/art-20-gdpr/`
- GDPR Art.12 §3: `gdpr-info.eu/art-12-gdpr/` (1-month timeline)

## Architecture — request → build → notify → download

```text
USER REQUEST            BUILDER WORKER            NOTIFY               DOWNLOAD
                                                                       
/account/export → POST  jobId: export:${userId}   sendNotification     /api/exports/{id}
re-auth + Zod-validate  (1) enumerate datasets    (download_ready)     authz: requester only
audit-log: export.req   (2) per-dataset query     dedupeKey            signed-URL → S3
   │                    (3) third-party redact    expires 72h          Cache-Control: private,
   ▼                    (4) write JSON+CSV+files                       no-store
exports table:          (5) write manifest.json
status='queued'         (6) bundle as ZIP
                        (7) sign URL + persist
                        (8) status='ready'
```

Total wall-clock SLA is **1 month** (GDPR Art.12 §3); we target
**1 hour** for typical accounts and **24 hours** worst case for
heavy accounts (10K+ items). Exceeding 1 month requires written
notice to the user with reasons.

## Shape — bounded Zod contracts

```ts
// packages/portability/src/schema.ts
import { z } from 'zod';

// Categories follow the GDPR Art.4 typology; each export must
// classify every record into exactly one category.
export const DataCategory = z.enum([
  'identity',         // name, email, username, dob
  'contact',          // address, phone, secondary emails
  'authentication',   // password hashes (excluded from export!), MFA factors metadata
  'preferences',      // theme, locale, notification settings
  'usage',            // page views, action logs (last 90d)
  'content',          // posts, comments, uploads
  'social',           // follows, friends, blocks (excluding other users' PII)
  'commercial',       // orders, invoices, subscriptions
  'communications',   // messages SENT BY this user (received messages excluded)
  'system',           // tenant memberships, role assignments
  'audit_excerpt',    // user-facing audit log slice (no admin-only fields)
]);
export type DataCategory = z.infer<typeof DataCategory>;

export const ExportFormat = z.enum(['json', 'csv', 'json_and_csv']);
export type ExportFormat = z.infer<typeof ExportFormat>;

export const ExportStatus = z.enum([
  'queued',
  'building',
  'ready',
  'downloaded',
  'expired',
  'failed',
]);
export type ExportStatus = z.infer<typeof ExportStatus>;

export const ExportRequest = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  requestedAt: z.string().datetime(),
  format: ExportFormat.default('json_and_csv'),
  categories: z.array(DataCategory).min(1),
  status: ExportStatus,
  bundleSizeBytes: z.number().int().nonnegative().nullable(),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  downloadUrl: z.string().url().nullable(),
  downloadExpiresAt: z.string().datetime().nullable(),
  builtAt: z.string().datetime().nullable(),
  downloadedAt: z.string().datetime().nullable(),
  failureReason: z.string().max(2000).nullable(),
});
export type ExportRequest = z.infer<typeof ExportRequest>;

// Per-category dataset record in the bundle.
export const DatasetEntry = z.object({
  category: DataCategory,
  table: z.string().min(1).max(100),
  rowCount: z.number().int().nonnegative(),
  jsonPath: z.string().min(1),
  csvPath: z.string().nullable(),
  schemaUrl: z.string().url().nullable(), // public schema definition
});

export const ExportManifest = z.object({
  schemaVersion: z.literal(1),
  exportId: z.string().uuid(),
  userId: z.string().uuid(),
  builtAt: z.string().datetime(),
  generator: z.object({
    name: z.literal('sveltesentio-portability'),
    version: z.string(),
  }),
  datasets: z.array(DatasetEntry),
  mediaFiles: z.array(z.object({
    path: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    originalName: z.string(),
  })),
  totalSizeBytes: z.number().int().nonnegative(),
  bundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ExportManifest = z.infer<typeof ExportManifest>;
```

`ExportManifest` is the **contract** other systems can rely on —
versioned (`schemaVersion: 1`), checksummed, listing every dataset
+ every media file + their SHA-256s. A second controller importing
this bundle has a deterministic surface to read against.

## Reference — request endpoint

```ts
// src/routes/account/export/+page.server.ts
import { ExportRequest, DataCategory } from '@sveltesentio/portability/schema';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { superValidate, fail } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { db } from '$lib/server/db';
import { reauth } from '$lib/server/auth';
import { rateLimit } from '$lib/server/rate-limit';
import { auditLog } from '$lib/server/audit';
import { exportQueue } from '$lib/server/queues';

const RequestForm = z.object({
  format: z.enum(['json', 'csv', 'json_and_csv']).default('json_and_csv'),
  categories: z.array(DataCategory).min(1),
  password: z.string().min(1).max(200), // re-auth
});

export const actions = {
  request: async ({ request, locals, getClientAddress }) => {
    const form = await superValidate(request, zod(RequestForm));
    if (!form.valid) return fail(400, { form });

    await rateLimit({
      key: `export:${locals.user.id}`,
      limit: 3,
      windowMs: 86400_000, // 3 exports per day max
    });

    if (!(await reauth(locals.user.id, form.data.password))) {
      return fail(401, { form: { ...form, errors: { password: 'Incorrect password' } } });
    }

    const exportId = uuidv7();
    await db.query(
      `INSERT INTO export_requests (id, user_id, format, categories, status, requested_at)
       VALUES ($1, $2, $3, $4, 'queued', NOW())`,
      [exportId, locals.user.id, form.data.format, form.data.categories],
    );

    await auditLog('export.requested', {
      exportId,
      userId: locals.user.id,
      format: form.data.format,
      categories: form.data.categories,
      ip: getClientAddress(),
    });

    // Idempotent on jobId: re-queueing the same exportId is harmless.
    await exportQueue.add(
      'build-export',
      { exportId },
      { jobId: `export:${exportId}`, attempts: 3 },
    );

    return { success: true, exportId };
  },
};
```

`reauth` step is required — Art.20 export contains the user's full
data; treating the request as routine would let an unattended-laptop
attacker exfiltrate everything. Same posture as
[account-deletion.md](account-deletion.md).

## Reference — data-map registry (single source of truth)

```ts
// packages/portability/src/datamap.ts
import type { DataCategory } from './schema';
import { db } from '$lib/server/db';

// Every table that holds user PII registers here. New tables added
// to the schema MUST add an entry — enforced by the data-migrations.md
// preflight check (CI fails if a column references user_id but is
// missing from this map).
export const DATA_MAP: Array<{
  category: DataCategory;
  table: string;
  query: (userId: string) => Promise<unknown[]>;
  redactPaths?: string[]; // dot-paths in each row to nullify
  schemaUrl: string;
}> = [
  {
    category: 'identity',
    table: 'users',
    schemaUrl: 'https://schemas.example.com/portability/users-v1.json',
    query: (userId) => db.query(
      `SELECT id, email, username, name, locale, created_at FROM users WHERE id = $1`, [userId],
    ).then((r) => r.rows),
    // Never export password_hash, mfa_secret_encrypted, even though they're "your data"
    redactPaths: [],
  },
  {
    category: 'contact',
    table: 'user_addresses',
    schemaUrl: 'https://schemas.example.com/portability/addresses-v1.json',
    query: (userId) => db.query(
      `SELECT * FROM user_addresses WHERE user_id = $1`, [userId],
    ).then((r) => r.rows),
  },
  {
    category: 'preferences',
    table: 'user_preferences',
    schemaUrl: 'https://schemas.example.com/portability/preferences-v1.json',
    query: (userId) => db.query(
      `SELECT * FROM user_preferences WHERE user_id = $1`, [userId],
    ).then((r) => r.rows),
  },
  {
    category: 'content',
    table: 'posts',
    schemaUrl: 'https://schemas.example.com/portability/posts-v1.json',
    query: (userId) => db.query(
      `SELECT id, title, body, created_at, updated_at FROM posts WHERE author_id = $1`, [userId],
    ).then((r) => r.rows),
  },
  {
    category: 'communications',
    table: 'messages',
    schemaUrl: 'https://schemas.example.com/portability/messages-v1.json',
    // CRITICAL: only messages SENT by this user. Received messages contain
    // other users' content and must NOT be in this user's export
    // (Art.20 §4 — must not adversely affect rights of others).
    query: (userId) => db.query(
      `SELECT id, recipient_id, body, sent_at FROM messages WHERE sender_id = $1`, [userId],
    ).then((r) => r.rows),
    redactPaths: ['recipient_id'], // even recipient ID is third-party PII
  },
  // ... more entries per table
];
```

The data-map is **append-only governance**. CI step (per
[data-migrations.md](data-migrations.md) preflight) scans the schema
for tables referencing `user_id` and fails the build if any table is
missing from the map. This catches "we added the table but forgot
the export" silently before it ships.

## Reference — builder worker

```ts
// packages/portability/src/builder.ts
import { Worker } from 'bullmq';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify as csvStringify } from 'csv-stringify/sync';
import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { DATA_MAP } from './datamap';
import { ExportManifest } from './schema';
import { db } from '$lib/server/db';
import { s3 } from '$lib/server/s3';
import { sendNotification } from '@sveltesentio/notifications';
import { auditLog } from '$lib/server/audit';

new Worker('exports', async (job) => {
  const { exportId } = job.data as { exportId: string };

  await db.query(`UPDATE export_requests SET status = 'building' WHERE id = $1`, [exportId]);

  const req = await db.queryOne<{ user_id: string; format: string; categories: string[] }>(
    `SELECT user_id, format, categories FROM export_requests WHERE id = $1`, [exportId],
  );

  const workDir = join(tmpdir(), `export-${exportId}`);
  await mkdir(workDir, { recursive: true });

  try {
    // 1. Per-dataset query + write
    const datasets = [];
    const wantsJson = req.format === 'json' || req.format === 'json_and_csv';
    const wantsCsv = req.format === 'csv' || req.format === 'json_and_csv';

    for (const entry of DATA_MAP) {
      if (!req.categories.includes(entry.category)) continue;

      const rows = await entry.query(req.user_id);
      const redacted = rows.map((row) => redact(row, entry.redactPaths ?? []));

      let jsonPath: string | null = null;
      let csvPath: string | null = null;

      if (wantsJson) {
        jsonPath = `data/${entry.category}/${entry.table}.json`;
        await mkdir(join(workDir, `data/${entry.category}`), { recursive: true });
        await writeFile(join(workDir, jsonPath), JSON.stringify(redacted, null, 2));
      }
      if (wantsCsv && redacted.length > 0) {
        csvPath = `data/${entry.category}/${entry.table}.csv`;
        const csv = csvStringify(redacted, { header: true });
        await writeFile(join(workDir, csvPath), csv);
      }

      datasets.push({
        category: entry.category,
        table: entry.table,
        rowCount: redacted.length,
        jsonPath: jsonPath ?? '',
        csvPath,
        schemaUrl: entry.schemaUrl,
      });
    }

    // 2. Media files
    const mediaFiles = [];
    if (req.categories.includes('content')) {
      const uploads = await db.query<{ id: string; original_name: string; s3_key: string; size_bytes: string }>(
        `SELECT id, original_name, s3_key, size_bytes FROM uploads WHERE user_id = $1`, [req.user_id],
      );
      for (const u of uploads.rows) {
        const buf = await s3.getObject({ Key: u.s3_key }).then((r) => r.Body!.transformToByteArray());
        const sha = createHash('sha256').update(buf).digest('hex');
        const path = `media/${u.id}/${u.original_name}`;
        await mkdir(join(workDir, `media/${u.id}`), { recursive: true });
        await writeFile(join(workDir, path), buf);
        mediaFiles.push({
          path,
          sizeBytes: Number(u.size_bytes),
          sha256: sha,
          originalName: u.original_name,
        });
      }
    }

    // 3. Manifest
    const manifest = ExportManifest.parse({
      schemaVersion: 1,
      exportId,
      userId: req.user_id,
      builtAt: new Date().toISOString(),
      generator: { name: 'sveltesentio-portability', version: '1.0.0' },
      datasets,
      mediaFiles,
      totalSizeBytes: 0, // filled after zip
      bundleSha256: '', // filled after zip
    });
    await writeFile(join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // 4. README explaining the bundle structure
    await writeFile(join(workDir, 'README.txt'),
      `Personal data export\n` +
      `Generated: ${manifest.builtAt}\n` +
      `Schema: ${manifest.schemaVersion}\n\n` +
      `See manifest.json for the full file index.\n` +
      `Each dataset under data/<category>/<table>.{json,csv} per GDPR Art.20.\n` +
      `Media files under media/<upload-id>/<original-name>.\n`);

    // 5. Bundle as ZIP
    const zipPath = join(workDir, `export-${exportId}.zip`);
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      out.on('close', () => resolve());
      archive.on('error', reject);
      archive.pipe(out);
      archive.directory(join(workDir, 'data'), 'data');
      if (req.categories.includes('content')) archive.directory(join(workDir, 'media'), 'media');
      archive.file(join(workDir, 'manifest.json'), { name: 'manifest.json' });
      archive.file(join(workDir, 'README.txt'), { name: 'README.txt' });
      void archive.finalize();
    });

    // 6. Compute bundle SHA + upload
    const bundle = await readFile(zipPath);
    const bundleSha = createHash('sha256').update(bundle).digest('hex');
    const s3Key = `exports/${req.user_id}/${exportId}.zip`;
    await s3.putObject({
      Key: s3Key,
      Body: bundle,
      ContentType: 'application/zip',
      ServerSideEncryption: 'AES256',
    });

    // 7. Sign download URL (72h expiry)
    const downloadUrl = await s3.getSignedUrl('getObject', {
      Key: s3Key,
      Expires: 72 * 3600,
      ResponseCacheControl: 'private, no-store',
      ResponseContentDisposition: `attachment; filename="export-${exportId}.zip"`,
    });
    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();

    await db.query(
      `UPDATE export_requests
       SET status = 'ready', built_at = NOW(), bundle_size_bytes = $1,
           manifest_sha256 = $2, download_url = $3, download_expires_at = $4
       WHERE id = $5`,
      [bundle.length, bundleSha, downloadUrl, expiresAt, exportId],
    );

    await sendNotification({
      userId: req.user_id,
      type: 'export.ready',
      dedupeKey: `export-ready:${exportId}`,
      meta: { exportId, expiresAt, sizeBytes: bundle.length },
    });

    await auditLog('export.completed', { exportId, userId: req.user_id, sizeBytes: bundle.length, sha256: bundleSha });
  } catch (err) {
    await db.query(
      `UPDATE export_requests SET status = 'failed', failure_reason = $1 WHERE id = $2`,
      [(err as Error).message.slice(0, 2000), exportId],
    );
    await auditLog('export.failed', { exportId, error: (err as Error).message });
    throw err; // BullMQ retry
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}, { connection: redisConfig, concurrency: 2 });

function redact(row: Record<string, unknown>, paths: string[]): Record<string, unknown> {
  const copy = { ...row };
  for (const p of paths) {
    const parts = p.split('.');
    let cur: any = copy;
    for (let i = 0; i < parts.length - 1; i++) cur = cur?.[parts[i]];
    if (cur) cur[parts[parts.length - 1]] = null;
  }
  return copy;
}
```

`concurrency: 2` is intentional — exports are heavy (S3 fetches, zip
compression, large payloads); over-parallelizing exhausts memory.
Tune per worker memory budget.

## Download endpoint

```ts
// src/routes/api/exports/[id]/+server.ts
import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/audit';

export const GET = async ({ params, locals }) => {
  if (!locals.user) throw error(401);

  const r = await db.queryOne<{ user_id: string; status: string; download_url: string; download_expires_at: string }>(
    `SELECT user_id, status, download_url, download_expires_at
     FROM export_requests WHERE id = $1`,
    [params.id],
  );

  if (!r || r.user_id !== locals.user.id) throw error(404);
  if (r.status !== 'ready') throw error(409, { type: 'not_ready', status: r.status });
  if (new Date(r.download_expires_at) < new Date()) throw error(410, { type: 'expired' });

  await db.query(
    `UPDATE export_requests SET status = 'downloaded', downloaded_at = NOW() WHERE id = $1`,
    [params.id],
  );
  await auditLog('export.downloaded', { exportId: params.id, userId: locals.user.id });

  throw redirect(302, r.download_url);
};
```

## Anti-patterns (24)

1. **Single mega-JSON for everything** — non-portable, hard to
   diff, hard to import elsewhere. Categorize per Art.20 expectation.
2. **Including authentication secrets** — password hashes / MFA
   secrets are NOT "your data" in a portable sense; they're security
   primitives. Exclude.
3. **Including third-party PII** — received messages from other
   users contain THEIR data. Art.20 §4 forbids this. Only outbound
   messages, with recipient identifiers redacted.
4. **No data-map registry** — new tables silently miss the export;
   user gets incomplete data; later complaint = regulator scrutiny.
5. **Ad-hoc SQL queries scattered across the codebase** — drift
   between what the export says and what's in production. Single
   `DATA_MAP` source-of-truth.
6. **No schema URLs** — recipients can't validate the structure;
   import tooling has to reverse-engineer.
7. **No manifest** — bundle is a pile of files; consumer has no
   index. Always include `manifest.json` with checksums.
8. **No SHA-256 on the bundle** — user can't verify integrity;
   tampering invisible.
9. **Public download URL** — anyone with the link gets the user's
   life. Signed URL + 72h expiry + `Cache-Control: private,
   no-store`.
10. **Long expiry (>30d) on download URL** — link forwarded /
    leaked = permanent exfiltration risk.
11. **No re-auth on request** — unattended laptop = full export
    leaked. Re-auth before queueing.
12. **No rate limit on request** — attacker triggers infinite
    rebuilds; DoS the export worker.
13. **In-request synchronous build** — small accounts work, large
    accounts time out + half-bundle. Always async via worker.
14. **Worker concurrency too high** — OOM on heavy exports;
    everyone's exports fail. `concurrency: 2-4`.
15. **Tempdir not cleaned up on failure** — disk fills; future
    exports fail. `finally { rm -rf tempdir }`.
16. **Bundle stored in same bucket / prefix as user uploads** —
    auth boundary blurred; misconfigured policy could expose
    exports as content. Dedicated `exports/` prefix with stricter
    policy.
17. **No bundle encryption at rest** — S3 default + KMS at minimum;
    optionally CMK per [secrets-management.md](secrets-management.md).
18. **No completion notification** — user doesn't know it's ready;
    72h expiry passes; redo. Always notify with link.
19. **Notification email contains the bundle URL directly** —
    forwarded email = exposed link. Notification points to in-app
    download page; the page issues the signed URL.
20. **No `sendBeacon` audit-trail of download access** — fraud
    investigation has no record. Audit on every GET of the bundle.
21. **CSV without header row** — non-portable. Always `header:
    true`.
22. **Date format mixed (ISO, locale, epoch)** — inconsistent;
    consumers can't parse. ISO 8601 everywhere.
23. **Manifest schema unversioned** — breaking changes to the
    manifest break import tooling silently. `schemaVersion: 1`
    pinned + bumped on breaking changes.
24. **Treating "I'll add an export later" as acceptable** —
    GDPR Art.20 + Art.12 §3 require provision **without undue
    delay**, max 1 month. Day-1 launch must include the export
    flow.

## References

- ADRs: [0034](../adr/0034-cookies-auth-boundary.md),
  [0023](../adr/0023-compliance-observability.md),
  [0019](../adr/0019-server-runtime-contract.md)
- Sibling recipes:
  [account-deletion.md](account-deletion.md),
  [audit-log.md](audit-log.md),
  [queue-workers.md](queue-workers.md),
  [notifications-center.md](notifications-center.md),
  [secrets-management.md](secrets-management.md),
  [rate-limiting.md](rate-limiting.md),
  [data-migrations.md](data-migrations.md)
- Upstream:
  GDPR Art.20 `gdpr-info.eu/art-20-gdpr/`,
  GDPR Art.12 `gdpr-info.eu/art-12-gdpr/`,
  CCPA §1798.130
  `oag.ca.gov/privacy/ccpa`,
  EDPB Guidelines on Right to Data Portability
  `edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-right-data-portability_en`,
  WP29 (now EDPB) Opinion 17/EN WP 242,
  Data Transfer Project `datatransferproject.dev/`.
