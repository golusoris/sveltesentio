# sveltesentio — §2 Coding Contract

The foundational contract for every `@sveltesentio/*` package and every app that uses the framework.
Every merged commit: **0 eslint · 0 type errors · 0 audit vulns · axe-clean**.

---

## §2.1 Power of 10 — adapted for TypeScript/Svelte

Based on NASA/JPL Power of 10 safety rules, adapted for frontend.

| # | Rule | Frontend adaptation |
|---|---|---|
| 1 | No `goto` / unstructured jumps | No `throw` without catch at boundary; use `Result`-style returns in library code |
| 2 | Bounded loops | No infinite reactive loops; `$effect` must not cause unbounded re-renders |
| 3 | No dynamic memory beyond init | No unbounded store growth; clear subscriptions in `onDestroy` |
| 4 | Functions ≤ 100 lines | Components ≤ 100 lines of script; split larger logic into composable runes |
| 5 | ≥ 2 assertions per function | Zod schemas at every API boundary; TypeScript strict mode is the first layer |
| 6 | Minimal scope | No module-level mutable state outside `$state`; prefer local component state |
| 7 | Check all return values | No unchecked `fetch` — always handle error paths; no swallowed `Promise` rejections |
| 8 | Preprocessor use | TypeScript strict always on; no `// @ts-ignore` without justification comment |
| 9 | Restrict pointers | No `any`; use `unknown` + type guards or Zod `.parse()` |
| 10 | Compile-time warnings = errors | `0 eslint · 0 type errors` on every merge; `// eslint-disable` requires justification |

Additional hard rules:
- No `console.log` — use `console.warn` or `console.error` only; never in production paths
- No direct DOM manipulation — use Svelte `use:` actions
- No `innerHTML` without `DOMPurify.sanitize()` wrapping
- No secrets in client bundles — use SvelteKit `$env/static/private` correctly

---

## §2.2 OWASP ASVS L2 — client-side

| Control | Rule |
|---|---|
| V1 — Architecture | No auth logic in client-only code; server routes handle all sensitive operations |
| V2 — Authentication | Never store tokens in `localStorage`; use `httpOnly` cookies via SvelteKit server |
| V3 — Session | Token refresh handled server-side; client never has access to refresh tokens |
| V5 — Input validation | Zod schema at every API boundary (`+page.server.ts` actions + `+server.ts` routes) |
| V6 — Cryptography | No crypto in client bundles; use Web Crypto API for client-side needs |
| V7 — Error handling | Never expose stack traces or internal paths to users; log server-side only |
| V12 — Files | Validate file type + size in `+server.ts` before processing; sanitize filenames |
| V13 — API | `openapi-fetch` enforces schema-valid requests; validate responses with Zod |
| V14 — Config | CSP headers in `hooks.server.ts`; SRI on all CDN assets |

CSP header minimum (configure per-app in `hooks.server.ts`):
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{NONCE}';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  connect-src 'self' wss:;
  frame-ancestors 'none';
```

---

## §2.3 WCAG 2.2 AA

Every component ships accessible by default — not as an afterthought.

| Criterion | Rule |
|---|---|
| 1.1.1 Non-text content | All `<img>` must have `alt`; decorative images use `alt=""` |
| 1.3.1 Info and relationships | Semantic HTML first; ARIA only when semantic HTML is insufficient |
| 1.4.3 Contrast (min) | Text ≥ 4.5:1 contrast ratio; large text ≥ 3:1 |
| 1.4.11 Non-text contrast | UI components ≥ 3:1 against adjacent colors |
| 2.1.1 Keyboard | All interactive elements reachable and operable by keyboard |
| 2.1.2 No keyboard trap | Focus never trapped unexpectedly; modals trap focus correctly with escape route |
| 2.4.3 Focus order | Logical focus order follows visual order |
| 2.4.7 Focus visible | Focus indicator always visible (2px minimum outline) |
| 3.3.1 Error identification | Form errors identified in text, not color alone |
| 4.1.2 Name/role/value | All custom components expose correct ARIA role, name, value, state |

Testing: `axe-core` clean on every component. Run via `@axe-core/playwright` in E2E.
Linting: `eslint-plugin-svelte` includes a11y rules — treat as errors, not warnings.

---

## §2.4 Svelte 5 runes-first

The canonical style for all sveltesentio code.

```svelte
<script lang="ts">
  // props via $props() — not export let
  const { label, onClick }: { label: string; onClick: () => void } = $props();

  // local state via $state() — not let x = ...
  let count = $state(0);

  // derived via $derived() — not $: derived = ...
  const doubled = $derived(count * 2);

  // side effects via $effect() — not $: { sideEffect() }
  $effect(() => {
    console.warn('count changed:', count);
    return () => { /* cleanup */ };
  });
