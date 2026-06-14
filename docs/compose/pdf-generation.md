# pdf-generation.md — composition recipe

> **Server-side PDF generation for sveltesentio:** two-tier strategy —
> **Tier 1 (default) PDFKit/pdf-lib** for simple structured docs
> (invoices, receipts, tickets) rendered directly from typed data, and
> **Tier 2 (opt-in) headless Chromium via Playwright** for
> designer-driven brochures / catalogues / statements that must match a
> pixel-perfect HTML design. Both tiers emit **PDF/UA-1 tagged**
> output (WCAG / §508 compliant), both persist to the same signed-URL
> contract from [signed-urls.md](signed-urls.md), and both record a
> full audit trail per [audit-log.md](audit-log.md). Per
> [ADR-0019](../adr/0019-server-state-discipline.md) +
> [ADR-0023](../adr/0023-observability-uuidv7.md) every rendered
> artifact is **content-addressed** (SHA-256 of inputs → filename) so
> regenerations are idempotent and caches never serve a stale invoice.

> **Server-only.** PDF rendering never runs in the browser. PDFKit
> writes to a stream; Playwright spins up a worker pool. The client
> gets a signed URL to S3/R2 and downloads.

## Related

- [structured-emails.md](structured-emails.md) — invoice PDFs are
  attached to transactional emails; this recipe owns rendering,
  that one owns delivery
- [payments.md](payments.md) + [pricing-plans-changes.md](pricing-plans-changes.md) +
  [billing-usage-metering.md](billing-usage-metering.md) — the three
  billing surfaces that emit invoices
- [signed-urls.md](signed-urls.md) — download contract for rendered PDFs
- [gdpr-data-export.md](gdpr-data-export.md) — sibling bundle pipeline;
  both use `media/<id>` layout under S3
- [queue-workers.md](queue-workers.md) — PDF render jobs run on the
  `pdf-render` queue
- [observability.md](observability.md) — render time + font load +
  bytes-out feed OTel
- [caching.md](caching.md) — content-addressed filenames cache forever
- [audit-log.md](audit-log.md) — every PDF rendered is an audit event
- [rate-limiting.md](rate-limiting.md) — tenant-scoped PDF generation
  quota (heavy resource)
- [secrets-management.md](secrets-management.md) — PDF signing cert +
  font licenses
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — PDF/UA-1 tagging
  contract
- [ADR-0019](../adr/0019-server-state-discipline.md)
- [ADR-0023](../adr/0023-observability-uuidv7.md)

## When to use what

```text
Invoice / receipt / ticket (structured data → standard layout)   → Tier 1 (PDFKit/pdf-lib)
Badges, certificates, QR-coded tickets                           → Tier 1
Payslip / tax form / compliance form (known schema)              → Tier 1
Multi-page statement with charts                                 → Tier 1 + rasterized chart image
Marketing brochure / catalogue (designer-owned HTML/CSS)         → Tier 2 (Playwright)
Per-tenant-branded policy document (markdown → PDF)              → Tier 2
Financial report with complex tables + header/footer             → Tier 2
Accessible PDF/UA-1 tagged (mandatory for EU accessibility)      → Tier 1 (native tagging);
                                                                    Tier 2 needs PAC3 post-process
Large batch (>1000 PDFs/hour)                                    → Tier 1 only (Chromium too heavy)
Interactive form fields (AcroForm)                               → Tier 1 (pdf-lib)
Digital signature (PAdES)                                        → Tier 1 + node-signpdf
```

**Default to Tier 1.** Tier 2 is an escape hatch when the design
team won't give up the HTML mockup. Every Tier 2 adoption is one
more Chromium-in-production headache.

## Install

```bash
# Tier 1
pnpm add -F @sveltesentio/pdf pdfkit pdf-lib qrcode bwip-js
# PDFKit = streaming / sequential layout (invoices, receipts).
# pdf-lib = surgical edits (fill AcroForms, stamp pages).
# qrcode + bwip-js = QR + barcodes rendered into the stream.

# Tier 2 (only if opting in)
pnpm add -F <app> playwright
pnpm exec playwright install --with-deps chromium
```

> Pin PDFKit + pdf-lib — they handle binary formats, silent breakage
> on minor bumps is common.

## Shape — bounded Zod for every render

