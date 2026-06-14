# Search — Typesense default with Postgres-FTS escape + SSR-first results

Search is a UX surface that silently degrades: the first 100 rows
work fine with `ILIKE`, the next 10k crawl, and by the time a customer
asks "why doesn't search find X?" you have a latency + ranking +
typo-tolerance problem all at once. Retrofitting a proper search
engine onto a live app is a six-week project with dual-write
reconciliation. Getting the shape right at day one — even if the
initial implementation is Postgres FTS — is cheap.

This recipe picks **Typesense as default** (self-hostable,
typo-tolerant, faceted, sub-50 ms p95, Apache 2.0), codifies the
**SSR-first results-pre-render** contract so search pages hydrate
without re-fetching, defines the **indexing pipeline** as a
transactional-outbox pattern joined via [webhooks.md](webhooks.md) +
[audit-log.md](audit-log.md) discipline, and marks when to reach for
Algolia SaaS, MeiliSearch, or the Postgres-FTS escape.

Per [principles.md §2.2](../principles.md) (OWASP ASVS L2 — input
validation + query injection boundary) and
[ADR-0019](../adr/0019-structured-error-envelope.md) (structured
contracts), every search request is Zod-bounded, every result renders
through the a11y-checked `SearchResults` component, and every index
write is auditable.

## Related

- [schemas.md](schemas.md) — search query + filters carry a Zod
  schema; never pass raw strings through to the engine.
- [server-state.md](server-state.md) — search results use TanStack
  Query's `keepPreviousData` pattern for flicker-free pagination.
- [forms.md](forms.md) — search input form uses Superforms-lite for
  URL-bound state (not cross-field validation).
- [observability.md](observability.md) — `search.query.length`,
  `search.hits`, `search.latency_ms` bounded attributes; raw queries
  logged only with user-consent opt-in.
- [rate-limiting.md](rate-limiting.md) — per-user 60/min default,
  per-IP 120/min default bucket.
- [consent-management.md](consent-management.md) — search-query
  logging for ranking improvement requires functional-category
  consent.
- [audit-log.md](audit-log.md) — admin-executed searches (e.g.
  "search for user by email") are audit events.
- [webhooks.md](webhooks.md) — index-refresh via webhook-driven
  reconciliation for external data sources.
- [i18n-runtime-strategy.md](i18n-runtime-strategy.md) — per-locale
  analyzers (German stemming vs English vs Chinese segmentation).
- [principles.md §2.3](../principles.md) — WCAG 2.2 AA for the
  results list (semantic list, keyboard nav, SR-announced count).

## When to reach for what

```text
<10 k rows, dev-time toy, single-field LIKE                   → Postgres ILIKE (no recipe needed)
<100 k rows, 1-language, simple AND, admin tool              → Postgres FTS + tsvector
<5 M rows, multi-locale, typo-tolerant, faceted, <100ms p95   → Typesense (default)
>5 M rows, complex ranking, multi-tenant SaaS, burst traffic  → Typesense cluster OR Algolia
Geo-spatial primary (radius, polygon)                         → Typesense geo or PostGIS
Vector / semantic similarity                                  → Typesense hybrid OR pgvector
Full-text inside a document set (PDF, DOCX)                   → Tika + Typesense OR dedicated DAM
Site-search public SPA / marketing page                       → Algolia DocSearch (free for OSS) OR Pagefind
Multi-tenant code-search (millions of files)                  → Zoekt / Sourcegraph; outside scope
```

**Three build rules:**

1. **Default to Typesense.** Self-hostable, predictable RAM footprint
   (rule of thumb: 2-3× index size), typo-tolerance built-in, sub-50
   ms p95 on a single node for <5M rows. Apache 2.0 — no SaaS lock.
2. **Postgres FTS as escape only.** For small indexes where the
   operational simplicity of "it's just the database" wins. Migrate
   to Typesense when query patterns diversify (facets, ranking,
   typo-tolerance) — not when data grows.
