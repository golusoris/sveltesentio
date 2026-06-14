# legal-pages.md — composition recipe

> **Terms of Service + Privacy Policy + Cookie Policy + DPA.** Legal
> surfaces in sveltesentio are **versioned, immutable, and
> acknowledgement-tracked** — not free-form CMS pages. A user who
> accepted ToS v3.2 on 2026-04-01 must be able to prove that exact
> wording later, and a material change must re-prompt for consent.
> Per [ADR-0023](../adr/0023-compliance-audit-log-contract.md) every
> acceptance is an append-only audit event; per
> [ADR-0034](../adr/0034-auth-cookie-and-csrf-contract.md) the
> cookie-policy revision is stored inside the consent record itself
> (not derived at render time). Non-logged-in pre-signup acceptance
> is tracked by anonymous id + session; post-signup the two rows are
> merged.

> **The legal department's contract.** Anything rendered under
> `/legal/*` is the **authoritative wording** — not marketing copy.
> If sales says "our Terms basically say X", legal owns the truth.
> That means legal pages are **not** A/B tested, **not** personalized,
> **not** geo-rewritten at runtime, and **not** editable without a
> version bump.

## Related

- [consent-management.md](consent-management.md) — cookie-consent banner
  stores the accepted cookie-policy **version**; this recipe is the
  authoring side, consent-management is the enforcement side
- [audit-log.md](audit-log.md) — every acceptance, revocation, or
  material change writes an audit event
- [account-deletion.md](account-deletion.md) — deletion-request UX
  cites the current Privacy Policy section on retention
- [gdpr-data-export.md](gdpr-data-export.md) — export manifest includes
  every ToS/Privacy version the user accepted + timestamp
- [i18n-runtime-strategy.md](i18n-runtime-strategy.md) — legal pages are
  per-locale; the English master version is canonical for disputes
- [internationalization-routing.md](internationalization-routing.md) —
  `/legal/*` is path-prefixed per locale with `hreflang`
- [markdown.md](markdown.md) — legal content is authored in
  `mdsvex` at build time (not runtime)
- [data-migrations.md](data-migrations.md) — acceptance records are
  never deleted; only tombstoned
- [ADR-0023](../adr/0023-compliance-audit-log-contract.md),
  [ADR-0034](../adr/0034-auth-cookie-and-csrf-contract.md)

## When to use what

```text
ToS / Privacy / Cookie Policy / DPA / Imprint     → versioned mdsvex under /src/legal/
                                                    This recipe.
Subprocessor list                                  → separate page, change triggers 30-day notice
Acceptable Use Policy                              → linked from ToS; same versioning
Marketing landing pages                            → NOT this recipe; regular CMS
FAQ                                                → regular content; not versioned
Help Center / Docs                                 → regular content; not versioned
Regional legal addenda (DPA per-country)           → sub-version of the canonical DPA
In-app disclosures (e.g. AI Act model card)        → NOT here; see ai-audit-hook.md
```

## Authoring model

```text
src/legal/
  terms/
    2025-06-01.md         ← effective date = filename
    2026-02-14.md         ← latest (material change: arbitration clause)
  privacy/
    2025-06-01.md
    2026-04-01.md         ← latest (material change: new subprocessor)
  cookies/
    2025-06-01.md
    2026-04-01.md         ← tied to privacy version if cookie categories shift
  dpa/
    2025-06-01.md
  imprint/
    current.md            ← not versioned; corporate data, updated in place
```

Each file begins with frontmatter:

```yaml
---
effectiveAt: '2026-04-01T00:00:00Z'
locale: 'en'
materialChange: true         # triggers re-consent prompt for existing users
summary: 'Added Tuta Mail as subprocessor for transactional email.'
supersedes: '2025-06-01'     # previous version filename
---
```

**`materialChange: true`** is the only switch that causes re-prompt.
Typo fixes set it to `false`; new clauses, new subprocessors, arbitration
changes, scope expansions all set it to `true`.

## Shape — bounded Zod for the acceptance record

