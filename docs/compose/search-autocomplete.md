# `search-autocomplete.md` — instant-search autocomplete recipe for sveltesentio

Instant-search autocomplete (search-as-you-type, suggestions, recent
queries, keyboard-driven result navigation) composes on top of
[search.md](search.md) (Typesense default) plus a minimal
client-side wrapper with strict a11y invariants:
combobox + listbox pattern per WAI-ARIA APG, `aria-activedescendant`
for focus retention, debounced input (150ms), server-side ranking,
client-cached history per user, and a deterministic keyboard
contract (`↑`/`↓`/`Enter`/`Esc`) — per
[ADR-0019](../adr/0019-server-runtime-contract.md)
(server-runtime) and
[ADR-0031](../adr/0031-a11y-testing.md) (a11y).

**No wrapper package.** Autocomplete is UI-specific to each app and
dataset; wrapping it centrally would either force one rigid UI or
leak every per-app detail upward. Compose directly; share the Zod
contracts + keyboard patterns via this recipe.

## Related

- [search.md](search.md) — base Typesense backend + SSR pre-render
- [command-palette.md](command-palette.md) — sibling pattern
  (app-navigation commands, not data search)
- [data-tables.md](data-tables.md) — tabular result rendering when
  autocomplete expands into full results page
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — axe-core rules
  specific to combobox
- [ADR-0019](../adr/0019-server-runtime-contract.md)
- [ADR-0031](../adr/0031-a11y-testing.md)
- WAI-ARIA APG combobox pattern `www.w3.org/WAI/ARIA/apg/patterns/combobox/`

## When to use what — decision tree

```text
Global app commands (palette)                → command-palette.md (NOT this)
Free-text search of your data                → this recipe
Full results page (not live)                 → search.md + separate /search route
Filtering structured data in a table         → data-tables.md (column filter, not autocomplete)
Address / location lookup                    → this recipe + geocoder provider (e.g., Mapbox, algolia-places)
Entity picker inside a form                  → this recipe + Superforms field integration
```

## Install

`search-autocomplete` is recipe-only — it composes `$lib/server/search.ts`
(Typesense client from `search.md`) with two native primitives:
`<input>` + a custom `<ul role="listbox">` dropdown.

```bash
# already installed per search.md
pnpm add typesense
# no additional UI dependency; bits-ui Popover is optional for richer positioning
```

## Shape — bounded Zod contracts

```ts
// packages/search/src/schema.ts
import { z } from 'zod';

export const SearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(20).default(8),
  scope: z.enum(['all', 'products', 'articles', 'users']).default('all'),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SuggestionKind = z.enum([
  'product',
  'article',
  'user',
  'category',
  'query', // recent or popular query
]);
export type SuggestionKind = z.infer<typeof SuggestionKind>;

export const Suggestion = z.object({
  id: z.string().min(1).max(100),
  kind: SuggestionKind,
  label: z.string().min(1).max(200),
  secondary: z.string().max(200).optional(),
  href: z.string().refine((u) => u.startsWith('/'), {
    message: 'relative URLs only',
  }),
  highlights: z.array(z.object({
    field: z.string(),
    snippet: z.string().max(400),
  })).max(3).optional(),
});
export type Suggestion = z.infer<typeof Suggestion>;

export const SearchResponse = z.object({
  query: z.string(),
  took: z.number().int().nonnegative(), // ms
  suggestions: z.array(Suggestion).max(20),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

export const RecentQuery = z.object({
  q: z.string().min(1).max(200),
  at: z.string().datetime(), // ISO 8601
});
export type RecentQuery = z.infer<typeof RecentQuery>;
```

All boundaries — server response, localStorage history, outgoing
query — go through `.parse()` or `.safeParse()`. Untrusted input
never reaches the render path without validation.

## Reference — `+server.ts` endpoint