3. **Algolia only when paying-SaaS is cheaper than operating
   Typesense cluster.** Typesense Cloud exists; always evaluate both.
   MeiliSearch is a reasonable alternative but smaller ecosystem.

## Build vs buy

| Option | Host | License | Typo-tolerance | Vector | Facets | Scale | Best for |
|---|---|---|---|---|---|---|---|
| **Typesense** | Self-host / Cloud | Apache 2.0 | ✅ built-in | ✅ hybrid | ✅ | <50M rows single-node | Default pick |
| **Algolia** | SaaS only | Commercial | ✅ | ✅ | ✅ | Unbounded | Enterprise / DocSearch-OSS |
| **MeiliSearch** | Self-host / Cloud | MIT / Commercial | ✅ | ✅ | ✅ | <10M rows | Simpler ops; smaller ecosystem |
| **OpenSearch** | Self-host / AWS | Apache 2.0 | ⚠️ plugin | ✅ | ✅ | Unbounded | Log-search heritage; complex |
| **Elasticsearch** | Self-host / Elastic Cloud | SSPL / Elastic | ⚠️ plugin | ✅ | ✅ | Unbounded | Legacy; avoid new greenfield |
| **Postgres FTS** | Self-host | PostgreSQL | ⚠️ via pg_trgm | ⚠️ pgvector | Manual | <500k rows comfortable | Small indexes; DB-simplicity wins |
| **pgvector** | Self-host | PostgreSQL | n/a | ✅ HNSW | Manual | <1M vectors | Vector-only; no BM25 |
| **Pagefind** | Static / prebuilt | MIT | ⚠️ minimal | ❌ | ❌ | Static sites | Marketing/docs sites |

## Install — Typesense default

```bash
# Server
pnpm add typesense

# Container
docker pull typesense/typesense:28.0
```

```bash
# Environment
TYPESENSE_HOST=search.internal
TYPESENSE_PORT=8108
TYPESENSE_PROTOCOL=http               # https in prod
TYPESENSE_API_KEY=…                   # admin key (server only)
TYPESENSE_SEARCH_KEY=…                # scoped search-only key
```

**Three key rules:**

1. **Admin vs search-only keys are split** — admin key never in
   client bundles, search-only key scoped per collection via
   `keys.create({ actions: ['documents:search'], collections: [...] })`.
2. **`collections/*` schema in code, not in dashboard.** Index schema
   lives next to the indexer; dashboard state drift is a support
   nightmare.
3. **Pin the server version.** Typesense ships changes between
   majors; schema migrations are your upgrade gate, not an auto-bump.

## Shape

```text
src/lib/search/
  schemas.ts                  # Zod: query params, filter shape, result shape
  client.ts                   # Typesense client (server-side)
  client-public.ts            # Typesense client (public, scoped key)
  collections.ts              # Collection schema definitions
  index/
    products.ts               # doc-mapping + upsert/delete
    users.ts                  # admin-only; scoped-key restricts
  ranking.ts                  # ranking rules per collection
src/routes/
  search/
    +page.server.ts           # SSR query → render with hits
    +page.svelte              # SearchForm + SearchResults
    [query]/+page.server.ts   # optional deep-link pattern
  api/search/+server.ts       # client-side incremental calls
```

## Collection schema

```ts
// src/lib/search/collections.ts
import type { CollectionCreateSchema } from 'typesense/lib/Typesense/Collections';

export const productsCollection: CollectionCreateSchema = {
  name: 'products',
  fields: [
    { name: 'id', type: 'string' },
    { name: 'title', type: 'string' },
    { name: 'description', type: 'string', optional: true },
    { name: 'tags', type: 'string[]', facet: true },
    { name: 'category', type: 'string', facet: true },
    { name: 'price_cents', type: 'int32', facet: true },
    { name: 'created_at', type: 'int64' },               // epoch sec, sortable
    { name: 'tenant_id', type: 'string', facet: true, index: true },
    { name: 'locale', type: 'string', facet: true },     // 'en' | 'de' | ...
    { name: 'popularity', type: 'int32' },               // ranking tiebreaker
  ],
  default_sorting_field: 'popularity',
  token_separators: ['-', '_', '/'],                     // split SKU-like tokens
  symbols_to_index: ['+', '.'],                          // keep C++ / .NET searchable
};
```

