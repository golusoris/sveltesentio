# Changelog

All notable changes to sveltesentio are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

Release automation is handled by [release-please](https://github.com/googleapis/release-please);
entries below the `## [Unreleased]` heading are written by hand only when
release-please cannot infer them from Conventional Commits.

## [Unreleased]

### Added

- Monorepo scaffold: 11 `@sveltesentio/*` package stubs with `package.json`, `tsconfig.json`, `README.md`, `src/index.ts`.
- Root tooling: Turborepo, pnpm workspaces, ESLint flat config, Prettier, commitlint, release-please, markdownlint.
- CI workflows: `ci`, `ci-sveltekit` (reusable), `release-please`, `release-sveltekit` (reusable), `scorecard`, `codeql`, `auto-assign`, `dependabot`.
- `.claude/` skills: `wire-module`, `scaffold-route`, `add-shadcn`, `add-histoire`; hooks for PreToolUse / PostToolUse prettier / PreCommit `make ci`.
- `.devcontainer` targeting Node 22 + pnpm + zsh with 15 VS Code extensions.
- `docs/principles.md` §2.1–§2.11 (Power of 10 TS-adapted, OWASP ASVS L2, WCAG 2.2 AA, Svelte 5 runes-first, supply chain, interface-type UX, tooling, testing, performance, no-guessing, strict SvelteKit universe).
- `docs/ux-principles.md` oklch tokens + 8pt grid + interface-type presets.
- `docs/adr/` ADR-0001..ADR-0052 covering every closed D-row (Zod v4 floor, Lucide default icons, thin Superforms wrapper, thin xyflow wrapper, Tailwind 4 via Vite plugin, oklch-only tokens, svelte-sonner toast primitive, TanStack svelte-query v6, Yjs + y-websocket collab, xyflow svelte-flow canvas, `ui/data` wrapper, embla via shadcn, layerchart + uplot escape hatch, shadcn-svelte CLI primitive delivery, thin `ui/cmd`, thin `ui/toast` with preset sizing, Paraglide v2 i18n default, thin i18n wrapper, openapi-fetch + RFC 9457, TypeScript 6 floor, Node 24 floor, ESM-only, UUIDv7 default, TanStack virtual a11y wrapper, bits-ui command supersedes cmdk-sv, markdown runtime/build split, custom 10-foot focus graph, vite-pwa-sveltekit, Tailwind 4 safe-area utilities, mode-watcher pin, a11y testing lane, custom OIDC client against golusoris, SimpleWebAuthn passkeys, httpOnly cookie sessions, load-derived permissions, MFA structured errors, SSE-native `useSSE`, ConnectRPC connect-web + connect-query, y-websocket `createYjsStore`, Paraglide strategy + logical properties, tus + exifr + file-type uploads, Vidstack + hls.js, AI server-proxy-only, HuggingFace transformers on-device, AI audit hook Zod schema, three-tier theming, per-interface presets, cookie-backed dark mode, system-font default + fontsource opt-in, tenant theming minimal skeleton, colocated IPC ladder + eBPF sockmap, clock injection hybrid).
- `docs/compose/`: `clock-injection.md`, `colocated-ipc.md`.
- `docs/migrations/`: `downstream-antipatterns-v0.1.md`.
- `docs/compliance/`: OWASP ASVS L2, WCAG 2.2 AA, EU CRA, EU AI Act checklists.
- `packages/collab/`, `packages/uploads/`, `packages/shell/` package stubs (post-harvest additions vs. original 11-package catalog).
- `packages/core/src/clock.ts` + `packages/testing/test/clock.test.ts` — first concrete implementation landed on `main` (clock injection hybrid, ADR-0052).
- `.markdownlint.json` + `.markdownlintignore`.
- Per-package `AGENTS.md` stubs for all `@sveltesentio/*` packages (golusoris parity).
- Governance: `SECURITY.md`, `LICENSE` (MIT), `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `CHANGELOG.md`.

### Changed

- Root `AGENTS.md` rewritten to match golusoris depth (cross-tool framing, hard rules 1–12 including no-guessing + strict SvelteKit universe, granular tree with sub-exports, common-tasks table, pinned-upstream table, CI gates summary).
- `docs/principles.md` extended with §2.10 (no guessing on majors) and §2.11 (strict SvelteKit universe).
- `V0.1.0.md` reframed as hypothesis rather than commitment.

### Deprecated

- *(none)*

### Removed

- *(none)*

### Fixed

- *(none)*

### Security

- *(none yet — first release will ship SBOM via Syft + SLSA L3 provenance + keyless cosign signing.)*

[Unreleased]: https://github.com/lusoris/sveltesentio/compare/HEAD...HEAD