```ts
// src/routes/api/search/suggest/+server.ts
import { error, json } from '@sveltejs/kit';
import { typesense } from '$lib/server/search';
import { SearchQuery, SearchResponse, type Suggestion } from '@sveltesentio/search/schema';
import { rateLimit } from '$lib/server/rate-limit';

export const GET = async ({ url, locals, getClientAddress }) => {
  const parsed = SearchQuery.safeParse({
    q: url.searchParams.get('q') ?? '',
    limit: Number(url.searchParams.get('limit')) || undefined,
    scope: url.searchParams.get('scope') ?? undefined,
  });
  if (!parsed.success) throw error(400, { type: 'validation', detail: parsed.error.message });

  const { q, limit, scope } = parsed.data;

  await rateLimit({
    key: `search:${locals.userId ?? getClientAddress()}`,
    limit: 30,
    windowMs: 10_000,
  });

  const collections = scope === 'all'
    ? ['products', 'articles', 'users']
    : [scope];

  const t0 = performance.now();
  const results = await Promise.all(
    collections.map((c) =>
      typesense.collections(c).documents().search({
        q,
        query_by: 'name,title,description',
        per_page: limit,
        prefix: true,
        highlight_fields: 'name,title',
        snippet_threshold: 30,
      }),
    ),
  );
  const took = Math.round(performance.now() - t0);

  const suggestions: Suggestion[] = results.flatMap((r, i) =>
    r.hits!.map((h) => ({
      id: h.document.id as string,
      kind: collections[i].slice(0, -1) as Suggestion['kind'],
      label: (h.document.name ?? h.document.title) as string,
      secondary: h.document.description as string | undefined,
      href: `/${collections[i]}/${h.document.slug ?? h.document.id}`,
      highlights: h.highlights?.slice(0, 3).map((x) => ({
        field: x.field,
        snippet: x.snippet ?? '',
      })),
    })),
  );

  const response = SearchResponse.parse({
    query: q,
    took,
    suggestions: suggestions.slice(0, limit),
  });

  return json(response, {
    headers: {
      // private: cache per-user; no-store so transient results aren't kept
      'cache-control': 'private, no-store',
      'x-search-took': String(took),
    },
  });
};
```

Notes:

- **Rate-limit is mandatory.** Autocomplete fires on every keystroke
  — a bot can easily generate thousands of req/s. Per-user (or per-IP
  fallback) token bucket.
- **`Cache-Control: private, no-store`** — suggestions are
  user-contextual (permissions may filter results) and shouldn't be
  cached by shared intermediaries.
- **Never leak internal IDs.** `href` is a relative slug path; the
  backend resolves opaque `id` to a display path.

## Reference — `Autocomplete.svelte` combobox component