**Five schema rules:**

1. **`id` is a string, not an int.** Typesense indexes on string IDs;
   sourcing from UUIDv7 keeps time-sortable join keys per
   [observability.md](observability.md).
2. **`tenant_id` is always a facet + index.** Multi-tenant safety
   requires server-side filter-pinning (see below); unindexed tenant
   filters are slow and leak across tenants on misconfiguration.
3. **`locale` is a facet.** Per-locale queries + analyzers; never
   "search all locales + translate".
4. **`token_separators` per domain.** SKU search needs `-` / `_`
   splits; article-text doesn't. Tune per collection.
5. **Default sorting field is explicit.** "Relevance" is not a
   monotonic score — a tiebreaker field (popularity, recency)
   ensures stable results for identical relevance scores.

## Indexing pipeline — transactional outbox

The indexer is **not** a "write to DB, then write to Typesense"
pair. That pattern loses data when the second write fails. The
durable shape is a transactional outbox:

```text
DB write (product INSERT/UPDATE/DELETE) + outbox INSERT  ← same transaction
           ↓
outbox consumer (cron or queue) → Typesense upsert/delete
           ↓
outbox row marked processed (or retried with backoff)
```

```ts
// src/lib/search/index/products.ts
import type Typesense from 'typesense';

export async function indexProduct(
  client: Typesense.Client,
  product: Product,
): Promise<void> {
  const doc = {
    id: product.id,
    title: product.title,
    description: product.description ?? undefined,
    tags: product.tags,
    category: product.category,
    price_cents: product.priceCents,
    created_at: Math.floor(product.createdAt.getTime() / 1000),
    tenant_id: product.tenantId,
    locale: product.locale,
    popularity: product.popularity ?? 0,
  };
  await client.collections('products').documents().upsert(doc);
}

export async function deleteProduct(
  client: Typesense.Client,
  id: string,
): Promise<void> {
  try {
    await client.collections('products').documents(id).delete();
  } catch (err) {
    // 404 on delete is fine — the row may have been deleted already.
    if (!(err instanceof Typesense.Errors.ObjectNotFound)) throw err;
  }
}
```

**Six outbox rules:**

1. **Outbox row in same DB transaction as entity write.** If the DB
   commits, the index job is guaranteed to run eventually; if the DB
   rolls back, nothing to index.
2. **Consumer is idempotent.** A retried outbox row must not duplicate
   the index state. Typesense `upsert` is idempotent by document ID.
3. **Delete is swallow-404.** Re-processed deletions are normal.
4. **Backfill tool exists.** `pnpm search:reindex products` reads
   every product and upserts. Required for schema changes, new
   fields, corruption recovery. Never `curl DELETE /collections/X`
   in production without a backfill plan.
5. **Indexing lag is observable.** OTel gauge
   `search.index.lag_seconds` (max outbox row age unprocessed) + alert
   at >5 min.
6. **Schema migrations are explicit.** Adding a field is a new
   Typesense collection alias (`products_v2`) + re-index + alias flip
   + delete old. Never in-place-alter a live collection.

## SSR query — results-pre-render contract

