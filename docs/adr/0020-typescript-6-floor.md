# ADR-0020: TypeScript 6 internal floor; `>=5.5 <7` published peerDep

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D7 in `.workingdir/research/decisions-needed.md`

## Context

TypeScript 6 landed stable performance + type-narrowing improvements (const-type-parameter inference, stricter exhaustiveness). The root of `sveltesentio/` already pins `typescript@^6.0.3` internally. Consumers range from TS 5.5 (stable shadcn-svelte floor) through TS 6 (latest). Publishing a TS-6-only peerDep forces every downstream app to upgrade on the same tick as consuming any sveltesentio package.

## Decision

- **Internal toolchain**: `typescript@^6` (unchanged).
- **Published peerDep** on every `@sveltesentio/*` package: `"typescript": ">=5.5 <7"`.
- Drop support window stays six months behind TypeScript latest majors (annually revised).

## Alternatives considered

- **Ship TS 6 peerDep only** — forces revenge/arca/subdo/Lurkarr to bump in lockstep; no upside for sveltesentio consumers still on 5.x.
- **Ship TS 5 peerDep** — leaves the framework itself straddling two major versions of `.d.ts` emit; doubles regression surface.
- **Unpinned peerDep `*`** — accepts TS 4 users we never test against; hides breakage.

## Consequences

**Positive**:
- One internal toolchain (TS 6) for contributors — simpler CI matrix.
- Downstream apps can upgrade at their own cadence within the window.
- `>=5.5` anchors to the shadcn-svelte floor consumers already honour.

**Negative / trade-offs**:
- `.d.ts` emit must stay 5.5-compatible; no use of TS 6-exclusive output syntax (`using`, const-type-parameter defaults) in public types. Internal code is unconstrained.
- Each future TS major bumps the ceiling via an ADR amendment, not silently.

**Documentation obligations**:
- `AGENTS.md` — TS version policy line under §Pinned upstream.
- CI matrix (`ci-sveltekit.yml` reusable): run `tsc --noEmit` against both TS 5.5 and TS 6 on core API surfaces.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:49` — D7 pick.
- `.workingdir/research/ecosystem-batch-a.md` — TS 6 adoption survey + shadcn-svelte floor.
- Root `package.json` — `typescript@^6.0.3` internal pin.
