# docs/upstream — pinned upstream documentation snapshots

Version-pinned API reference snapshots for AI coding assistants (Claude Code, Cursor, Aider, Codex, Continue) — and human readers who want zero-network context.

## Why this exists

Public documentation can drift ahead of (or behind) the version `sveltesentio` actually pins. AI agents that consult live docs frequently suggest API patterns that do not exist at the pinned version (legacy stores instead of runes, Tailwind 3 directives instead of Tailwind 4 `@theme`, Zod v3 `.parse()` patterns instead of v4, etc.). These snapshots are the curated API surface at the version we ship.

Each subdirectory holds one library, with a single `README.md` summarising:

- pinned version + canonical link
- the highest-value API surface (the parts AI agents most often hallucinate)
- the `@sveltesentio/*` package(s) that consume it
- pointers to the relevant ADR + compose recipe(s) when applicable

Snapshots are **hand-curated**, not full doc dumps. Length target: 50–100 lines. If a snapshot grows past ~150 lines it is doing too much — split or trim.

## Index

| Library | Pinned version | Snapshot | Consumed by |
|---|---|---|---|
| Svelte 5 runes | 5.55.4 | [svelte-runes/](svelte-runes/) | every package |
| SvelteKit | 2.x | [sveltekit/](sveltekit/) | `@sveltesentio/{core,realtime,auth,...}` |
| Tailwind CSS | 4.x | [tailwind/](tailwind/) | `@sveltesentio/ui` |
| Zod | 4.x | [zod/](zod/) | `@sveltesentio/{forms,core}` |
| TanStack Svelte Query | 5.x | [tanstack-query/](tanstack-query/) | `@sveltesentio/query` |
| Paraglide | 2.x | [paraglide/](paraglide/) | `@sveltesentio/i18n` |

Additional snapshots are added as packages reach the wiring stage; see the [PLAN.md](../../.workingdir/PLAN.md) milestone schedule.

## Refresh strategy

1. **Triggered refresh.** When bumping a pinned dependency, the same PR refreshes the relevant snapshot. The bump and the doc update land together — never lag.
2. **Periodic check.** A weekly GitHub Actions cron (see [`.github/workflows/refresh-upstream-docs.yml`](../../.github/workflows/refresh-upstream-docs.yml)) compares each snapshot's pinned version against the latest published version on npm and opens (or updates) a single tracking issue when drift exists. The cron does **not** rewrite snapshots — humans curate.
3. **Verification.** Each snapshot is reviewed against the canonical docs link at the pinned version during release-prep for `v<MAJOR.MINOR>.0`. Stale snapshots are a release blocker.

## Conventions

- **Frontmatter** on each snapshot: `pinned-version`, `canonical-url`, `last-verified` (ISO date).
- **Sections** in fixed order: pinned header · highest-value API surface · `sveltesentio` usage · gotchas (only those AI agents commonly miss) · canonical link.
- **No prose summaries.** Code examples first; one-line annotations next to them. AI agents skim code blocks faster than narrative.
- **No upstream changelogs duplicated.** Link out for changelog; only summarise breaking changes that affect a pinned-version consumer.

## Adding a new snapshot

1. Create `docs/upstream/<library>/README.md` following the conventions above.
2. Add a row to the [Index](#index).
3. Wire the relevant `@sveltesentio/*` package's `AGENTS.md` "Related references" section to point at the snapshot.
4. If a hook in `.claude/hooks/` should auto-load this snapshot when an agent edits the relevant file type, add the hook entry.