```ts
// src/routes/search/+page.server.ts
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { searchClient } from '$lib/search/client';
import { SearchQueryParams } from '$lib/search/schemas';

export async function load({ url, locals }) {
  const parsed = SearchQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw error(400, 'invalid_query');

  const { q, page, perPage, category } = parsed.data;

  if (!q) return { q: '', hits: [], found: 0, page: 1, perPage };

  const start = Date.now();
  try {
    const results = await searchClient.collections('products').documents().search({
      q,
      query_by: 'title,description,tags',
      query_by_weights: '3,1,2',
      filter_by: [
        `tenant_id:=${locals.session?.tenantId ?? 'public'}`,
        category ? `category:=${category}` : null,
      ].filter(Boolean).join(' && '),
      facet_by: 'category,tags,price_cents',
      max_facet_values: 20,
      per_page: perPage,
      page,
      sort_by: '_text_match:desc,popularity:desc',
      typo_tokens_threshold: 1,
      num_typos: '2,1',                          // 2 typos / 1 typo beyond 4-char tokens
      highlight_full_fields: 'title,description',
      highlight_start_tag: '<mark>',
      highlight_end_tag: '</mark>',
      use_cache: true,                           // per-node cache; 60s TTL
      cache_ttl: 60,
    });

    return {
      q,
      hits: results.hits ?? [],
      found: results.found,
      page,
      perPage,
      facets: results.facet_counts ?? [],
      tookMs: Date.now() - start,
    };
  } catch (err) {
    // Failsoft: search outage should not 500 the page.
    console.warn('search_failed', { err });
    return { q, hits: [], found: 0, page, perPage, error: true };
  }
}
```

**Seven SSR rules:**

1. **Zod-validate every URL parameter.** `SearchQueryParams` bounds
   `q` (max 256 chars), `page` (1-100), `perPage` (1-50), `category`
   (enum). Raw strings from URL go through Zod first, then to
   Typesense.
2. **`filter_by` pins `tenant_id` server-side.** Always, regardless
   of client intent. Multi-tenant leakage through search is the #1
   preventable data breach; never trust the client to scope.
3. **`query_by_weights` codified.** Title > tags > description
   ranking is a product decision — document it in code, not in ops
   tuning.
4. **Highlight tags are `<mark>` not `<strong>`.** Semantic HTML for
   SR announce; trusted-types policy per
   [trusted-types.md](trusted-types.md) allows `<mark>` in search
   surfaces.
5. **`use_cache: true` with 60s TTL.** Typesense per-node cache is
   free performance for repeated queries; invalidated on indexer
   writes.
6. **Failsoft try/catch.** Search outage returns empty results with
   `error: true` flag; page renders, user sees "Search is temporarily
   unavailable" instead of a 500.
7. **Latency logged, query not.** `tookMs` + `hits.length` are
   observable. Raw `q` is logged only with opt-in per
   [consent-management.md](consent-management.md).

## Search-as-you-type (client pattern)

```svelte
<!-- src/routes/search/+page.svelte -->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { SearchResults } from '$lib/search/SearchResults.svelte';

  let { data } = $props();

  let q = $state(page.url.searchParams.get('q') ?? '');
  let debouncedQ = $state(q);
  let debounceTimer: ReturnType<typeof setTimeout>;

  $effect(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debouncedQ = q; }, 250);
    return () => clearTimeout(debounceTimer);
  });

  const query = createQuery({
    queryKey: () => ['search', debouncedQ],
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(debouncedQ)}`, { signal });
      if (!r.ok) throw new Error('search_failed');
      return r.json();
    },
    enabled: debouncedQ.length >= 2,
    placeholderData: (prev) => prev,      // flicker-free pagination
    initialData: data.q === debouncedQ ? data : undefined,
  });
</script>

<form method="GET" role="search" aria-label="Search products">
  <label for="q" class="sr-only">Search</label>
  <input
    id="q"
    name="q"
    type="search"
    bind:value={q}
    autocomplete="off"
    aria-describedby="search-count"
  />
</form>

