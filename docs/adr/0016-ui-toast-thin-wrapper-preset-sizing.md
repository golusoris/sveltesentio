# ADR-0016: Keep thin `@sveltesentio/ui/toast` wrapper WITH preset-aware sizing

- **Status**: Accepted
- **Date**: 2026-04-17
- **Amended**: 2026-11-18 (revisit check, #476)
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

- Binds D162 + preset-\* direction before those ADRs land — intentional pre-commit, but an amendment to this ADR is required if preset shape changes.
- Wrapper is still a maintained surface (sonner × mode-watcher × Lucide × preset).

**Documentation obligations**:

- `docs/compose/toast.md` — Toaster mount, position, richColors, closeButton, preset-size hook usage.
- `@sveltesentio/ui/toast` AGENTS.md — preset-size hook contract (input: preset token; output: `toast.Options` overrides for padding/font-size/max-width).
- Cross-link to ADR-0007 (primitive lock) and the future preset-\* ADR.

## Evidence

- `.workingdir/research/deepread-lurkarr.md:149-160,322` — `sonner/sonner.svelte:1-35` composes sonner + mode-watcher + Lucide; initial "Downgrade to docs/compose" verdict.
- `.workingdir/research/deepread-arca.md:23,77,85` — arca toast usage clean; "arca is single-interface. Wait on revenge/Lurkarr" for preset theming.
- `.workingdir/research/decisions-needed.md:250` — initial streamlining verdict: "Downgrade to docs/compose. Revisit if `@sveltesentio/ui/preset-10foot` demands larger toasts".
- `.workingdir/research/decisions-needed.md:316` — user closure overriding streamlining: "Keep thin wrapper WITH preset-aware sizing ... Pre-commits to interface-type theming as a cross-cutting invariant — toast sizing scales with `ui/preset-*` (desktop / 10-foot / handheld). ... Binds D162 + preset-\* direction ahead of those locks".

## Amendment 2026-11-18: revisit check

- **Triggers checked**: Re-evaluated on `origin/main` at commit `a4b69b8` (issue #476) against two conditions of this record: the revisit condition in the Evidence section (whether `@sveltesentio/ui/preset-10foot` demands larger toasts) and the Consequences bullet that requires an amendment if the preset shape changes.
- **Verdict**: Decision stands; the thin wrapper with preset-aware sizing still earns its place, because `svelte-sonner` still lacks a first-class sizing API (`packages/ui/src/toast/preset.ts:2-6`) and remains the locked toast primitive under ADR-0007 (`docs/adr/0007-svelte-sonner-toast-primitive.md:14`). The shipped helper computes the 10-foot sizing demand: `toastPreset()` (`packages/ui/src/toast/preset.ts:65-89`) maps an `InterfaceType` or `InterfacePreset` to `position`, `width`, `gap`, `offset`, and `style`; the `10foot` preset receives `top-center` placement (`packages/ui/src/toast/preset.ts:38`) and `40rem` width (`packages/ui/src/toast/preset.ts:46`), padding, gap, and offset scale with `preset.spacingScale` (`packages/ui/src/toast/preset.ts:69-72`), and `preset.minTargetSize` is emitted as `--toast-min-target-size` (`packages/ui/src/toast/preset.ts:86`). The helper does not yet deliver that sizing to the toast; see the next bullet.
- **Delivery gap (found in review on 2026-11-21, #643)**: `svelte-sonner` 1.2.1 types `toastOptions.style` as a string (`svelte-sonner/dist/types.d.ts:269`), while `ToastPreset.style` is an object map (`packages/ui/src/toast/preset.ts:31`), so the documented `toastOptions={{ style: p.style }}` (`packages/ui/src/toast/index.ts:14`) applies no preset property; that example also omits `offset`. Passed as a string, only `--width` and `--border-radius` are read: `svelte-sonner` hard-codes toast padding and font size (`svelte-sonner/dist/Toaster.svelte:632,639`), and nothing reads `--toast-padding`, `--toast-gap`, `--font-size`, or `--toast-min-target-size`, so the WCAG 2.2 AA target-size floor for toast actions is not enforced. The reproduction in #643 mounts a real `<Toaster>` and shows both cases. Until #643 lands, the sizing invariant is stated by the helper but not met.
- **Preset shape changed (amendment cause)**: Presets ship as a single `@sveltesentio/ui/presets` sub-export (`packages/ui/package.json:98-101` exports `./presets`; `packages/ui/src/presets/index.ts:7` defines `InterfaceType` as `desktop`, `10foot`, `handheld`, and `dashboard`), landed in commit `d51d81e` (2026-06-14), rather than separate `ui/preset-*` sub-exports. `dashboard` (`packages/ui/src/presets/index.ts:59-67`) is a fourth interface type alongside the three named in the original record, and ADR-0047 (`docs/adr/0047-per-interface-presets.md:14-23`) is the preset record.
- **Shipped scope**: The runtime surface is narrower than the Decision section: `@sveltesentio/ui/toast` exports only `toastPreset` and the types `ToastPreset` and `ToastPosition` (`packages/ui/src/toast/index.ts:18-19`). It does not re-export `svelte-sonner`, bind `mode-watcher`, or bundle Lucide icons; the consuming app imports `svelte-sonner` and must pass the preset output to `<Toaster>` itself (`packages/ui/src/toast/index.ts:10-15`, `packages/ui/AGENTS.md:35`). Nothing at the toast boundary enforces this: an app can mount `svelte-sonner` without calling `toastPreset()`. The helper owns the values for the record's one cross-cutting invariant (toast sizing scales with the interface preset); applying them is an app integration requirement, and theme binding and icons remain app composition.
- **Stale guide**: `docs/compose/toast.md` still describes the fuller wrapper, with a `<Toaster>` export from `@sveltesentio/ui/toast` and sizing through `:root[data-preset]`, neither of which ships; #622 tracks rewriting it to the surface above.
- **Next revisit**: Revisit when `InterfaceType` (`packages/ui/src/presets/index.ts:7`) gains a new type, `svelte-sonner` ships preset-aware sizing upstream, the `@sveltesentio/ui/presets` export shape (`packages/ui/package.json:98-101`) changes again, or #643 changes the `ToastPreset` shape; when #643 lands, re-check that the preset sizing reaches a mounted toast.
