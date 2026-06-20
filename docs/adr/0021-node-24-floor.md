# ADR-0021: `engines.node >=24`; drop Node 22

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D5 in `.workingdir/research/decisions-needed.md`

## Context

Node 22 enters maintenance in 2026-10. Node 24 is the current active LTS line. Several locked dependencies have moved ahead of 22's capabilities: native `fetch` stabilisation, WebSocket globals, permission model, `require(esm)` — all more useful under 24. Holding 22 as a floor keeps sveltesentio on the deprecation path.

## Decision

Publish every `@sveltesentio/*` package with `"engines": { "node": ">=24" }`. CI matrix runs Node 24 only. The `.devcontainer` bumps from 22 → 24. Downstream apps upgrade before adopting sveltesentio.

## Alternatives considered

- **Node 22 floor, 24 in CI** — keeps dead-weight support for a maintenance line; 22-only bug reports would still be filed.
- **Node 22 + 24 dual matrix** — doubles CI cost for no new feature ceiling; 24 is a strict superset.
- **Node 20** — already EOL / security-maintenance; unacceptable.

## Consequences

**Positive**:

- Access to Node 24 globals (`WebSocket`, `structuredClone` improvements, experimental permission model) without conditional imports.
- One CI lane to maintain.
- Aligns with Vite 7 / SvelteKit 2 recommended runtimes.

**Negative / trade-offs**:

- Downstream apps must upgrade; aggressive floor is the user's explicit choice (Round 4a closure).
- Corporate deployment environments pinned to older Node (e.g. AWS Lambda older runtimes) cannot consume sveltesentio until they catch up.

**Documentation obligations**:

- `README.md` prerequisites table.
- `AGENTS.md` §Pinned upstream — Node floor.
- Downstream migration note: Node 22 → 24 before any `@sveltesentio/*` upgrade.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:50` — D5 pick.
- User Round 4a closure: "Floor 24, drop 22".
- `.devcontainer/devcontainer.json` — current Node 22 base (to be bumped).