```ts
// packages/pdf/src/types.ts
import { z } from 'zod';

export const PdfKind = z.enum([
  'invoice', 'receipt', 'ticket', 'payslip',
  'certificate', 'brochure', 'policy', 'statement',
]);
export type PdfKind = z.infer<typeof PdfKind>;

export const PdfTier = z.enum(['tier1_pdfkit', 'tier1_pdflib', 'tier2_chromium']);

// ISO 4217 + bounded amount grid for invoice lines.
export const Money = z.object({
  amountMinor: z.number().int(),            // cents; negative = credit
  currency: z.enum(['usd', 'eur', 'gbp', 'cad', 'aud', 'jpy', 'chf']),
});

export const InvoiceLine = z.object({
  description: z.string().min(1).max(200),
  quantity: z.number().min(0).max(999_999),
  unitPrice: Money,
  amount: Money, // quantity × unit; stored separately to avoid float rounding
});

export const InvoiceInput = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('invoice'),
  tenantId: z.string().uuid(),
  invoiceNumber: z.string().regex(/^[A-Z0-9-]{3,40}$/),
  issuedAt: z.string().datetime(),
  dueAt: z.string().datetime(),
  seller: z.object({
    legalName: z.string().min(1).max(200),
    vatNumber: z.string().regex(/^[A-Z]{2}[A-Z0-9]{2,18}$/).optional(), // EU VAT
    address: z.string().min(5).max(500),
    logoUrl: z.string().url().nullable(),
  }),
  buyer: z.object({
    legalName: z.string().min(1).max(200),
    vatNumber: z.string().regex(/^[A-Z]{2}[A-Z0-9]{2,18}$/).optional(),
    address: z.string().min(5).max(500),
  }),
  lines: z.array(InvoiceLine).min(1).max(200),
  subtotal: Money,
  taxLines: z.array(z.object({
    label: z.string().min(1).max(80),
    rateBps: z.number().int().min(0).max(10_000), // basis points; 19% → 1900
    amount: Money,
  })).max(10),
  total: Money,
  locale: z.enum(['en_US', 'en_GB', 'de_DE', 'fr_FR', 'es_ES', 'it_IT', 'ja_JP']).default('en_US'),
  notes: z.string().max(2000).optional(),
});
export type InvoiceInput = z.infer<typeof InvoiceInput>;

export const RenderRequest = z.object({
  idempotencyKey: z.string().uuid(), // UUIDv7 — caller-supplied
  kind: PdfKind,
  tier: PdfTier,
  payload: z.unknown(), // narrowed at the handler based on `kind`
});

export const RenderResult = z.object({
  id: z.string().uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive(),
  pages: z.number().int().positive(),
  s3Key: z.string().min(1),
  signedUrl: z.string().url(),
  expiresAt: z.string().datetime(),
  renderedAt: z.string().datetime(),
  tier: PdfTier,
});
```

**Amounts are integer-minor (cents).** No floats anywhere near money
— see [billing-usage-metering.md](billing-usage-metering.md).
**Invoice total is provided by the caller, not recomputed** — we're
rendering, not computing. If the caller's numbers don't add up that's
the billing pipeline's bug, not the renderer's.

## Reference patterns

### 1. Tier 1 — invoice via PDFKit (streaming)

