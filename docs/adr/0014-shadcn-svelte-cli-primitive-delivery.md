# ADR-0014: shadcn-svelte CLI as default primitive delivery; bits-ui + tailwind-variants documented as escape hatch

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D20 in `.workingdir/research/decisions-needed.md`

## Context

Primitive-layer adoption splits across downstream apps: only Lurkarr uses the shadcn-svelte CLI + official registry; subdo and revenge compose bits-ui directly with `tailwind-variants` + `clsx`; arca uses neither. shadcn-svelte is a **delivery mechanism** (copy-paste components) over bits-ui + melt-ui + tailwind-variants — not a runtime dependency. Matching the D112 (carousel) and D120 (charts) pattern of preferring shadcn's canonical wrappers gives one coherent authoring flow.

## Decision

Adopt `pnpm dlx shadcn-svelte@latest` as the default primitive delivery path for `@sveltesentio/ui`. Document the direct bits-ui + tailwind-variants composition as an escape hatch in `docs/compose/primitives-direct.md` for apps that want tighter control. subdo and revenge migrate to the shadcn CLI path on their next UI pass.

## Alternatives considered

- **bits-ui direct only** — loses shadcn-svelte's Tailwind 4 / oklch token bindings + copy-paste authoring speed; forces us to re-author wrappers shadcn already ships (Chart, Carousel, Sonner, Command).
- **melt-ui direct** — lower-level than bits-ui; no adopter; more boilerplate.
- **Skeleton UI** — no adopter; opinionated theming conflicts with oklch `@theme` direction (ADR-0006).
- **Custom primitive layer from scratch** — reinvents bits-ui + melt-ui.

## Consequences

**Positive**:

- Lurkarr's pattern is the default; subdo + revenge migrate with known delta.
- shadcn Chart (ADR-0013), Carousel (ADR-0012), Sonner (ADR-0007), Command all compose cleanly.
- Tailwind 4 `@theme` oklch tokens bind directly into shadcn's var-based theming.

**Negative / trade-offs**:

- subdo + revenge carry one-pass UI migration.
- "Copy-paste components" model means consumers own the code; upgrade story is manual.

**Documentation obligations**:

- `docs/compose/primitives-shadcn.md` — shadcn CLI onboarding, `components.json` conventions.
- `docs/compose/primitives-direct.md` — escape hatch: direct bits-ui + tailwind-variants recipe (subdo/revenge evidence).
- `@sveltesentio/ui` AGENTS.md — primitive-delivery policy.

## Evidence

- `.workingdir/research/deepread-lurkarr.md:16,47-53,69-81,310` — shadcn-svelte CLI + `components.json` + 33 ui directories; canonical reference.
- `.workingdir/research/deepread-revenge.md:16,202` — `bits-ui@^2.15.5` direct, "shadcn-svelte is a delivery mechanism, not a hard requirement".
- `.workingdir/research/deepread-subdo.md:23,67-72,144` — `bits-ui@2.17.3` + `tailwind-variants@3.2.2` direct composition.
- `.workingdir/research/deepread-arca.md:5` — "NO bits-ui, shadcn-svelte".
- `.workingdir/research/decisions-needed.md:237` — divergence row: "CLI adoption split: only Lurkarr uses the CLI; subdo + revenge consume bits-ui directly".
- `.workingdir/research/decisions-needed.md:217` — convergence row: "bits-ui as UI-primitive foundation" (3/4 apps).
- `.workingdir/research/decisions-needed.md:314` — user closure: "shadcn-svelte CLI as default; docs/compose/primitives-direct.md documents bits-ui + tailwind-variants escape hatch".
