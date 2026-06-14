# ADR-0007: `svelte-sonner` as toast primitive

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D26 in `.workingdir/research/decisions-needed.md`

## Context

Two downstream apps ship toasts — arca and Lurkarr — and both converge on `svelte-sonner`. revenge and subdo ship no toast layer today. shadcn-svelte itself delivers its `sonner` component as a `svelte-sonner` wrapper, making it the canonical choice inside the locked primitive stack.

## Decision

Adopt `svelte-sonner@^1.1.0+` as the single toast primitive for `@sveltesentio/ui`. Wrap it with preset-aware sizing in `@sveltesentio/ui/toast` (see ADR-0016) rather than exposing it raw; the underlying primitive itself is locked here.

## Alternatives considered

- **bits-ui Toast (if/when shipped)** — not currently a first-class bits-ui primitive; Lurkarr and arca already on sonner; no convergence case.
- **Custom toast built on `@floating-ui`** — reinvents sonner's stacking + keyboard + a11y without payoff.
- **Per-app ad-hoc alerts** (revenge's pattern today) — repels the cross-cutting preset-sizing invariant pre-committed in ADR-0016.

## Consequences

**Positive**:
- Matches 2/2 toast adopters and shadcn-svelte's own wrapper.
- Supports the preset-aware sizing invariant (handheld/desktop/10-foot) without library swap.
- mode-watcher + Lucide icon composition already proven in Lurkarr.

**Negative / trade-offs**:
- Single-upstream dependency; version pins must track sonner releases.
- Preset sizing work lives in our wrapper, not upstream.

**Documentation obligations**:
- `docs/compose/toast.md` — position, richColors, closeButton defaults.
- ADR-0016 covers the wrapper spec (preset-sized).

## Evidence

- `.workingdir/research/deepread-arca.md:23,77` — arca uses `svelte-sonner`; lock recommendation.
- `.workingdir/research/deepread-lurkarr.md:17,149-160,315` — `svelte-sonner@^1.1.0`, sonner.svelte composes Toaster + mode-watcher + Lucide in 35 lines.
- `.workingdir/research/decisions-needed.md:220` — convergence row: "svelte-sonner as toast" (2/2 adopters).
- `.workingdir/research/decisions-needed.md:295` — user closure: "shadcn-svelte itself wraps svelte-sonner for its `sonner` component — canonical in locked stack".