```ts
// packages/pdf/src/renderers/invoice.ts
import PDFDocument from 'pdfkit';
import { InvoiceInput } from '../types';
import { formatMoney, formatDate } from '../i18n';

export async function renderInvoice(input: InvoiceInput): Promise<Buffer> {
  const parsed = InvoiceInput.parse(input);
  const doc = new PDFDocument({
    size: 'A4',
    margin: 56,         // 20mm — fits European letterhead
    lang: parsed.locale.slice(0, 2),
    displayTitle: true,
    pdfVersion: '1.7',
    tagged: true,       // PDF/UA-1 structural tagging
    info: {
      Title: `Invoice ${parsed.invoiceNumber}`,
      Author: parsed.seller.legalName,
      Subject: `Invoice for ${parsed.buyer.legalName}`,
      Creator: 'sveltesentio',
      Producer: 'PDFKit',
      CreationDate: new Date(parsed.issuedAt),
    },
  });

  // Register the licensed font once per process; PDFKit throws on missing.
  doc.registerFont('Inter-Regular', 'assets/fonts/Inter-Regular.ttf');
  doc.registerFont('Inter-Bold',    'assets/fonts/Inter-Bold.ttf');

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // STRUCTURE = tagging tree; everything goes inside structure elements.
  const struct = doc.struct('Document');
  doc.addStructure(struct);

  // Header
  const header = doc.struct('H1', () => {
    doc.font('Inter-Bold').fontSize(22).text(`Invoice ${parsed.invoiceNumber}`);
  });
  struct.add(header);

  doc.moveDown(0.5).font('Inter-Regular').fontSize(10);
  doc.text(`Issued ${formatDate(parsed.issuedAt, parsed.locale)}`);
  doc.text(`Due ${formatDate(parsed.dueAt, parsed.locale)}`);
  doc.moveDown(1);

  // Parties (two columns)
  const sellerBlock = doc.struct('Sect', () => {
    doc.font('Inter-Bold').fontSize(10).text('From', 56, doc.y);
    doc.font('Inter-Regular').text(parsed.seller.legalName);
    doc.text(parsed.seller.address);
    if (parsed.seller.vatNumber) doc.text(`VAT ${parsed.seller.vatNumber}`);
  });
  struct.add(sellerBlock);
  doc.moveDown(2);

  // Line items table (tag as Table)
  const tableStruct = doc.struct('Table', () => {
    // Header row
    doc.font('Inter-Bold').fontSize(10);
    doc.text('Description', 56, doc.y, { width: 260 });
    doc.text('Qty',      316, doc.y, { width: 40,  align: 'right' });
    doc.text('Unit',     356, doc.y, { width: 80,  align: 'right' });
    doc.text('Amount',   436, doc.y, { width: 100, align: 'right' });
    doc.moveDown(0.5);

    doc.font('Inter-Regular');
    for (const line of parsed.lines) {
      const y = doc.y;
      doc.text(line.description, 56, y, { width: 260 });
      doc.text(String(line.quantity), 316, y, { width: 40, align: 'right' });
      doc.text(formatMoney(line.unitPrice, parsed.locale), 356, y, { width: 80, align: 'right' });
      doc.text(formatMoney(line.amount,    parsed.locale), 436, y, { width: 100, align: 'right' });
      doc.moveDown(0.3);
    }
  });
  struct.add(tableStruct);

  // Totals
  doc.moveDown(1);
  doc.font('Inter-Bold').fontSize(11);
  doc.text(`Total ${formatMoney(parsed.total, parsed.locale)}`, { align: 'right' });

  struct.end();
  doc.end();
  return done;
}
```

Contract notes:

- **`tagged: true`** — non-negotiable. PDF/UA-1 needs structural tags.
- **Fonts are embedded.** Don't rely on standard PDF fonts for non-ASCII.
- **`doc.struct(...)`** trees the content; screen readers walk this.
  Skipping it produces an untagged PDF = accessibility failure.
- **Absolute positioning for table columns** — PDFKit's auto-flow is
  unreliable for numeric alignment.

### 2. Tier 1 — AcroForm fill via pdf-lib

```ts
// packages/pdf/src/renderers/tax-form.ts
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'fs/promises';

export async function fillTaxForm(data: Record<string, string>): Promise<Uint8Array> {
  const bytes = await readFile('assets/forms/tax-form-template.pdf');
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();

  // Every field name is hardcoded after inspection; no dynamic field
  // lookup — typos become silent "form field with typo never fills".
  for (const [fieldName, value] of Object.entries(data)) {
    const field = form.getTextField(fieldName);
    field.setText(value.slice(0, 2000));  // DoS protection
    field.enableReadOnly();               // prevent post-render edit
  }
  form.flatten(); // bake values into the page; no AcroForm afterwards
  return doc.save();
}
```

`flatten()` is the security feature — an un-flattened AcroForm can be
re-edited by the recipient. Every compliance doc gets flattened.

### 3. Tier 2 — Playwright (HTML → PDF)

