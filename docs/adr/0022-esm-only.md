# ADR-0022: ESM-only publish format

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D6 in `.workingdir/research/decisions-needed.md`

## Context

Dual ESM+CJS publishing doubles the output surface, complicates `exports` maps, and risks dual-package hazards (two instances of the same module in a graph). All downstream adopter apps ship ESM; SvelteKit itself is ESM-only. Node 24 supports ESM natively without flags.

## Decision

Every `@sveltesentio/*` package publishes ESM only:

- `"type": "module"` in `package.json`
- Single build output under `dist/` via `vite build --lib` (or `svelte-package` for Svelte-component packages)
- `"exports"` maps each sub-export to `.js` (+ `.d.ts`) only — no `"require"` conditions
- No `.cjs`, no `"main"` field without `"type": "module"`

## Alternatives considered

- **Dual ESM+CJS** — covers Jest-on-CJS users; none exist downstream and SvelteKit is ESM-only.
- **Node-subpath exports with CJS fallback** — same hazards; no current consumer requires CJS.
- **CJS-only** — non-starter for Svelte 5 + Vite.

## Consequences

**Positive**:
- Single build artefact per package; smaller publish, faster CI.
- `exports` map stays readable (one condition per path).
- No dual-package hazard class of bugs.

**Negative / trade-offs**:
- CJS consumers (if any appear) must use dynamic `import()` or bundler interop shims.
- Jest (CJS by default) would need ESM support configured; none of our test stack uses Jest (Vitest / Playwright only).

**Documentation obligations**:
- `AGENTS.md` §Build section documents ESM-only posture.
- Per-package `package.json` template enforces `"type": "module"` + missing `"main"`.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:51` — D6 pick.
- All downstream apps ship ESM (confirmed in deep-reads).
- SvelteKit 2 docs — ESM-only stance.
