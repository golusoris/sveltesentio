# Claude Code guide — sveltesentio

> Claude Code-specific guide. Read [AGENTS.md](AGENTS.md) first; this file extends it.

## Skills available

Located in `.claude/skills/`:

| Skill | When to use |
|---|---|
| `wire-module` | Add a new `@sveltesentio/*` package to the monorepo |
| `scaffold-route` | Generate a SvelteKit route with Superforms + TanStack Query |
| `add-shadcn` | Add a shadcn-svelte component via the CLI wrapper |
| `add-storybook` | Add a Storybook story for a component |

Invoke via `/<skill-name>` in Claude Code.

## Hooks active

Located in `.claude/hooks/`:

- Touching `**/+server.ts` → auto-loads SvelteKit server docs + openapi-fetch patterns
- Touching `**/+page.svelte` → auto-loads Svelte 5 runes docs + shadcn-svelte patterns
- Touching `**/schema.ts` → auto-loads Zod v4 + Superforms docs
- Touching `**/packages/realtime/**` → auto-loads sveltekit-sse docs + ConnectRPC patterns
- Pre-commit: runs `make ci`

## Tone

- Terse. No preamble.
- **Ask via `AskUserQuestion` popups for any choice with discrete options** (approach, scope, library pick) — never embed `(a)/(b)/(c)` alternatives in prose. Single-path confirmations and "what's the best option and why" recommendations stay prose.
- API changes: write `Migration:` footer in commit body with before/after Svelte snippets.
- New dependency: state which alternatives were considered and why this wins.
- Never use `$:` reactive statements — use `$derived` or `$effect`.
- Never use `writable()` stores for server state — use TanStack Query.
- Never use `any` — use `unknown` and narrow with Zod or type guards.

## Project principles — read [docs/principles.md](docs/principles.md) §2

Quick hitlist for AI agents:

- **§2.1 Power of 10, TS-adapted** — no `any`, ≤100-line components, exhaustive error handling, no `console.log` outside debug/, no direct DOM manipulation (use `use:` actions)
- **§2.2 OWASP ASVS L2** — CSP headers, SRI on CDN assets, DOMPurify at all innerHTML boundaries, Zod at every API boundary, no secrets in client bundles
- **§2.3 WCAG 2.2 AA** — axe-core clean on every component, keyboard navigation, ARIA attributes via eslint-plugin-svelte a11y rules
- **§2.4 Svelte 5 runes-first** — `$state`, `$derived`, `$props`, `$effect`. No legacy stores in new code.
- **§2.5 Supply chain** — SBOM on releases, provenance attestation, `pnpm audit` clean on merge
- **§2.6 Interface-type UX** — read [docs/ux-principles.md](docs/ux-principles.md) before writing UI code; match the correct design paradigm to the interface type
- **§2.7 Tooling** — Conventional Commits, SemVer, release-please, Trunk-Based Dev
- **§2.8 Testing** — Vitest (unit), Playwright (e2e), Testing Library (component), axe-core (a11y), 70% coverage (85% auth/forms)
- **§2.9 Performance** — LCP < 2.5s, INP < 200ms, CLS < 0.1, bundle size gates via rollup-plugin-visualizer

Every merged commit: **0 eslint · 0 type errors · 0 audit vulns · axe-clean**

## Don't

- Don't use `$:` reactive statements — use `$derived`
- Don't use `writable()` for server state — use TanStack Query
- Don't use `console.log` — use `console.warn` or `console.error` only
- Don't manipulate DOM directly — use `use:` actions
- Don't use `any` — ever
- Don't add features beyond task scope
- Don't write multi-paragraph comments
- Don't silence eslint without a justification comment next to the `// eslint-disable` directive
- Don't reference current-app patterns as authority — sveltesentio sets the standard

## Project state

- Pre-alpha (v0.0.x). Phase 1 (foundation) in progress.
- See [.workingdir/PLAN.md](.workingdir/PLAN.md) for the full roadmap.
- See [.workingdir/STATE.md](.workingdir/STATE.md) for current status + decision log.

## Every commit: keep docs in sync

On each commit touching new/changed modules:

- Update [.workingdir/STATE.md](.workingdir/STATE.md) session log.
- Update [README.md](README.md) when a phase completes.
- Update [AGENTS.md](AGENTS.md) layout tree when adding packages.
- Write per-package `AGENTS.md` for any new module.