<p id="search-count" aria-live="polite">
  {#if $query.data?.found !== undefined}
    {$query.data.found} result{$query.data.found === 1 ? '' : 's'}
  {/if}
</p>

<SearchResults hits={$query.data?.hits ?? []} />
```

**Five SAYT rules:**

1. **`role="search"` on the form + `<label>` on the input + `sr-only`
   label.** Screen readers announce the landmark and the field.
2. **`aria-live="polite"` on the count**, not on the list. The count
   is a meaningful summary; announcing every new hit would spam.
3. **Minimum query length 2.** Below that, the query is not useful
   and the server rate-limit bucket drains fast.
4. **`placeholderData: (prev) => prev`** keeps old results visible
   during new-query in-flight — the alternative is empty-flash that
   looks broken.
5. **`initialData` from SSR** avoids a re-fetch on hydrate when the
   SSR'd `q` matches. The sub-100 ms perceived-latency win.

## Multi-tenant safety — scoped API keys

For client-side search, generate a scoped key per session that
embeds the `tenant_id` filter — the client cannot escape the scope
even if it tries:

```ts
// src/routes/search/+page.server.ts or hook
const scopedKey = searchClient.keys().generateScopedSearchKey(
  TYPESENSE_SEARCH_KEY,
  {
    filter_by: `tenant_id:=${session.tenantId}`,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,  // 1-hour TTL
  }
);
return { scopedKey };
```

Client uses `scopedKey` instead of `TYPESENSE_SEARCH_KEY`. Any query
the client sends has the tenant filter server-enforced, regardless
of additional `filter_by` the client adds.

## Ranking + tuning

Ranking rules live in `ranking.ts`:

```ts
// src/lib/search/ranking.ts
export const PRODUCT_RANKING = {
  sort_by: '_text_match:desc,popularity:desc,created_at:desc',
  query_by_weights: '3,1,2',            // title, description, tags
  prefix: 'true,false,true',            // prefix-search for title+tags, not description
  num_typos: '2,1',
  typo_tokens_threshold: 1,
  drop_tokens_threshold: 1,             // drop tokens after this many no-match
};
```

**Four ranking rules:**

1. **Ranking is code, not tribal knowledge.** A PR-reviewed change to
   `ranking.ts` with before/after-query examples beats ops-tuned
   numbers.
2. **No per-user personalization at the search layer.** That's a
   recommendation system; search returns deterministic, cacheable,
   auditable results.
3. **Sort tiebreakers deterministic.** `_text_match:desc,popularity:desc`
   — never end in a field that can tie.
4. **A/B ranking changes through feature flags** per
   [feature-flags.md](feature-flags.md). Ranking change = cohort
   evaluation; don't flip for everyone at once.

## Observability

```ts
span.setAttributes({
  'search.collection': 'products',
  'search.query_length': q.length,       // bounded via URL length
  'search.hits': found,
  'search.page': page,
  'search.locale': locale,
  'search.tenant_id': tenantId,          // bounded by tenant count
  'search.latency_ms': tookMs,
  // NEVER: 'search.query': q (PII + unbounded cardinality)
});

metrics.searchLatency.record(tookMs, {
  collection: 'products',
  // No user-level labels
});
```

Dashboards:

- p50/p95/p99 latency per collection
- Zero-hit-rate (queries with `found: 0`) — product signal, ranking tuning needed
- Index-lag gauge (outbox oldest-row age)
- Typo-tolerance hit-rate (queries that matched via typo) — product signal

## Postgres FTS escape

When Typesense is overkill (admin tool, tiny dataset, no budget for
a search server), Postgres FTS covers:

```sql
-- Migration: add tsvector generated column
ALTER TABLE products ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX idx_products_search ON products USING gin(search_vector);
```

```ts
// src/lib/search/pg-fts.ts
export async function searchProducts(q: string, tenantId: string) {
  return db.selectFrom('products')
    .where('tenant_id', '=', tenantId)
    .where(sql`search_vector @@ websearch_to_tsquery('english', ${q})`)
    .orderBy(sql`ts_rank(search_vector, websearch_to_tsquery('english', ${q}))`, 'desc')
    .limit(50)
    .selectAll()
    .execute();
}
```

**Three FTS rules:**

1. **`websearch_to_tsquery` not `to_tsquery`.** Parses user-style
   queries (`foo -bar "exact phrase"`) safely; `to_tsquery` requires
   Postgres syntax and errors on user input.
2. **`setweight` codifies field ranking.** A-level > B-level > C-level
   — same ranking discipline as Typesense `query_by_weights`.
3. **GIN index mandatory.** Without it, FTS is a sequential scan
   that's slower than `ILIKE`.

Migration path: when FTS can no longer keep up (p95 > 200ms or you
need facets / typo-tolerance), re-provision the same shape above
with Typesense — the `SearchResults` UI + Zod schema + SSR contract
stay identical.

## Anti-patterns

- **Don't use `ILIKE '%…%'` in production.** Full-table scan on
  every search; the #1 "why is the app slow?" answer on apps with
  >10k rows.
- **Don't trust client-supplied `filter_by`.** Tenant filter must be
  appended server-side; scoped API keys for client-side calls.
- **Don't index PII fields unnecessarily.** Names and emails appear
  in `tsvector` indexes and Typesense collections; if searchable,
  they're exfiltratable via typo-search. Audit what's indexed.
- **Don't in-place-alter a live Typesense collection schema.**
  Alias-flip-delete is the only safe shape. In-place `update` on
  millions of docs is downtime.
- **Don't write to Typesense directly from a request handler.** Use
  the transactional outbox; a Typesense write outside a DB transaction
  diverges state on first failure.
- **Don't log raw user queries without consent.** "Search queries
  for ranking improvement" is a data-collection purpose with its own
  consent category (functional or analytics, depending on intent).
- **Don't skip ranking tiebreakers.** A pair of docs with identical
  `_text_match` scores returns in non-deterministic order across
  Typesense nodes — breaks pagination ("I saw X on page 2, now it's
  gone").
- **Don't attach the raw query as an OTel label.** Unbounded
  cardinality + PII. Log length, hits, latency; join via
  `correlation.id` to audit-opt-in query storage.
- **Don't build your own typo-tolerance on top of FTS.** `pg_trgm`
  is a reasonable partial solution but breaks down on non-Latin
  scripts. If typo-tolerance is a requirement, migrate to Typesense.
- **Don't mix search and recommendation.** Search is deterministic
  (same query → same results for same user); recommendation is
  personalized. Treating them as one is how "search returns things I
  didn't type" becomes a bug report.
- **Don't ship search without rate-limiting.** Card-testing-style
  scraping via search is real; 60/min-per-user + 120/min-per-IP via
  [rate-limiting.md](rate-limiting.md) is the baseline.
- **Don't share admin key with clients.** Search-only scoped key +
  per-session scoped key for tenant-filter enforcement.
- **Don't let zero-hit queries silently fail UX.** "No results"
  needs a suggestion ("try broader terms", facet-reset link, or
  recent-search history). Empty state is a product surface.
- **Don't forget keyboard nav.** Up/down moves selection within the
  results list, Enter opens, Esc clears — without this, the search
  page is SR-hostile.
- **Don't skip the SSR contract.** A client-only search page
  hydrates blank, then flashes results on data-load — Core Web Vitals
  CLS hit plus perceived sluggishness.

## References

- [ADR-0019 — Structured error envelope (boundary contracts)](../adr/0019-structured-error-envelope.md)
- [principles.md §2.2 — OWASP ASVS L2 (query-injection boundary)](../principles.md)
- [principles.md §2.3 — WCAG 2.2 AA](../principles.md)
- Sibling recipes: [schemas.md](schemas.md),
  [server-state.md](server-state.md),
  [forms.md](forms.md),
  [observability.md](observability.md),
  [rate-limiting.md](rate-limiting.md),
  [consent-management.md](consent-management.md),
  [audit-log.md](audit-log.md),
  [webhooks.md](webhooks.md),
  [i18n-runtime-strategy.md](i18n-runtime-strategy.md),
  [feature-flags.md](feature-flags.md),
  [trusted-types.md](trusted-types.md).
- Upstream docs:
  - Typesense documentation: <https://typesense.org/docs/>
  - Typesense scoped API keys: <https://typesense.org/docs/latest/api/api-keys.html#generate-scoped-search-key>
  - PostgreSQL FTS: <https://www.postgresql.org/docs/current/textsearch.html>
  - `websearch_to_tsquery`: <https://www.postgresql.org/docs/current/textsearch-controls.html>
  - MeiliSearch: <https://www.meilisearch.com/docs>
  - Algolia DocSearch: <https://docsearch.algolia.com/>
