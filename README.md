<!-- markdownlint-disable MD013 MD033 MD036 MD041 -->
<div align="center">
  <img src="docs/assets/sveltesentio-readme-banner.svg" alt="sveltesentio — composable SvelteKit framework, opt-in modules, Svelte 5 runes" height="120" />
</div>

<!-- README-STANDARD badge block: one group, fixed order (docs/README-STANDARD.md) -->
<!-- 1 release/version -->

<p align="center">
  <a href="https://github.com/golusoris/sveltesentio/releases"><img src="https://img.shields.io/badge/Release-Releases-3b82f6?style=for-the-badge&labelColor=111a35" alt="Release" /></a>
</p>

<!-- 2 CI/build -->

<p align="center">
  <a href="https://github.com/golusoris/sveltesentio/actions/workflows/ci.yml"><img src="https://github.com/golusoris/sveltesentio/actions/workflows/ci.yml/badge.svg?branch=main&event=push" alt="CI" /></a>
  <a href="https://github.com/golusoris/sveltesentio/actions/workflows/portability.yml"><img src="https://github.com/golusoris/sveltesentio/actions/workflows/portability.yml/badge.svg?branch=main&event=push" alt="Platform Neutrality" /></a>
  <a href="https://github.com/golusoris/sveltesentio/actions/workflows/praetor-docs.yml"><img src="https://github.com/golusoris/sveltesentio/actions/workflows/praetor-docs.yml/badge.svg?branch=main&event=push" alt="Documentation Governance" /></a>
</p>

<!-- 3 security/scorecard -->

<p align="center">
  <a href="https://github.com/golusoris/sveltesentio/actions/workflows/codeql.yml"><img src="https://github.com/golusoris/sveltesentio/actions/workflows/codeql.yml/badge.svg?branch=main&event=push" alt="CodeQL" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/golusoris/sveltesentio"><img src="https://img.shields.io/badge/OpenSSF-Scorecard-06b6d4?style=for-the-badge&labelColor=111a35" alt="OpenSSF Scorecard" /></a>
  <a href="https://www.bestpractices.dev/projects/15664"><img src="https://www.bestpractices.dev/projects/15664/badge" alt="OpenSSF Best Practices" /></a>
  <a href="https://coderabbit.ai"><img src="https://img.shields.io/badge/Reviews-CodeRabbit-8b5cf6?style=for-the-badge&logo=coderabbit&logoColor=white&labelColor=111a35" alt="CodeRabbit" /></a>
</p>

<!-- 4 standards -->

<p align="center">
  <a href="AGENTS.md"><img src="https://img.shields.io/badge/Standards-HISS--21-06b6d4?style=for-the-badge&logo=nasa&labelColor=111a35" alt="HISS-21" /></a>
  <a href="docs/principles.md"><img src="https://img.shields.io/badge/NASA_JPL-Power_of_10-3b82f6?style=for-the-badge&logo=nasa&labelColor=111a35" alt="Power of 10" /></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/Commits-Conventional-8b5cf6?style=for-the-badge&logo=conventionalcommits&logoColor=white&labelColor=111a35" alt="Conventional Commits" /></a>
</p>

<!-- 5 licence -->

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-EUPL--1.2-3b82f6?style=for-the-badge&labelColor=111a35" alt="License" /></a>
</p>

<p align="center"><strong>Composable SvelteKit framework — opt-in modules, Svelte 5 runes</strong></p>
<p align="center"><em>The direct frontend counterpart to <a href="https://github.com/golusoris/golusoris">golusoris</a></em></p>

Apps install only what they need from `@sveltesentio/*`. Philosophy first, code second.

## Packages

