# ADR-0002: `@lucide/svelte` new scope as default icon library; `@sveltesentio/ui/icons` pluggable for `@iconify/svelte` interop

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D23 in `.workingdir/research/decisions-needed.md`

## Context

Icon libraries diverge three ways across downstream apps: arca uses `@iconify/svelte` (universal set + MDI), subdo uses the **old** `lucide-svelte@1.0.1` scope (pre-consolidation), revenge + Lurkarr both use the **new** `@lucide/svelte@^0.561.0` scope. Lurkarr alone ships 54 `@lucide/svelte` imports. The framework needs one default plus a pluggable adapter for the `@iconify/svelte` path to avoid forcing arca to rewrite.

## Decision

Adopt `@lucide/svelte` (new scope) at `^0.561.0+` as the default icon set shipped/recommended by `@sveltesentio/ui`. Expose `@sveltesentio/ui/icons` as a thin pluggable indirection that accepts either Lucide or Iconify components so arca's `@iconify/svelte` continues to compose without patching. subdo migrates `lucide-svelte` → `@lucide/svelte` on next pass.

## Alternatives considered

- **Keep old `lucide-svelte` scope** — upstream abandoned the old scope; new scope is the maintained line.
- **`@iconify/svelte` as default** — only arca ships it; two apps already moved to `@lucide/svelte`. Iconify's runtime fetch model adds request latency vs Lucide's tree-shaken imports.
- **`phosphor-svelte`** — no app adopts it; another bespoke set without convergence evidence.
- **Framework-neutral SVG sprite** — pushes authoring burden to every app; loses tree-shaking + type surface.

## Consequences

**Positive**:

- Matches 2/4 adopter apps day one.
- Tree-shakable named imports — no icon-bundle bloat.
- Pluggable adapter keeps arca's Iconify-first authoring intact.

**Negative / trade-offs**:

- subdo carries a rename migration (`lucide-svelte` → `@lucide/svelte`).
- Pluggable adapter surface is API we now own.

**Documentation obligations**:

- `docs/compose/icons.md` — Lucide default, Iconify escape-hatch recipe, sizing tokens, a11y (`aria-hidden` vs `role="img"` + `aria-label`).
- Wrapper spec for `@sveltesentio/ui/icons` adapter boundary.

## Evidence

- `.workingdir/research/deepread-subdo.md:25` — `lucide-svelte 1.0.1 **OLD namespace**`.
- `.workingdir/research/deepread-revenge.md:17` — `@lucide/svelte@^0.561.0` new scope.
- `.workingdir/research/deepread-lurkarr.md:20,179-183` — `@lucide/svelte` 54 imports, "Lock `@lucide/svelte` new scope".
- `.workingdir/research/deepread-arca.md:19` — arca uses `@iconify/svelte` (universal + MDI).
- `.workingdir/research/decisions-needed.md:236` — divergence row: 3-way split.
- `.workingdir/research/decisions-needed.md:283` — user closure "newest lucide svelte is great".
