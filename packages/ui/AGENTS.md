# @sveltesentio/ui — AGENTS.md

> Design system, primitive delivery, tokens, and interface-type presets. Phase 3 per [.workingdir/PLAN.md](../../.workingdir/PLAN.md).

## Scope

Three orthogonal jobs, each a sub-export:

| Sub-export  | Purpose                                                                                                                                      | Canonical ADRs                                                                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`         | Tailwind 4 preset, oklch design tokens, shadcn-svelte CLI wrapper                                                                            | [ADR-0005](../../docs/adr/0005-tailwind-4-with-vite-plugin.md), [ADR-0006](../../docs/adr/0006-oklch-only-color-tokens.md), [ADR-0014](../../docs/adr/0014-shadcn-svelte-cli-primitive-delivery.md) |
| `./presets` | `preset-{desktop,10foot,handheld,dashboard}` Tailwind `@theme` fragments — override spacing / font-size / control heights per interface type | [ADR-0047](../../docs/adr/0047-per-interface-presets.md)                                                                                                                                            |
| `./tokens`  | oklch palette + typography + radii + semantic layer tokens; compile-time `@theme` default + runtime cookie override + user-customiser opt-in | [ADR-0046](../../docs/adr/0046-three-tier-theming.md), [ADR-0050](../../docs/adr/0050-tenant-theming-minimal-skeleton.md)                                                                           |

Thin wrappers that live here (justified per the **preset theming invariant**, not as generic streamlining wraps):

| Wrapper                                                                    | Justification                                                         | ADR                                                                                                                                                                                        |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ui/data` — `DataTable<T>` + TanStack Virtual + infinite-query preset      | Composes 3+ libs; bakes in ARIA grid semantics                        | [ADR-0011](../../docs/adr/0011-ui-data-wrapper-keep.md), [ADR-0024](../../docs/adr/0024-tanstack-virtual-a11y-wrapper.md)                                                                  |
| `ui/cmd` — shadcn Command + registry + tinykeys                            | Preset-aware sizing per interface type                                | [ADR-0015](../../docs/adr/0015-ui-cmd-thin-wrapper.md), [ADR-0025](../../docs/adr/0025-bits-ui-command-supersedes-cmdk-sv.md)                                                              |
| `ui/toast` — svelte-sonner + preset-aware sizing                           | Preset-aware sizing per interface type                                | [ADR-0016](../../docs/adr/0016-ui-toast-thin-wrapper-preset-sizing.md), [ADR-0007](../../docs/adr/0007-svelte-sonner-toast-primitive.md)                                                   |
| `ui/icons` — `@lucide/svelte` default + pluggable `@iconify/svelte` loader | Cross-cutting icon strategy                                           | [ADR-0002](../../docs/adr/0002-lucide-svelte-default-icons.md)                                                                                                                             |
| `ui/markdown` — marked + DOMPurify sink                                    | Enforces OWASP ASVS L2 `innerHTML` boundary                           | [ADR-0026](../../docs/adr/0026-markdown-runtime-build-split.md)                                                                                                                            |
| `ui/chart` — a11y wrapper over LayerChart Chart + uPlot escape hatch       | `role="img"` + `<title>`/`<desc>` + off-screen table + reduced-motion | [ADR-0013](../../docs/adr/0013-layerchart-charts-with-uplot-escape-hatch.md)                                                                                                               |
| `ui/theme-toggle` / `ui/theme-customizer` / `ui/font-preset-*`             | Theming tiers per ADR-0046                                            | [ADR-0046](../../docs/adr/0046-three-tier-theming.md), [ADR-0048](../../docs/adr/0048-cookie-backed-dark-mode.md), [ADR-0049](../../docs/adr/0049-system-font-default-fontsource-optin.md) |

Primitives **not** wrapped (use shadcn-svelte CLI directly or escape-hatch to bits-ui): Dialog, Sheet, DropdownMenu, Popover, Tooltip, Accordion, Tabs, Select, Combobox — install via `pnpm dlx shadcn-svelte add <component>` per the `/add-shadcn` skill.

## Landed wrapper models (v0.2.0)

Each wrapper splits **pure, unit-tested logic** (`.ts`) from a **thin component** (`.svelte`, tsc/lint-clean, untested in vitest per repo precedent — runes/components need the Svelte compiler). Primitives are **optional peers**; the pure models and default components run without them.

