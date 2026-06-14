# ADR-0016: Keep thin `@sveltesentio/ui/toast` wrapper WITH preset-aware sizing

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D170 in `.workingdir/research/decisions-needed.md`

## Context

Lurkarr's `sonner/sonner.svelte:1-35` already composes `svelte-sonner` + `mode-watcher` + Lucide icons cleanly in 35 lines. The initial streamlining verdict was "downgrade to `docs/compose/toast.md`" because the composition is trivial and no cross-cutting invariant was yet committed. The user overrode that verdict by pre-committing to interface-type theming as a cross-cutting invariant: toast sizing must scale with `@sveltesentio/ui/preset-*` (desktop / 10-foot / handheld). That single invariant justifies a thin wrapper.

## Decision

Keep `@sveltesentio/ui/toast` as a **thin** wrapper (overrides initial streamlining recommendation). Ships: `svelte-sonner` re-export (ADR-0007 locked primitive) + `mode-watcher` theme binding + Lucide icons (loading/success/error/info/warning) + a preset-size hook that reads from the active `ui/preset-*` variant (`desktop` / `10-foot` / `handheld`). Pre-commits to interface-type theming direction ahead of D161/D162 locking.

## Alternatives considered

- **Downgrade to `docs/compose/toast.md`** — Lurkarr's 35-line recipe is already the proof of simplicity, but leaves preset-sizing unenforced. Every app would reimplement the size hook.
- **Bundle preset sizing into `@sveltesentio/ui` root** — spreads the concern across the package; toast-specific preset coupling is cleaner as a named sub-export.
- **Sonner upstream config only** — sonner does not expose preset-aware sizing as a first-class API.

## Consequences

**Positive**:
- Enforces interface-type theming invariant at the toast boundary (cannot be forgotten per-app).
- Lurkarr's composition pattern migrates in as the baseline.
- Preset-size hook binds to ADR-0014's shadcn-svelte / Tailwind 4 token pipeline.

**Negative / trade-offs**:
- Binds D162 + preset-* direction before those ADRs land — intentional pre-commit, but an amendment to this ADR is required if preset shape changes.
- Wrapper is still a maintained surface (sonner × mode-watcher × Lucide × preset).

**Documentation obligations**:
- `docs/compose/toast.md` — Toaster mount, position, richColors, closeButton, preset-size hook usage.
- `@sveltesentio/ui/toast` AGENTS.md — preset-size hook contract (input: preset token; output: `toast.Options` overrides for padding/font-size/max-width).
- Cross-link to ADR-0007 (primitive lock) and the future preset-* ADR.

## Evidence

- `.workingdir/research/deepread-lurkarr.md:149-160,322` — `sonner/sonner.svelte:1-35` composes sonner + mode-watcher + Lucide; initial "Downgrade to docs/compose" verdict.
- `.workingdir/research/deepread-arca.md:23,77,85` — arca toast usage clean; "arca is single-interface. Wait on revenge/Lurkarr" for preset theming.
- `.workingdir/research/decisions-needed.md:250` — initial streamlining verdict: "Downgrade to docs/compose. Revisit if `@sveltesentio/ui/preset-10foot` demands larger toasts".
- `.workingdir/research/decisions-needed.md:316` — user closure overriding streamlining: "Keep thin wrapper WITH preset-aware sizing ... Pre-commits to interface-type theming as a cross-cutting invariant — toast sizing scales with `ui/preset-*` (desktop / 10-foot / handheld). ... Binds D162 + preset-* direction ahead of those locks".