```ts
// packages/pdf/src/renderers/brochure.ts
import { chromium, type Browser } from 'playwright';
import { z } from 'zod';

const BrochureInput = z.object({
  templateUrl: z.string().url(), // internal URL — template route in our app
  params: z.record(z.string(), z.string()).refine(
    (obj) => Object.keys(obj).length <= 50,
    'too many params',
  ),
  pdfOptions: z.object({
    format: z.literal('A4').default('A4'),
    landscape: z.boolean().default(false),
    printBackground: z.boolean().default(true),
    margin: z.object({
      top: z.string().default('20mm'),
      right: z.string().default('15mm'),
      bottom: z.string().default('20mm'),
      left: z.string().default('15mm'),
    }).default({}),
  }).default({}),
});

// Persistent pool — launching Chromium per render is 800ms cold; pool = 60ms.
let pool: Browser | null = null;
export async function getBrowser(): Promise<Browser> {
  if (pool && pool.isConnected()) return pool;
  pool = await chromium.launch({
    args: [
      '--no-sandbox',                  // containers already sandbox
      '--disable-dev-shm-usage',       // /dev/shm is small in k8s
      '--disable-gpu',
      '--font-render-hinting=none',    // deterministic rendering
    ],
  });
  return pool;
}

export async function renderBrochure(input: unknown): Promise<Buffer> {
  const parsed = BrochureInput.parse(input);
  const browser = await getBrowser();

  const context = await browser.newContext({
    userAgent: 'sveltesentio-pdf-renderer/1.0',
    // Fresh storage per render — no session bleed across tenants.
    storageState: undefined,
    // Internal token — the template route verifies this, so the
    // Chromium can render authenticated tenant-specific pages without
    // holding long-lived sessions.
    extraHTTPHeaders: { 'x-pdf-render-token': process.env.PDF_RENDER_TOKEN! },
  });

  const page = await context.newPage();
  const url = new URL(parsed.templateUrl);
  for (const [k, v] of Object.entries(parsed.params)) url.searchParams.set(k, v);

  try {
    await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: 30_000 });
    // Custom signal — the template route dispatches this when ready.
    await page.waitForFunction(() => (window as unknown as { __pdfReady?: boolean }).__pdfReady === true, { timeout: 10_000 });

    const pdf = await page.pdf({
      format: parsed.pdfOptions.format,
      landscape: parsed.pdfOptions.landscape,
      printBackground: parsed.pdfOptions.printBackground,
      margin: parsed.pdfOptions.margin,
      displayHeaderFooter: false,
      preferCSSPageSize: true,
    });
    return pdf;
  } finally {
    await context.close(); // NEVER close the browser; reuse the pool.
  }
}
```

Tier 2 invariants:

- **Browser is a singleton.** `context.close()` per render; `browser.close()`
  only on graceful shutdown.
- **Fresh `context` per render.** Prevents session/cache bleed across
  tenants in a multi-tenant worker.
- **`__pdfReady` signal** — let the template decide when it's fully
  hydrated. `networkidle` alone misses web-font late-load races.
- **Worker container needs `chromium-deps`.** Use Playwright's
  published Docker image (`mcr.microsoft.com/playwright`) — DIY Alpine
  setups break on font rendering.
- **Tier 2 output is NOT PDF/UA-1 tagged by default.** Run `pac3`
  (PDF Accessibility Checker 3) post-process or switch to Tier 1 for
  accessibility-critical docs.

### 4. Worker + orchestration

```ts
// packages/pdf/src/queue.ts
import { Queue, Worker } from 'bullmq';
import { v7 as uuidv7 } from 'uuid';
import { RenderRequest, RenderResult, InvoiceInput } from './types';
import { renderInvoice } from './renderers/invoice';
import { renderBrochure } from './renderers/brochure';
import { uploadAndSign } from './storage';
import { recordAudit } from '$lib/server/audit';
import { rateLimiter } from '$lib/server/rate-limiter';
import { sha256 } from '$lib/server/crypto';

export const pdfQueue = new Queue('pdf-render');

new Worker('pdf-render', async (job) => {
  const req = RenderRequest.parse(job.data);

  // Tenant-scoped rate limit — PDF rendering is expensive.
  const check = await rateLimiter.consume(`pdf:${(req.payload as { tenantId?: string }).tenantId}`, 1, {
    capacity: 100, refillPerSec: 100 / 3600, // 100/hr per tenant
  });
  if (!check.allowed) throw new Error('pdf_rate_limit');

  let bytes: Buffer | Uint8Array;
  switch (req.kind) {
    case 'invoice':
      bytes = await renderInvoice(InvoiceInput.parse(req.payload));
      break;
    case 'brochure':
    case 'policy':
      bytes = await renderBrochure(req.payload);
      break;
    default:
      throw new Error(`unsupported kind: ${req.kind}`);
  }

  const hash = await sha256(new Uint8Array(bytes));
  const s3Key = `pdf/${req.kind}/${hash}.pdf`;
  const upload = await uploadAndSign(s3Key, bytes, { contentType: 'application/pdf', expiresSec: 3600 });

  await recordAudit({
    actor: (req.payload as { actor?: string }).actor ?? 'system',
    action: `pdf.${req.kind}.rendered`,
    payload: { sha256: hash, bytes: bytes.byteLength, tier: req.tier, idempotencyKey: req.idempotencyKey },
  });

  const result: typeof RenderResult._type = {
    id: uuidv7(),
    sha256: hash,
    bytes: bytes.byteLength,
    pages: 1, // TODO: pdf-lib page count for Tier 1
    s3Key,
    signedUrl: upload.signedUrl,
    expiresAt: upload.expiresAt,
    renderedAt: new Date().toISOString(),
    tier: req.tier,
  };
  return result;
}, {
  concurrency: 4, // Tier 2 is heavy; Tier 1 could go higher if isolated
  limiter: { max: 50, duration: 60_000 },
});
```