```svelte
<!-- $lib/components/Autocomplete.svelte -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { tick } from 'svelte';
  import type { Suggestion, SearchResponse } from '@sveltesentio/search/schema';

  type Props = {
    placeholder?: string;
    scope?: 'all' | 'products' | 'articles' | 'users';
    onselect?: (s: Suggestion) => void;
  };
  const { placeholder = 'Search…', scope = 'all', onselect }: Props = $props();

  let inputEl = $state<HTMLInputElement | null>(null);
  let q = $state('');
  let open = $state(false);
  let activeIndex = $state(-1);
  let items = $state<Suggestion[]>([]);
  let loading = $state(false);
  let requestSeq = 0; // guards against stale responses

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleFetch(query: string) {
    clearTimeout(debounceTimer);
    if (query.trim().length === 0) {
      items = [];
      open = false;
      return;
    }
    debounceTimer = setTimeout(() => void run(query), 150);
  }

  async function run(query: string) {
    const seq = ++requestSeq;
    loading = true;
    try {
      const url = new URL('/api/search/suggest', location.origin);
      url.searchParams.set('q', query);
      url.searchParams.set('scope', scope);
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(`search ${r.status}`);
      const body = (await r.json()) as SearchResponse;
      if (seq !== requestSeq) return; // superseded by newer input
      items = body.suggestions;
      open = items.length > 0;
      activeIndex = items.length > 0 ? 0 : -1;
    } catch (e) {
      console.warn('autocomplete fetch failed', e);
    } finally {
      if (seq === requestSeq) loading = false;
    }
  }

  function onInput(e: Event) {
    q = (e.currentTarget as HTMLInputElement).value;
    scheduleFetch(q);
  }

  function onKeydown(e: KeyboardEvent) {
    if (!open || items.length === 0) {
      if (e.key === 'ArrowDown' && q.length > 0) {
        scheduleFetch(q);
        return;
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        break;
      case 'ArrowUp':
        e.preventDefault();
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        break;
      case 'Home':
        e.preventDefault();
        activeIndex = 0;
        break;
      case 'End':
        e.preventDefault();
        activeIndex = items.length - 1;
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0) choose(items[activeIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        open = false;
        activeIndex = -1;
        break;
      case 'Tab':
        open = false;
        break;
    }
  }

  function choose(s: Suggestion) {
    onselect?.(s);
    q = s.label;
    open = false;
    activeIndex = -1;
    recordRecent(s.label);
  }

  function recordRecent(query: string) {
    try {
      const raw = localStorage.getItem('search:recent');
      const list = raw ? (JSON.parse(raw) as { q: string; at: string }[]) : [];
      const next = [
        { q: query, at: new Date().toISOString() },
        ...list.filter((r) => r.q !== query),
      ].slice(0, 10);
      localStorage.setItem('search:recent', JSON.stringify(next));
    } catch {
      // localStorage disabled or quota — non-fatal
    }
  }

  const listId = $derived(`autocomplete-list-${Math.random().toString(36).slice(2, 8)}`);
  const activeId = $derived(activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined);
</script>

<div class="relative w-full">
  <input
    bind:this={inputEl}
    type="search"
    role="combobox"
    aria-expanded={open}
    aria-controls={listId}
    aria-autocomplete="list"
    aria-activedescendant={activeId}
    autocomplete="off"
    autocorrect="off"
    spellcheck="false"
    {placeholder}
    value={q}
    oninput={onInput}
    onkeydown={onKeydown}
    onfocus={() => q.length > 0 && scheduleFetch(q)}
    class="w-full rounded border px-3 py-2 text-sm"
  />
  {#if open}
    <ul
      id={listId}
      role="listbox"
      class="absolute left-0 right-0 top-full z-10 mt-1 max-h-80 overflow-auto rounded border bg-white shadow-lg"
    >
      {#each items as s, i (s.id)}
        <li
          id={`${listId}-opt-${i}`}
          role="option"
          aria-selected={i === activeIndex}
          class="cursor-pointer px-3 py-2 text-sm hover:bg-neutral-50 aria-selected:bg-blue-50"
          onmousedown={(e) => {
            e.preventDefault();
            choose(s);
          }}
          onmouseenter={() => (activeIndex = i)}
        >
          <div class="font-medium">{s.label}</div>
          {#if s.secondary}
            <div class="truncate text-xs text-neutral-500">{s.secondary}</div>
          {/if}
        </li>
      {/each}
      {#if loading}
        <li class="px-3 py-2 text-xs text-neutral-500" aria-live="polite">
          Searching…
        </li>
      {/if}
    </ul>
  {/if}
</div>
```

Key details:

- **`role="combobox"` + `aria-expanded` + `aria-controls`** on input;
  **`role="listbox"`** on `<ul>`; **`role="option"` + `aria-selected`**
  on `<li>`. This is the WAI-ARIA 1.2 combobox pattern.
- **`aria-activedescendant`** (not `tabindex` on options) keeps DOM
  focus on the input while arrow keys traverse the list — SRs still
  announce each selected option.
- **`onmousedown` + `e.preventDefault()`** (not `onclick`) — prevents
  the input from losing focus during mouse selection, which would
  close the list before the click registers.
- **`autocomplete="off"` + `autocorrect="off"` + `spellcheck="false"`**
  — browser autofill competes with custom listbox and double-renders.
- **`requestSeq` guard** — arrow-key typing generates fast
  overlapping requests; without a sequence check, a stale slow
  response can overwrite a fresh fast one.
- **150ms debounce** — shorter than typical typing cadence (~200ms
  between keys), still fast enough to feel instant.

## Integrating recent queries + empty-state UX

```svelte
<script lang="ts">
  import { RecentQuery } from '@sveltesentio/search/schema';

  let recent = $state<{ q: string; at: string }[]>([]);

  $effect(() => {
    try {
      const raw = localStorage.getItem('search:recent');
      if (!raw) return;
      const parsed = z.array(RecentQuery).safeParse(JSON.parse(raw));
      if (parsed.success) recent = parsed.data;
    } catch {
      // ignore
    }
  });
</script>

{#if open && items.length === 0 && q.trim().length === 0 && recent.length > 0}
  <ul role="listbox">
    <li class="px-3 py-1 text-xs font-semibold text-neutral-500">Recent</li>
    {#each recent as r (r.q)}
      <li role="option" onmousedown={() => (q = r.q)}>{r.q}</li>
    {/each}
  </ul>
{/if}
```