```ts
// packages/auth/src/legal/types.ts
import { z } from 'zod';

export const LegalDoc = z.enum(['terms', 'privacy', 'cookies', 'dpa']);
export type LegalDoc = z.infer<typeof LegalDoc>;

export const LegalVersion = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Version must be YYYY-MM-DD filename stem');

export const Acceptance = z.object({
  subjectKind: z.enum(['user', 'anonymous', 'tenant-admin']),
  subjectId: z.string().min(1).max(128),
  doc: LegalDoc,
  version: LegalVersion,
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  acceptedAt: z.string().datetime({ offset: true }),
  // SHA-256 of the rendered-at-acceptance body. Proves exact wording later.
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  // Optional — anonymous session id before signup; merged on account creation.
  anonymousSessionId: z.string().optional(),
  // Remote IP is NOT stored here. The audit-log row stores it with its own
  // retention policy; this table is "did they accept" not "from where".
  userAgent: z.string().max(500).optional(),
});
export type Acceptance = z.infer<typeof Acceptance>;
```

The **body hash** is the key integrity primitive: the rendered HTML
at the moment of acceptance is hashed and stored. If the mdsvex file
is ever edited in place (it shouldn't be, but humans err), the hash
mismatch detects it.

## Reference pattern

### 1. Build-time render + hash pipeline

```ts
// scripts/build-legal.ts — runs in CI, writes src/legal/generated/manifest.json
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import { render as mdsvexRender } from 'mdsvex';

type Entry = {
  doc: 'terms' | 'privacy' | 'cookies' | 'dpa';
  version: string;
  locale: string;
  effectiveAt: string;
  materialChange: boolean;
  summary: string;
  bodyHash: string;
};

const manifest: Entry[] = [];
const root = 'src/legal';
for (const doc of ['terms', 'privacy', 'cookies', 'dpa'] as const) {
  for (const file of await readdir(`${root}/${doc}`)) {
    if (!file.endsWith('.md')) continue;
    const raw = await readFile(`${root}/${doc}/${file}`, 'utf8');
    const { data, content } = matter(raw);
    const rendered = await mdsvexRender(content);
    const bodyHash = createHash('sha256').update(rendered.code).digest('hex');
    manifest.push({
      doc,
      version: file.replace(/\.md$/, ''),
      locale: data.locale,
      effectiveAt: data.effectiveAt,
      materialChange: data.materialChange === true,
      summary: String(data.summary ?? ''),
      bodyHash,
    });
  }
}
await writeFile(`${root}/generated/manifest.json`, JSON.stringify(manifest, null, 2));
```

The manifest lands in the bundle at build time. Runtime code never
parses mdsvex sources directly; it reads the manifest for metadata
and imports the pre-compiled Svelte module for rendering.

### 2. Public legal route

```svelte
<!-- src/routes/legal/[doc=legalDoc]/[[version]]/+page.svelte -->
<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>{data.docTitle} · v{data.version}</title>
  <meta name="robots" content="index,follow" />
</svelte:head>

<article class="prose mx-auto py-12">
  <header>
    <h1>{data.docTitle}</h1>
    <p class="text-muted">
      Effective {data.effectiveAt.slice(0, 10)} · Version {data.version}
    </p>
    {#if data.isSuperseded}
      <aside role="note" aria-label="Archived version">
        This is an archived version. The current version is
        <a href="/legal/{data.doc}">here</a>.
      </aside>
    {/if}
  </header>

  {#await data.bodyModule then Body}
    <Body.default />
  {/await}

  <footer>
    <a href="/legal/{data.doc}/history">Version history</a>
    ·
    <a href="/legal/{data.doc}/diff/{data.previousVersion}">
      Diff vs {data.previousVersion}
    </a>
  </footer>
</article>
```

```ts
// src/params/legalDoc.ts — param matcher
import type { ParamMatcher } from '@sveltejs/kit';
export const match: ParamMatcher = (v) =>
  v === 'terms' || v === 'privacy' || v === 'cookies' || v === 'dpa';
```

**The archived-version banner is mandatory** — a regulator or a user
must be able to see that they are not reading the current wording.

### 3. Acceptance endpoint

```ts
// src/routes/api/legal/accept/+server.ts
import { json, error } from '@sveltejs/kit';
import { Acceptance, LegalDoc, LegalVersion } from '@sveltesentio/auth/legal';
import { manifest } from '$lib/legal/manifest';
import { insertAcceptance } from '$lib/db/legal';
import { writeAuditEvent } from '@sveltesentio/audit';
import { z } from 'zod';

const Input = z.object({
  doc: LegalDoc,
  version: LegalVersion,
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
});

export async function POST({ request, locals, getClientAddress }) {
  const raw = await request.json();
  const parsed = Input.safeParse(raw);
  if (!parsed.success) throw error(400, { message: 'invalid_input' });

  const entry = manifest.find(
    (e) =>
      e.doc === parsed.data.doc &&
      e.version === parsed.data.version &&
      e.locale === parsed.data.locale,
  );
  if (!entry) throw error(404, { message: 'legal_version_not_found' });

  const acceptance = Acceptance.parse({
    subjectKind: locals.user ? 'user' : 'anonymous',
    subjectId: locals.user?.id ?? locals.anonymousSessionId,
    doc: entry.doc,
    version: entry.version,
    locale: entry.locale,
    acceptedAt: new Date().toISOString(),
    bodyHash: entry.bodyHash,
    anonymousSessionId: locals.user ? locals.anonymousSessionId : undefined,
    userAgent: request.headers.get('user-agent') ?? undefined,
  });

  await insertAcceptance(acceptance);
  await writeAuditEvent({
    kind: 'legal.accepted',
    subjectId: acceptance.subjectId,
    payload: {
      doc: entry.doc,
      version: entry.version,
      bodyHash: entry.bodyHash,
      ip: getClientAddress(),
    },
  });
  return json({ ok: true });
}
```

### 4. Signup flow — pre-account acceptance

```svelte
<!-- src/routes/signup/+page.svelte — excerpt -->
<script lang="ts">
  import { manifest } from '$lib/legal/manifest';
  const currentTerms = $derived(
    manifest.find((e) => e.doc === 'terms' && e.locale === 'en'),
  );
  const currentPrivacy = $derived(
    manifest.find((e) => e.doc === 'privacy' && e.locale === 'en'),
  );
  let acceptedTerms = $state(false);
  let acceptedPrivacy = $state(false);
</script>

<form method="POST" use:enhance>
  <!-- ... email/password fields ... -->
  <label>
    <input type="checkbox" name="acceptedTerms" required bind:checked={acceptedTerms} />
    I agree to the
    <a href="/legal/terms" target="_blank" rel="noopener">
      Terms of Service (v{currentTerms?.version})
    </a>
  </label>
  <label>
    <input type="checkbox" name="acceptedPrivacy" required bind:checked={acceptedPrivacy} />
    I agree to the
    <a href="/legal/privacy" target="_blank" rel="noopener">
      Privacy Policy (v{currentPrivacy?.version})
    </a>
  </label>
  <input type="hidden" name="termsVersion" value={currentTerms?.version} />
  <input type="hidden" name="privacyVersion" value={currentPrivacy?.version} />
  <button disabled={!acceptedTerms || !acceptedPrivacy}>Create account</button>
</form>
```

The **version is submitted as a hidden field**. The server re-reads the
manifest, compares to what was submitted, and rejects if the user
submitted a stale version (e.g. opened the form five minutes before a
deploy flipped the manifest). That edge case is rare but fatal if
ignored — it produces acceptance records against versions that were
never actually displayed.

### 5. Re-prompt on material change

```ts
// src/hooks.server.ts — partial
import { manifest } from '$lib/legal/manifest';
import { getLatestAcceptance } from '$lib/db/legal';

export async function handle({ event, resolve }) {
  if (!event.locals.user) return resolve(event);

  const userLocale = event.locals.user.locale ?? 'en';
  const required: Array<'terms' | 'privacy'> = ['terms', 'privacy'];
  const stale: Array<{ doc: string; version: string; summary: string }> = [];

  for (const doc of required) {
    const latest = manifest.find((e) => e.doc === doc && e.locale === userLocale);
    if (!latest) continue;
    const acc = await getLatestAcceptance(event.locals.user.id, doc);
    if (!acc || (acc.version !== latest.version && latest.materialChange)) {
      stale.push({ doc, version: latest.version, summary: latest.summary });
    }
  }

  event.locals.pendingLegalAcceptance = stale;

  // If the route is anything other than /legal/*, /logout, or /api/legal/accept,
  // redirect to the re-prompt page.
  const pathname = event.url.pathname;
  const allow = pathname.startsWith('/legal/')
    || pathname === '/logout'
    || pathname === '/api/legal/accept';
  if (stale.length > 0 && !allow) {
    return new Response(null, {
      status: 303,
      headers: { location: '/legal/review' },
    });
  }

  return resolve(event);
}
```

**Only `materialChange: true` forces re-prompt.** A typo correction
bumps the version but leaves existing acceptances valid.

### 6. Version history + diff viewer

```svelte
<!-- src/routes/legal/[doc=legalDoc]/diff/[from]/+page.svelte -->
<script lang="ts">
  import { diffWords } from 'diff';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  const parts = $derived(diffWords(data.fromText, data.toText));
</script>

<article class="prose mx-auto">
  <h1>{data.docTitle} · diff v{data.from} → v{data.to}</h1>
  <p>
    <span aria-label="Removed">-</span> removed ·
    <span aria-label="Added">+</span> added
  </p>
  <pre class="legal-diff">
    {#each parts as part}
      {#if part.added}
        <ins>{part.value}</ins>
      {:else if part.removed}
        <del>{part.value}</del>
      {:else}
        <span>{part.value}</span>
      {/if}
    {/each}
  </pre>
</article>
```

The diff view is **publicly accessible without authentication** — it's
the audit trail that regulators and users expect. Do not gate it.

### 7. Imprint + subprocessor list

Imprint is **not versioned** — corporate data (legal entity name, VAT
id, registered address, company register) lives at
`src/legal/imprint/current.md` and is edited in place. Changes here
are board-level and do not require user re-acceptance.

Subprocessor list **is** versioned and **does** trigger a 30-day
notice (per DPA common wording):

```ts
// src/routes/api/legal/subprocessors/notify/+server.ts
import { enqueueEmail } from '@sveltesentio/mail';

export async function POST({ request, locals }) {
  if (!locals.user?.permissions.includes('legal:admin')) throw error(403);
  const { newSubprocessor, effectiveAt } = await request.json();
  const tenants = await listTenantsWithActiveDPA();
  for (const t of tenants) {
    await enqueueEmail({
      to: t.legalContactEmail,
      template: 'subprocessor-notice',
      data: { newSubprocessor, effectiveAt, tenantName: t.name },
      // 30-day notice requirement — send now even if effectiveAt is future.
    });
  }
  return json({ ok: true, notified: tenants.length });
}
```

### 8. Export — every acceptance is in the user's GDPR export

```ts
// packages/compliance/src/exporters/legal.ts
import { db } from '@sveltesentio/db';

export async function exportLegalAcceptances(userId: string) {
  const rows = await db
    .select()
    .from(legalAcceptance)
    .where(eq(legalAcceptance.subjectId, userId))
    .orderBy(desc(legalAcceptance.acceptedAt));
  return {
    category: 'legal-acceptances',
    rows: rows.map((r) => ({
      document: r.doc,
      version: r.version,
      locale: r.locale,
      acceptedAt: r.acceptedAt,
      bodyHash: r.bodyHash,
      archivedUrl: `https://example.com/legal/${r.doc}/${r.version}`,
    })),
  };
}
```

## A11y invariants

- Legal content uses real `<h2>`/`<h3>` headings with logical order; no
  skipped levels. Screen-reader users navigate by heading.
- Every `a` to an archived version has visible text plus an
  `aria-label` stating "archived".
- The re-prompt page is a single form, not a modal; modal legal prompts
  trap keyboard focus and fail WCAG 2.2 AA 2.4.3.
- Diff view uses `<ins>` and `<del>` elements — these carry semantic
  meaning to SRs and are announced.
- The acceptance checkbox is a real checkbox with a real label; never a
  `<div role="checkbox">` nor a styled button.

## Security invariants

- **Body hash at acceptance is non-negotiable.** Without it, a silent
  edit of the mdsvex source produces an invisible wording change with
  no audit trail.
- Acceptance rows are **immutable**. Never `UPDATE`; only `INSERT`.
  Revocation is a new row with `kind='revocation'` not a delete.
- `/legal/*` has `robots: index,follow` — **do not noindex legal
  pages** (regulators Google for ToS wording).
- The acceptance endpoint is CSRF-protected (see
  [csrf-double-submit.md](csrf-double-submit.md)) but **NOT**
  authenticated-only — anonymous pre-signup acceptance must work.
- Do not render legal text from a CMS field that marketing can edit.
  Authoring is via PR review → CI → build.
- Do not inline-translate legal text at runtime via an MT service —
  translations are commissioned and committed as separate versions.
- Legal pages are **not** A/B tested. Full stop.

## Testing

```ts
// tests/legal/acceptance.test.ts
import { test, expect } from 'vitest';
import { manifest } from '$lib/legal/manifest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import { render } from 'mdsvex';

test('every manifest entry hash matches the committed source', async () => {
  for (const entry of manifest) {
    const raw = await readFile(`src/legal/${entry.doc}/${entry.version}.md`, 'utf8');
    const { content } = matter(raw);
    const rendered = await render(content);
    const actual = createHash('sha256').update(rendered.code).digest('hex');
    expect(actual).toBe(entry.bodyHash);
  }
});

test('material-change versions reject stale acceptances', async () => {
  // ... seed acceptance at old version, bump material change, assert re-prompt fires
});
```

CI must fail if a legal manifest hash drifts from the source file —
that means someone edited in place.

## Anti-patterns

1. **Editing a committed legal file in place** — use a new
   `YYYY-MM-DD.md` file. Edits to existing files invalidate every
   prior acceptance.
2. **Storing legal text in a CMS/database** — authoring lives in
   source-controlled mdsvex. CMS is the wrong primitive.
3. **A/B testing ToS wording** — illegal in most jurisdictions;
   guarantees inconsistent acceptance records.
4. **Geo-personalizing legal wording at runtime** — per-region addenda
   are separate versioned documents, linked from the canonical page.
5. **Omitting `bodyHash`** — without it you cannot prove which wording
   the user accepted when the file inevitably drifts.
6. **`UPDATE`-ing an acceptance row** — immutable append-only.
7. **Using a modal dialog for re-prompt** — traps focus, fails a11y,
   users close it and appear accepted.
8. **Gating `/legal/*` behind login** — regulators and users must read
   them pre-signup.
9. **Adding `robots: noindex` to legal pages** — search indexing is a
   feature, not a leak.
10. **Renaming a file to "fix a typo in the filename"** — breaks all
    URLs to the archived version. File names are immutable once
    committed.
11. **Accepting without `materialChange` flag** — every new version
    must be explicitly flagged true/false; defaulting to either is
    wrong.
12. **Auto-translating legal text via LLM/MT** — translation is a legal
    commission, not a runtime transform.
13. **Using `innerHTML` to render legal content** — mdsvex compiles to
    Svelte; use the component form.
14. **Storing IP address on the acceptance row** — IP lives in
    audit-log with its own retention; don't duplicate.
15. **One combined "I accept everything" checkbox** — regulators in EU
    require granular acceptance for ToS vs Privacy.
16. **Omitting the link** — "By signing up you agree" without a
    clickable `/legal/terms` link is unenforceable.
17. **Hiding the "opened in new tab" behavior** — use
    `target="_blank" rel="noopener"` and say "opens in a new tab" in
    text for SR users.
18. **Not re-prompting on DPA change for tenant admins** — the DPA is
    accepted by the tenant-admin, not each user; re-prompt is scoped
    to tenant-admin role.
19. **Storing accepted version client-side only** (localStorage) —
    unauthenticated; every acceptance is a server row.
20. **Using same version string across docs** — each doc has its own
    version number; coupling causes spurious re-prompts.
21. **Forgetting anonymous → user merge at signup** — the pre-signup
    acceptance must be stitched to the new user id.
22. **Rendering the diff in-client from fetched sources** — use the
    server-rendered diff route; client-side fetch exposes source
    URLs and risks mismatched versions.
23. **Shipping a "current" symlink for the latest** — use the manifest.
    Symlinks break on Windows dev, in static export, and in some
    deploy targets.
24. **Putting the Imprint at `/legal/imprint/[version]`** — imprint is
    not versioned; keep it at `/legal/imprint`.
25. **Putting subprocessor list only in the DPA PDF** — it's a live
    list with 30-day change notice; render it as HTML too.

## References

- ADRs: [0023](../adr/0023-compliance-audit-log-contract.md),
  [0034](../adr/0034-auth-cookie-and-csrf-contract.md)
- Siblings: [consent-management.md](consent-management.md),
  [audit-log.md](audit-log.md),
  [account-deletion.md](account-deletion.md),
  [gdpr-data-export.md](gdpr-data-export.md)
- GDPR Art. 7 (conditions for consent), Art. 28 (processor terms),
  Art. 30 (records of processing)
- CCPA §1798.130 (notice at collection)
- EU Digital Services Act Art. 14 (T&C transparency)
