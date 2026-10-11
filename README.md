# sveltesentio

<!-- prettier-ignore-start -->
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
0 recorded infractions; audit forbids growth.

[praetor-hiss-badge]: https://img.shields.io/badge/Standards-HISS%20Adopted-blue
[praetor-hiss-agents]: https://github.com/golusoris/sveltesentio/blob/HEAD/AGENTS.md
[praetor-docs-badge]: https://github.com/golusoris/sveltesentio/actions/workflows/praetor-docs.yml/badge.svg
[praetor-docs-runs]: https://github.com/golusoris/sveltesentio/actions/workflows/praetor-docs.yml
<!-- praetor:readme-governance:end -->
<!-- prettier-ignore-end -->

> Composable SvelteKit framework — opt-in modules, Svelte 5 runes, production-grade.

The direct frontend counterpart to [golusoris](https://github.com/golusoris/golusoris).
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

See [`docs/principles.md`](docs/principles.md) and [`docs/ux-principles.md`](docs/ux-principles.md).

## Development

```bash
make setup   # pnpm install + husky init
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

This repository conforms to High-Integrity Systems Standards (HISS-16)
and modernized NASA JPL Power-of-10 rules.

| Gate             | Command                        | Description                                              |
| :--------------- | :----------------------------- | :------------------------------------------------------- |
| **Verification** | `make verify-all`              | Runs full audit, test suite, and context integrity check |
| **HISS Audit**   | `standardsctl audit`           | Enforces zero technical debt regression against baseline |
| **Context Sync** | `standardsctl compile-context` | Transpiles canonical `AGENTS.md` to all AI targets       |