Published to npm under the [`@sveltesentio`](https://www.npmjs.com/org/sveltesentio) scope:

```bash
pnpm add @sveltesentio/core @sveltesentio/query @sveltesentio/api @sveltesentio/ui
```

| Package                     | npm   | Description                                                                                                                                                                                                                                   |
| --------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sveltesentio/core`        | 0.3.0 | env schema, RFC 9457 parser, id (UUIDv7), clock injection, CSP helpers, vite plugin, typed `$sentio` config (`defineSentioConfig` / `sentioConfigSchema` / `./sentio`)                                                                        |
| `@sveltesentio/ui`          | 0.5.0 | oklch tokens + interface presets + headless DataTable / command / toast wrappers                                                                                                                                                              |
| `@sveltesentio/query`       | 0.3.0 | TanStack Query v6 — `createQueryClient` (RFC 9457 retry), SSR hydration, infinite, optimistic                                                                                                                                                 |
| `@sveltesentio/api`         | 0.3.0 | typed openapi-fetch client + RFC 9457 `problemMiddleware` (+ openapi-typescript recipe)                                                                                                                                                       |
| `@sveltesentio/forms`       | 0.3.0 | Superforms v2 + Zod v4 adapter, RFC 9457 → field-error mapping                                                                                                                                                                                |
| `@sveltesentio/auth`        | 0.6.0 | OIDC orchestration, `handleCsrf` hook, passkeys, PKCE/CSRF primitives, typed auth errors                                                                                                                                                      |
| `@sveltesentio/i18n`        | 0.3.0 | Paraglide v2 (`paraglideVitePlugin`), RTL via logical properties, a11y announcer                                                                                                                                                              |
| `@sveltesentio/realtime`    | 0.4.0 | native SSE (`useSSE` rune), exponential backoff, buffered emitter                                                                                                                                                                             |
| `@sveltesentio/collab`      | 0.4.0 | Yjs CRDT helpers + `y-websocket` provider + runes stores                                                                                                                                                                                      |
| `@sveltesentio/flow`        | 0.4.0 | DAG topo-sort / cycle helpers + elkjs layout                                                                                                                                                                                                  |
| `@sveltesentio/charts`      | 0.5.0 | a11y `<ChartFigure>` + screen-reader data table + dashboard preset                                                                                                                                                                            |
| `@sveltesentio/media`       | 0.4.1 | headless HLS player model + responsive image helpers                                                                                                                                                                                          |
| `@sveltesentio/uploads`     | 0.2.0 | magic-byte `validateUpload` + `stripExif` (transport-agnostic)                                                                                                                                                                                |
| `@sveltesentio/shell`       | 0.2.0 | device-class layout, D-pad / gamepad focus nav, safe-area helpers                                                                                                                                                                             |
| `@sveltesentio/ai`          | 0.4.0 | server-proxy LLM, `@huggingface/transformers` edge seam, EU AI Act audit hook                                                                                                                                                                 |
| `@sveltesentio/emulator`    | 0.1.0 | EmulatorJS CSP directives + config / loader                                                                                                                                                                                                   |
| `@sveltesentio/mcp`         | 0.2.0 | MCP server exposing compliance + compose docs                                                                                                                                                                                                 |
| `@sveltesentio/testing`     | 0.1.0 | `testClock({ now })`, a11y / axe harness, RFC 9457 fixtures                                                                                                                                                                                   |
| `@sveltesentio/ipc-sockmap` | 0.2.0 | Colocated IPC: AF_UNIX (Tier 1) + length-prefixed framing + transport-ladder detection; eBPF SK_MSG (Tier 3) observe/handoff client via `./sockmap` (`probeSockmap` / `activationListeners` / `readSockmapStats`) — golusoris owns map writes |

## Design system

- **Colors**: oklch only — no hex, no rgb, no hsl
- **Spacing**: 8pt grid (`--space-1` → `--space-24`)
- **Interface types**: desktop, 10-foot, handheld, dashboard (see [ADR-0047](docs/adr/0047-per-interface-presets.md))
- **Standards**: WCAG 2.2 AA, OWASP ASVS L2, SLSA Build Level 2 (Level 3 is open, [#280](https://github.com/golusoris/sveltesentio/issues/280)), EU AI Act Art. 12, Svelte 5 runes-first

See [`docs/principles.md`](docs/principles.md) and [`docs/ux-principles.md`](docs/ux-principles.md). [Support & discussions](https://github.com/golusoris/sveltesentio/discussions).

## Development

```bash
make setup   # pnpm install + lefthook install
make dev     # turbo dev (all packages watch)
make ci      # lint + typecheck + test + build
```

Requires Node 24+ (see [ADR-0021](docs/adr/0021-node-24-floor.md)) and pnpm 10+.

## License

© lusoris.

- Code: [EUPL-1.2](LICENSE).
- Documentation, meaning this README and everything under `docs/`: [CC BY-SA 4.0](LICENSES/CC-BY-SA-4.0.txt).
- Third-party files keep the licence of their upstream. [REUSE.toml](REUSE.toml) names each of them with its licence and copyright holder.

The packages were published under MIT up to and including the releases below. Those releases stay MIT. Every later release is EUPL-1.2.

| Package                     | Last MIT release |
| :-------------------------- | :--------------- |
| `@sveltesentio/ai`          | 0.4.0            |
| `@sveltesentio/api`         | 0.3.0            |
| `@sveltesentio/auth`        | 0.6.0            |
| `@sveltesentio/charts`      | 0.5.0            |
| `@sveltesentio/collab`      | 0.4.0            |
| `@sveltesentio/core`        | 0.3.0            |
| `@sveltesentio/emulator`    | 0.1.0            |
| `@sveltesentio/flow`        | 0.4.0            |
| `@sveltesentio/forms`       | 0.3.0            |
| `@sveltesentio/i18n`        | 0.3.0            |
| `@sveltesentio/ipc-sockmap` | 0.2.0            |
| `@sveltesentio/mcp`         | 0.2.0            |
| `@sveltesentio/media`       | 0.4.1            |
| `@sveltesentio/query`       | 0.3.0            |
| `@sveltesentio/realtime`    | 0.4.0            |
| `@sveltesentio/shell`       | 0.2.0            |
| `@sveltesentio/testing`     | 0.1.0            |
| `@sveltesentio/ui`          | 0.5.0            |
| `@sveltesentio/uploads`     | 0.2.0            |

## Standards & Governance

This repository conforms to High-Integrity Systems Standards (HISS-21)
and modernized NASA JPL Power-of-10 rules.

| Gate             | Command                        | Description                                              |
| :--------------- | :----------------------------- | :------------------------------------------------------- |
| **Verification** | `make verify-all`              | Runs full audit, test suite, and context integrity check |
| **HISS Audit**   | `praetorctl audit`             | Enforces zero technical debt regression against baseline |
| **Context Sync** | `praetorctl compile-context`   | Transpiles canonical `AGENTS.md` to all AI targets       |

<!-- praetor:readme-governance:start -->
[![HISS Adopted][praetor-hiss-badge]][praetor-hiss-agents]
[![Documentation Governance][praetor-docs-badge]][praetor-docs-runs]

Praetor manages this repository's declared governance policy. This managed
block records adoption state; it is not a verification certificate.

**Verification**: `make verify-all` runs the repository's configured
verification cascade.

**HISS Audit**: `praetorctl audit` enforces policy, generated-surface
integrity, and the debt ratchet.

**Context Sync**: `praetorctl compile-context --verify` verifies every
generated agent context against `AGENTS.md`.

**Documentation**: `make docs-lint` enforces locked Markdown style and the
private scratch-link policy.

**Debt Baseline**: `.standards-baseline.json` anchors the debt ratchet at
2 recorded infractions; audit forbids growth.

[praetor-hiss-badge]: https://img.shields.io/badge/Standards-HISS%20Adopted%20(2%20baselined)-yellow
[praetor-hiss-agents]: https://github.com/golusoris/sveltesentio/blob/HEAD/AGENTS.md
[praetor-docs-badge]: https://github.com/golusoris/sveltesentio/actions/workflows/praetor-docs.yml/badge.svg
[praetor-docs-runs]: https://github.com/golusoris/sveltesentio/actions/workflows/praetor-docs.yml
<!-- praetor:readme-governance:end -->