### 5. Idempotency via content hash

```ts
// packages/pdf/src/idempotency.ts
export async function renderIfNotExists(req: RenderRequest): Promise<RenderResult> {
  // Canonical JSON — `JSON.stringify` with sorted keys.
  const canon = canonicalJson({ kind: req.kind, tier: req.tier, payload: req.payload });
  const inputHash = await sha256(canon);

  // Probe S3 HEAD first — if object exists, reuse.
  const s3Key = `pdf/${req.kind}/${inputHash}.pdf`;
  const existing = await s3Head(s3Key);
  if (existing) {
    return buildResultFromS3(inputHash, s3Key, existing);
  }
  // Enqueue
  const job = await pdfQueue.add(req.kind, req, { jobId: inputHash });
  return waitForCompletion(job);
}
```

Content-addressed by **input** hash (not output bytes) — because
two renders of the same invoice data must always produce the same
file, even if PDFKit bumps a non-deterministic byte (e.g., timestamp
in `/CreationDate`). Normalize: set `CreationDate` to `issuedAt` and
ModDate to the same, so the byte output is stable.

### 6. Deterministic output (critical for content-addressed cache)

```ts
// PDFKit emits /CreationDate + /ModDate from the system clock by default.
// We override both to the input's timestamp, and disable the random PDF id.
const doc = new PDFDocument({
  info: {
    CreationDate: new Date(parsed.issuedAt),
    ModDate:      new Date(parsed.issuedAt),
  },
});
// Remove doc._id randomness (PDFKit internal); if library version
// exposes `doc._root.data.ID`, set deterministically from inputHash.
```

Without this, the same invoice renders to different bytes every call,
the hash changes, and the CDN cache is useless.

### 7. Accessibility — PDF/UA-1 checklist

| Requirement | How |
|---|---|
| Document language | `new PDFDocument({ lang: 'en' })` |
| Title meta | `info.Title` + `displayTitle: true` (title bar shows it) |
| Structural tags | `tagged: true` + `doc.struct('H1', ...)` / `'Sect'` / `'Table'` |
| Reading order | structure tree order must match visual order |
| Alt text for images | `doc.image(..., { alt: 'Company logo' })` inside a `'Figure'` struct |
| Tables tagged | use `'Table'` + `'TR'` + `'TH'` + `'TD'` structure elements |
| Color contrast | 4.5:1 WCAG AA minimum; test with PAC3 |
| Fonts embedded | never rely on system fonts on the reader's device |
| No scanned images | scanned-only PDFs fail PDF/UA-1 (no extractable text) |