| Sub-export | Pure (tested)                                                                                                                                                                                          | Component (thin)                                                                                                                                  | Optional peer              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `./toast`  | `toastPreset(interfaceType)` → `{ position, width, style }` keyed to the interface presets; padding scales with `spacingScale`, min-target-size flows through (ADR-0016)                               | — (re-export `svelte-sonner` in app)                                                                                                              | `svelte-sonner`            |
| `./data`   | `computeRows` (filter→sort→paginate), `toggleSort`/`setFilter`/`setPageSize`/`setPageIndex` reducers, `computeVirtualWindow` (visible-window math), `nextFocusIndex` (roving keys)                     | `DataTable.svelte`, `VirtualList.svelte` — `role=grid`/`row`/`gridcell`, `aria-rowcount`/`aria-colcount`, 1-based `aria-rowindex` (ADR-0011/0024) | `@tanstack/svelte-virtual` |
| `./cmd`    | `CommandRegistry` (immutable register/unregister), `scoreCommand`/`searchCommands` (exact>prefix>substring>keyword>fuzzy ranking), `parseBinding`/`matchesShortcut`/`resolveKeymap` (`$mod`→Meta/Ctrl) | `CommandPalette.svelte` — combobox/listbox + `aria-activedescendant` (ADR-0025)                                                                   | `bits-ui`, `tinykeys`      |

ARIA contract (ADR-0024): `aria-rowcount`/`aria-colcount` reflect the **full** filtered dataset, not the rendered page; `aria-rowindex` is 1-based and stable across scroll. The shadcn-svelte `Command` primitive is the CLI-delivered escape hatch — `CommandPalette.svelte` is a standalone default driven by the same registry.

## Invariants

- **Tailwind 4 only** — v3 configs rejected at build time. `@tailwindcss/vite` plugin; no `tailwind.config.js`.
- **oklch colors only** — no HSL / RGB / hex in tokens. Matches LayerChart v2-next + shadcn-svelte output.
- **mode-watcher @ ^1.1.0 <2** — runes-native. `mode-watcher@0.5` is a pre-runes antipattern (flagged in downstream-antipatterns-v0.1.md revenge row).
- **Logical properties in RTL-capable components** — `ms-*` / `me-*` / `ps-*`, not `ml-*` / `mr-*`. Eslint warn on physical properties in new code.
- **Per-preset target size ≥ 44 × 44 CSS px on touch / TV** — `preset-10foot` and `preset-handheld` enforce this via token.
- **axe-core clean on every exported component** — runs via `vitest-axe` unit + `@axe-core/playwright` e2e. [ADR-0031](../../docs/adr/0031-a11y-testing-lane.md).

## Primitive-delivery rules

- Primitives come from **shadcn-svelte CLI** (source in your repo) by default. Never re-export a primitive from this package.
- Escape hatch to `bits-ui` is documented in `docs/compose/bits-ui-direct.md` (build as needed).
- `cmdk-sv` is banned (ADR-0025) — migrate any residual use to `bits-ui` Command via `ui/cmd`.

## Skills

- `/add-shadcn` — canonical way to add a primitive.
- `/add-storybook` — add a Storybook story for a component.

## Test policy

- Component tests via Testing Library + Vitest + `vitest-axe`.
- Visual + interaction stories in Storybook (`apps/storybook`, `@storybook/addon-a11y`).
- Playwright a11y lane lives in `@sveltesentio/testing` (not here).
- 70 % coverage floor; higher for primitives consumed by auth / forms surfaces.

## Common tasks

| Task            | Command                                                 |
| --------------- | ------------------------------------------------------- |
| Typecheck       | `pnpm --filter @sveltesentio/ui typecheck`              |
| Unit tests      | `pnpm --filter @sveltesentio/ui test`                   |
| Storybook dev   | `pnpm --filter @sveltesentio/storybook storybook`       |
| Storybook build | `pnpm --filter @sveltesentio/storybook build-storybook` |

## Related

- [docs/ux-principles.md](../../docs/ux-principles.md) — interface-type paradigms (dashboard, media, form, doc-centric, spatial-graph).
- [docs/principles.md](../../docs/principles.md) §2 — project-wide invariants (ASVS L2, WCAG 2.2 AA, runes-first).
- Root [AGENTS.md](../../AGENTS.md) — framework-wide conventions.
