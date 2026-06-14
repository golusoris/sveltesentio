# ADR-0003: Thin `@sveltesentio/forms` wrapping Superforms v2 + Zod v4 (+ optional Formsnap); plain-state pattern documented

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D40 in `.workingdir/research/decisions-needed.md`

## Context

Form usage is split across downstream apps: only arca ships Superforms v2 (and even arca hand-rolls 5+ routes instead of using it). revenge, subdo, Lurkarr all hand-roll load-save cycles with `$state` + mutations. Mandating Superforms would repel the 3 apps already working without it; dropping Superforms loses progressive enhancement + SSR form handling where apps do need it.

## Decision

Ship `@sveltesentio/forms` as a **thin** wrapper that re-exports Superforms v2 pinned with a Zod v4 adapter pre-wired and optional Formsnap bits-ui bindings. Also ship `docs/compose/forms.md` documenting the plain-`$state` load-save pattern as an equally valid path for simple forms. The wrapper does not force Superforms adoption.

## Alternatives considered

- **Mandate Superforms** — repels revenge/subdo/Lurkarr hand-rolled patterns; arca itself proves the adoption bar is too high.
- **felte** — no app uses it; no SvelteKit progressive-enhancement story matching Superforms.
- **Plain SvelteKit actions only, no framework module** — arca's existing Superforms investment + progressive-enhancement use cases go unserved.
- **Bundle Formsnap as mandatory** — Formsnap is a higher-level bits-ui binding; optional keeps adopter cost low.

## Consequences

**Positive**:
- Matches all four apps' actual behavior (progressive-enhancement path when wanted, plain `$state` when not).
- Zod v4 adapter wired once, consumers don't re-learn.
- Optional Formsnap re-export keeps the bits-ui path cheap.

**Negative / trade-offs**:
- Two documented paths = users must pick; docs/compose/forms.md must be clear about when each applies.
- Thin wrapper is still a maintained surface (pin matrix: Superforms × Zod × Formsnap).

**Documentation obligations**:
- `docs/compose/forms.md` — plain-state load-save pattern; when to reach for Superforms.
- `@sveltesentio/forms` AGENTS.md — pinned version matrix + adapter export map.

## Evidence

- `.workingdir/research/deepread-arca.md:15,39,48,78` — Superforms in deps but 5+ routes hand-roll; "must lower adoption bar".
- `.workingdir/research/deepread-revenge.md:207` — "NO Superforms, NO Formsnap. Hand-rolled forms with `$state` + TanStack Mutation".
- `.workingdir/research/deepread-lurkarr.md:113-135,318` — 5+ routes use load-save `$state` pattern, "No Superforms mandate".
- `.workingdir/research/deepread-subdo.md:28` — "NO Superforms" in subdo deps.
- `.workingdir/research/decisions-needed.md:238` — divergence row reconciliation: "Do NOT mandate Superforms. Document plain-state pattern + provide optional adapter".
- `.workingdir/research/decisions-needed.md:284` — user closure: thin Superforms wrapper + `docs/compose/forms.md` for plain-state.