Parse localStorage on mount; if someone tampers with it, `safeParse`
rejects and the recent list is empty rather than exploding.

## SSR-safe initial render

Autocomplete is client-only — the dropdown never renders during SSR
because it has no initial query. The `<input>` renders statically
with `value=""` so there's no hydration flash. `$effect` only runs
client-side; recent-query reads are deferred safely.

## Anti-patterns (24)

1. **No debounce** — each keystroke fires a request → server DoS +
   bandwidth waste + stale races.
2. **Debounce too long (>300ms)** — the input feels laggy; users
   perceive the app as slow.
3. **No `requestSeq` stale-response guard** — a slow early response
   arriving after a fast later one shows outdated results.
4. **Fetching on every `input` without minimum length** — empty
   input returns "all documents" flood.
5. **Rendering raw server HTML in suggestions** — XSS if `label` or
   `snippet` are user-generated. Treat all fields as plaintext or
   route highlights through DOMPurify.
6. **`role="listbox"` with `tabindex=0` on each option** — moves DOM
   focus to each option; screen readers announce role shifts
   incorrectly and arrow keys stop working. Use `aria-activedescendant`.
7. **Missing `aria-expanded`** — SR users never hear "expanded / 5
   options" → no awareness the dropdown exists.
8. **`onclick` instead of `onmousedown` on options** — input blur
   fires before click → dropdown closes → click lands on nothing.
9. **Not closing on `Escape`** — violates APG combobox keyboard
   contract.
10. **Not closing on `Tab`** — blocks users from tabbing out;
    breaks keyboard navigation.
11. **No arrow-key handling** — keyboard-only users can't select
    options. This is a WCAG 2.1.1 (Keyboard) failure.
12. **Rate limit absent** — an attacker types `aaaaaa…` in a tight
    loop and brings down Typesense + Postgres.
13. **`Cache-Control: public`** — per-user suggestions (permission-
    filtered) cached by CDN leak data across users.
14. **Returning internal IDs in `href`** — IDOR / enumeration
    vulnerabilities. Use slugs or signed opaque references.
15. **Storing recent queries in a cookie** — sent on every request,
    bloats headers, affects caching. localStorage is appropriate.
16. **Not validating localStorage on read** — tampered JSON crashes
    the component. Always `.safeParse()`.
17. **Highlighting without a consistent style** — inconsistent
    emphasis confuses users about why results match.
18. **Prefix-only search for substring queries** — Typesense
    `prefix: true` matches the start of words; users typing middle
    substrings get zero results. Consider `prefix: false` for
    exact-match scopes.
19. **No `took` timing exposure** — perf regressions invisible.
    Surface p50/p99 in observability per [observability.md](observability.md).
20. **Suggesting across scopes user lacks permission for** —
    filter by permission in the query, not post-render.
21. **Per-keystroke analytics events** — event-store flood; debounce
    analytics too or only fire on selection.
22. **Browser autocomplete overlapping the custom listbox** —
    `autocomplete="off"` and `role="combobox"` prevent this.
23. **Not restoring the query on Back/Forward navigation** — users
    expect their query preserved in history. Bind to `$page.url` or
    `replaceState`.
24. **Not de-duplicating suggestions across scopes** — the same
    product matched by name + description appears twice. De-dupe by
    `id` before rendering.

## References

- ADRs: [0019](../adr/0019-server-runtime-contract.md),
  [0031](../adr/0031-a11y-testing.md),
  [0001](../adr/0001-zod-v4.md)
- Sibling recipes:
  [search.md](search.md),
  [command-palette.md](command-palette.md),
  [a11y-audit-runbook.md](a11y-audit-runbook.md),
  [data-tables.md](data-tables.md),
  [observability.md](observability.md)
- Upstream:
  WAI-ARIA APG combobox pattern
  `www.w3.org/WAI/ARIA/apg/patterns/combobox/`,
  Typesense docs `typesense.org/docs`,
  Nielsen Norman "Autocomplete UX"
  `www.nngroup.com/articles/autocomplete-design/`.