Ship a CI step that pipes rendered PDFs through
[veraPDF](https://verapdf.org/) or the Adobe PAC3 CLI; fail the build
on PDF/UA-1 errors.

### 8. Fonts + licensing

- **Embed a licensed font subset** per document. `PDFKit` with
  `subset: true` is the default.
- **Fonts live in `packages/pdf/assets/fonts/`** — not bundled into
  the app's client chunks.
- **License file** (`LICENSE-Inter.txt`) committed alongside the `.ttf`;
  renew it on every dependency refresh.
- **Non-Latin scripts** (CJK, Arabic, Devanagari) — bundle Noto per
  script, opt-in at the renderer level. Bundling every script wastes
  disk (~200 MB).
- **RTL support** — PDFKit's `features: ['rtla']` + OpenType layout
  features; test with real Arabic content, not placeholder.

## Anti-patterns

- **Running the renderer in the browser.** PDFKit works in browsers,
  but leaks fonts + size + computational cost to every client. Server
  only.
- **Tier 2 for invoices.** Chromium at scale is a hundred-container
  cluster; Tier 1 does one invoice in 30ms on a single worker.
- **Not embedding fonts.** Recipient renders with Arial → layout
  breaks; non-ASCII drops to `.notdef` glyph boxes.
- **Using `tagged: false` or omitting `doc.struct(...)`.** Produces an
  untagged PDF; accessibility tools cannot read it. Mandatory in EU
  per the European Accessibility Act 2025.
- **Float math for currency.** `0.1 + 0.2 ≠ 0.3`. Integer-minor only.
- **Recomputing the invoice total inside the renderer.** Source of
  subtle mismatch with the billing system. The renderer is a printer,
  not a ledger.
- **Per-render Chromium launch in Tier 2.** 800ms cold vs 60ms pooled.
  Launch once, `context.close()` per render.
- **Sharing a single `browser.newContext()` across renders.** Session
  bleeds between tenants; Cookies, `localStorage`, cache all carry.
- **Storing PDFs in the same bucket as user uploads with the same
  access policy.** PDFs are scoped to their recipient; don't expose
  to the broader uploads listing.
- **Long-lived signed URLs (>24h) for financial docs.** Rotate every
  hour; re-request via the app on demand. See
  [signed-urls.md](signed-urls.md).
- **PDF-render endpoint accepting arbitrary HTML.** The Tier 2 `url`
  must be an allowlisted internal template route — never accept
  user-controlled HTML strings (XSS → PDF → phish).
- **Not setting `CreationDate` deterministically.** Breaks content
  addressing; same input → different hash → cache miss.
- **Not `flatten()`-ing AcroForms on compliance docs.** Recipients
  edit the rendered values.
- **Leaking Playwright's `chromium --no-sandbox` without container
  isolation.** The container is the sandbox; running on the host
  unsandboxed is an RCE primitive.
- **Un-rate-limited PDF rendering endpoint.** One tenant DoS's the
  whole worker pool. 100/hr per tenant is a reasonable default.
- **Bundling 200 MB of fonts for 10 languages nobody uses.** Script-
  per-renderer opt-in; reject unsupported scripts explicitly.
- **Rendering >50 MB PDFs without streaming.** PDFKit streams; keep
  the worker memory bounded by writing directly to S3 multipart
  upload.
- **Catching render errors silently.** A failed render = a customer
  can't download their invoice. Sentry + page oncall on rate spikes.
- **No content-addressed cache.** Same invoice regenerated on every
  email re-send; ten times the S3 storage.
- **Using PDF 1.4.** PDF/UA-1 requires 1.7 minimum. Don't ship 1.4.
- **Password-protecting PDFs as the primary access control.** PDF
  passwords are trivially crackable; use signed URLs + server auth.
- **Embedding the full document source in the PDF metadata.** Leaks
  internal structure; keep `Creator`/`Producer` generic.
- **No audit event for PDF downloads.** Auditors + customers expect
  to see who downloaded what and when. See [audit-log.md](audit-log.md).
- **Omitting `lang` attribute on the document.** Screen readers
  mis-pronounce content; compliance fail.
- **Not running veraPDF / PAC3 in CI.** Accessibility regressions ship
  silently; by the time a user reports it, many PDFs are in the wild.

## References

- ADRs: [0019](../adr/0019-server-state-discipline.md),
  [0023](../adr/0023-observability-uuidv7.md),
  [0041](../adr/0041-uploads-tus-s3.md)
- Sibling recipes: [structured-emails.md](structured-emails.md),
  [payments.md](payments.md),
  [pricing-plans-changes.md](pricing-plans-changes.md),
  [billing-usage-metering.md](billing-usage-metering.md),
  [signed-urls.md](signed-urls.md),
  [gdpr-data-export.md](gdpr-data-export.md),
  [queue-workers.md](queue-workers.md),
  [observability.md](observability.md),
  [caching.md](caching.md),
  [audit-log.md](audit-log.md),
  [rate-limiting.md](rate-limiting.md),
  [secrets-management.md](secrets-management.md),
  [a11y-audit-runbook.md](a11y-audit-runbook.md)
- External: ISO 32000-2 (PDF 2.0 spec); ISO 14289-1 (PDF/UA-1);
  European Accessibility Act (Directive 2019/882) — mandatory 2025-06-28;
  WCAG 2.2 AA; PDFKit docs (pdfkit.org); pdf-lib docs (pdf-lib.js.org);
  Playwright PDF API docs; veraPDF validator; Adobe PAC3 (PDF
  Accessibility Checker); Matterhorn Protocol (PDF/UA checkpoints)