</script>
```

Rules:
- No `$:` reactive statements — use `$derived` or `$effect`
- No `export let` for props — use `$props()`
- No `writable()` / `readable()` for server state — use TanStack Query
- No `writable()` for UI state that can be `$state()` instead
- `$effect` must not cause unbounded re-renders (no circular dependencies)

---

## §2.5 Supply chain

| Standard | Rule |
|---|---|
| SLSA L3 | Provenance attestation on every release via `actions/attest-build-provenance` |
| SBOM | Generated via Syft on release |
| Cosign | Keyless signing via Sigstore on release artifacts |
| Dependabot | Weekly updates for npm + GitHub Actions, grouped by ecosystem |
| Audit | `pnpm audit --audit-level=high` must pass on every merge |
| Pinned actions | All GitHub Action `uses:` pinned to commit SHA, not tag |

---

## §2.6 Architecture decisions

- ADRs in `docs/adr/` — Nygard format, one file per decision
- Interface-type UX rules in `docs/ux-principles.md` — always consult before writing UI code
- New external dependencies require a justification comment in PR stating alternatives rejected

---

## §2.7 Tooling + formatting

- Conventional Commits enforced by commitlint + CI pr-title check
- SemVer managed by release-please from commit types
- Trunk-Based Development: short-lived feature branches, merge frequently
- EditorConfig: 2-space indent, LF line endings, UTF-8
- Prettier: printWidth 100, singleQuote, trailingComma all
- ESLint: flat config, typescript-eslint strict, svelte a11y rules

---

## §2.8 Testing

| Layer | Tool | Threshold |
|---|---|---|
| Unit | Vitest | 70% line coverage (85% auth/forms packages) |
| Component | @testing-library/svelte + Vitest | — |
| a11y | axe-core + @axe-core/playwright | 0 violations |
| E2E | Playwright | Critical user paths |
| Visual regression | Playwright screenshots | Per-component baseline |

Rules:
- Tests live next to source: `Component.svelte` → `Component.test.ts`
- E2E tests in `e2e/` directory per app
- No mocking of internal sveltesentio modules in integration tests
- Coverage gate enforced in CI (70% threshold, configurable per package)

---

## §2.9 Performance budgets

| Metric | Budget | Tool |
|---|---|---|
| LCP | < 2.5s | Playwright + web-vitals |
| INP | < 200ms | Playwright + web-vitals |
| CLS | < 0.1 | Playwright + web-vitals |
| Bundle size (initial JS) | < 150kb gzipped | rollup-plugin-visualizer |
| Images | WebP/AVIF only, lazy-loaded | eslint-plugin-svelte custom rule |

All `<img>` must have `loading="lazy"` and `decoding="async"` unless above the fold.
Font subsetting required for any custom font loaded.

---

## §2.10 Research-first — no guessing on major decisions

sveltesentio is **evidence-driven by construction**. "Major decisions" — library picks, module surface, public API shape, compliance posture, or anything that touches a package's public API or CI gates — are never locked by an agent or contributor on their own authority.

|Rule|Enforcement|
|---|---|
|Every major decision has a `D*` row in [.workingdir/research/decisions-needed.md](../.workingdir/research/decisions-needed.md) with ≥ 2 named alternatives|PR review|
|A `D*` row closes only when evidence cites (a) a `golusoris/app-*` file:line, (b) measurable benchmark / bundle analysis, or (c) an existing ADR|PR review|
|"Seems good", "commonly used", or awesome-list consensus are **pointers to evidence**, not evidence itself|PR review|
|Only the project owner (`@lusoris`) closes a row to `locked (ADR-NNNN)` — that lock creates a Nygard ADR under `docs/adr/`|CODEOWNERS + PR review|
|Agents working on code adjacent to an open `D*` row must reference it in the PR body and avoid choices that pre-empt the decision|PR review|

This rule supersedes any library recommendation from awesome-lists, AI-generated suggestions, or previous sessions that weren't closed via a `D*` row. **Observation: a library keeps being recommended** ≠ **decision: sveltesentio uses that library**.

---

## §2.11 Strict SvelteKit universe

sveltesentio pins **best-in-class inside the SvelteKit/Svelte 5 ecosystem**, exactly as golusoris pins best-in-class inside the Go ecosystem. Never leave that universe to borrow a React/Vue/Solid component library via a bridge or wrapper.

|Allowed|Disallowed|
|---|---|
|Svelte 5 runes-native component libraries (shadcn-svelte, bits-ui, melt-ui, layerchart, svelte-flow, vidstack)|React/Vue/Solid component libraries loaded via `svelte-adapter-react` / `preact-svelte` / similar bridges|
|Framework-agnostic TS libraries that compose cleanly with SvelteKit SSR (TanStack Query / Table / Virtual, Zod, Yjs, openapi-fetch, ConnectRPC, elkjs, tus-js-client, etc.)|Node-only libraries pulled into browser bundles without verifying SSR/bundle safety|
|Vite plugins + vite-plugin-pwa + vite-plugin-svelte|Webpack/Rollup-era plugins for features Vite already covers (workbox CLI, offline-plugin)|
|Svelte 5-native headless primitives|Headless primitives built on React hooks (`@radix-ui/*`, `@headlessui/react`) — find/request a Svelte port instead|

**Rationale**: the user already runs a Go meta-framework (golusoris) with the same "best-in-class, no leakage across runtimes" policy. A React component inside a SvelteKit app is the frontend equivalent of a Node-binary binding inside a Go program — possible, but it fractures the runtime, breaks tree-shaking, and drags in a second reactivity system that never reconciles cleanly.

**If a capability only exists outside the Svelte ecosystem** (rare but possible: e.g. a specific WebGPU compute library): open a `D*` row per §2.10, evaluate Svelte-native alternatives including "build from scratch on top of primitives we already ship", and only then consider a bridge. Bridges are always ADR-gated.

**Adjacent rule**: if a currently-used library drops Svelte 5 support or becomes unmaintained, it moves to the dead-list in `.workingdir/research/awesome-harvest.md` and a `D*` row opens for the replacement. It does **not** get silently shimmed.
