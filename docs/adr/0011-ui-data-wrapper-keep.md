# ADR-0011: Keep `@sveltesentio/ui/data` wrapper (DataTable<T> + TanStack Virtual + infinite-query preset)

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D167 in `.workingdir/research/decisions-needed.md`

## Context

Data-table needs split two ways. Lurkarr ships a generic `DataTable<T>` with column defs, full-text search, per-column sort, pagination — reused 3+ times across QueueImportsTab, QueueBlocklistTab, dedup. revenge has a repeated offset-based infinite-query pagination pattern across movies/TV/books/audiobooks/comics/photos/music/podcasts. arca has `@vincjo/datatables` in deps but hand-rolls filtering anyway. subdo has no tables. The cross-app pattern is real enough — and arca's hand-rolling is evidence the wrapper must stay lightweight, not opinionated.

## Decision

Keep `@sveltesentio/ui/data` as a wrapper that ships:

- Generic `DataTable<T>` with column defs, search, sort, pagination (modeled on Lurkarr).
- `@tanstack/svelte-virtual` integration for virtualized rows.
- Infinite-query preset matching revenge's offset-based pattern.
- Sort/filter utility helpers (non-opinionated, composable).

## Alternatives considered

- **Downgrade to `docs/compose/tables.md`** — Lurkarr reuses its generic 3+ times; dropping the wrapper forces each downstream to re-copy the generic.
- **Bundle `@vincjo/datatables`** — arca has it in deps and still hand-rolls; poor API fit signal.
- **Mandate TanStack Table** — heavier API; Lurkarr's generic is simpler and proven.

## Consequences

**Positive**:

- Lurkarr's 3× reuse migrates upstream on next pass.
- revenge's infinite-query preset ships once.
- `@tanstack/svelte-virtual` already in arca's stack (locked D25 elsewhere).

**Negative / trade-offs**:

- API must stay unopinionated or arca's hand-rolling pattern repeats.
- Two-concern wrapper (table + virtual + infinite) = pin matrix to maintain.

**Documentation obligations**:

- `docs/compose/data-tables.md` — when to use the wrapper vs hand-roll.
- `@sveltesentio/ui/data` AGENTS.md — column-def shape, virtualization opt-in, infinite-query preset.

## Evidence

- `.workingdir/research/deepread-lurkarr.md:85-90,314,320` — `DataTable<T>` at `DataTable.svelte:1-130`, used 3+ times; "KEEP `@sveltesentio/ui/data` wrapper (contra arca — two-way split)".
- `.workingdir/research/deepread-revenge.md:48,75,205` — `movies/+page.svelte:12-30` offset-based infinite-query; "Supports D167 keep wrapper. Replicable preset".
- `.workingdir/research/deepread-arca.md:15,46,83` — `@vincjo/datatables` present but unused; arca "hand-rolls filtering anyway".
- `.workingdir/research/decisions-needed.md:240` — divergence row: "Two-way split. Lurkarr evidence supports keeping wrapper".
- `.workingdir/research/decisions-needed.md:247` — streamlining verdict: "Keep wrapper (Lurkarr evidence)".
- `.workingdir/research/decisions-needed.md:299` — user closure.
