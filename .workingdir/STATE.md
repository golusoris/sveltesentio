# sveltesentio — Current State

## Phase 1 — Foundation (COMPLETE)

Completed: 2026-04-17

- [x] GitHub repo created: https://github.com/golusoris/sveltesentio
- [x] Git initialized, remote set, first commit pushed (e5cfb2a)
- [x] All 8 decisions resolved (see `.workingdir/research/decisions.md`)
- [x] Root config files (package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, eslint.config.js, prettier.config.js, commitlint.config.js, .editorconfig, .gitignore, Makefile)
- [x] GitHub Actions: ci.yml, ci-sveltekit.yml, release-please.yml, release-sveltekit.yml, scorecard.yml, codeql.yml, auto-assign.yml, dependabot.yml
- [x] Community health: CODEOWNERS, PULL_REQUEST_TEMPLATE.md, bug_report.yml, feature_request.yml, SECURITY.md, LICENSE
- [x] Philosophy: CLAUDE.md, AGENTS.md, docs/principles.md, docs/ux-principles.md (incl. cross-platform §3.10)
- [x] Release config: release-please-config.json, .release-please-manifest.json
- [x] Working directory: .workingdir/PLAN.md, .workingdir/STATE.md
- [x] Research dump: .workingdir/research/ (decisions, stack, apps-audit, ci-reference)
- [x] .claude/settings.json + 12 skills (wire-module, scaffold-route, add-shadcn, add-histoire, new-component, add-form, add-api-client, add-realtime, apply-preset, add-auth-guard, add-i18n-key, check-perf)
- [x] .claude/hooks/file-context.sh (auto-injects docs on file edits)
- [x] 12 package stubs (core, ui, query, forms, i18n, auth, realtime, flow, media, charts, ai, files)
- [x] devcontainer (.devcontainer/devcontainer.json)
- [x] Branch protection applied (lint/typecheck/test/build/audit + signed commits + linear history)
- [x] README.md with full badge row + sponsor link; all 12 package READMEs same

PR: merged to main (e5cfb2a base)

---

## Phase 2 — @sveltesentio/core (COMPLETE)

Completed: 2026-04-17
Branch: feat/phase-2-core → PR #4 → merged

- [x] `src/types.ts` — `Result<T,E>`, `Option<T>`, `Prettify<T>`, `Brand<T,B>`, utility types
- [x] `src/errors.ts` — `AppError`, `HttpError`, `ok()`, `err()`, `isOk()`, `isErr()`, `unwrap()`, `unwrapOr()`
- [x] `src/env.ts` — `createEnv()` Zod-validated env with `PUBLIC_*` split
- [x] `src/id.ts` — UUIDv7 sortable ID (Web Crypto API, correct 48-bit timestamp encoding)
- [x] `src/clock.ts` — `Clock` interface, `systemClock`, `createTestClock()` (mockable)
- [x] `src/log.ts` — `createLogger()` structured wrapper (warn/error only, pluggable sink)
- [x] `src/vite.ts` — `sentioPlugin()` Vite plugin stub
- [x] `src/index.ts` — all re-exports
- [x] Tests: errors, id, log, env — all green
- [x] typecheck + test green

---

## Phase 3 — @sveltesentio/ui (COMPLETE)

Completed: 2026-04-17
Branch: feat/phase-3-ui → PR #5 → merged

- [x] `tokens/base.css` — 8pt grid spacing, modular type scale, motion, radius, z-index, elevation, status colors
- [x] `tokens/media.css` — hue 295 (purple), dark, artwork/playbar/sidebar vars
- [x] `tokens/dashboard.css` — hue 195 (teal), dense 14px body, chart vars, sidebar collapse vars
- [x] `tokens/webapp.css` — hue 250 (blue), light/dark/system, input vars
- [x] `tokens/pwa.css` — extends webapp, touch-target 48px, safe-area-inset, bottom nav vars
- [x] `tokens/ten-foot.css` — extends media, 29px body, 48px+ titles, 60px TV-safe insets, 4K TV media query
- [x] `tokens/flow.css` — hue 230, canvas bg, node type colors (input/transform/output), edge/port/minimap
- [x] `src/presets/types.ts` — `Preset` interface (`id`, `defaultMode`, `primaryHue`, `cssFile`, `minTargetPx`, `bottomNav`, `dpadNav`)
- [x] `src/presets/index.ts` — all 6 presets + `presets` registry + `PresetId` type
- [x] `src/components/ThemeToggle.svelte` — mode-watcher integration, sun/moon icons, `aria-pressed`
- [x] `bin/add-shadcn.js` — validates CWD, forwards to `npx shadcn-svelte@next add`
- [x] `package.json` — `sideEffects: ["tokens/*.css"]`, CSS exports, bin entry
- [x] `src/index.ts` — all re-exports

---

## Phase 4 — @sveltesentio/query (COMPLETE)

Completed: 2026-04-17
Branch: feat/phase-4-query → PR #6 (open, targeting feat/phase-3-ui)

- [x] `src/client.ts` — `createApiClient<Paths>()` wrapping openapi-fetch `createClient()`
- [x] `src/query.ts` — `createSentioQuery()` (30s staleTime default), `prefetchQuery()`, `createQueryInvalidator()`
- [x] `src/mutation.ts` — `createMutation()` with `invalidates`, string-shortcut `onSuccess`/`onError` toasts (svelte-sonner)
- [x] `src/hydration.ts` — `serverPrefetch({ queries })`, re-exports `HydrationBoundary`, `dehydrate`, `hydrate`
- [x] `src/infinite.ts` — `PagedResponse<TItem>`, `createInfiniteItems()` (cursor-based), `flattenPages()`
- [x] `src/index.ts` — all re-exports
- [x] Tests: client, infinite — green
- [x] `package.json` — peerDeps: openapi-fetch, svelte-sonner (optional)

---

## Next: Phase 5 — @sveltesentio/forms

Branch to create: `feat/phase-5-forms` from `feat/phase-4-query`

Deliverables:

- [ ] `src/schema.ts` — `createFormSchema()`, common field validators
- [ ] `src/form.ts` — typed `createForm()` wrapping `superValidate` + `{ zod4 }` adapter (D18)
- [ ] `src/errors.ts` — `mapFormErrors()` Superforms error → UI error mapping
- [ ] `src/components/TextField.svelte` — unstyled + CSS vars (D22)
- [ ] `src/components/SelectField.svelte`
- [ ] `src/components/CheckboxField.svelte`
- [ ] `src/components/TextareaField.svelte`
- [ ] `src/components/DateField.svelte`
- [ ] `src/components/FileField.svelte` — drag-drop upload
- [ ] `src/components/FormErrors.svelte` — maps Superforms errors to UI
- [ ] `src/index.ts` — all re-exports
- [ ] Tests: schema validators, form creation, error mapping
- [ ] Coverage ≥ 85% (forms is auth-tier: higher threshold)

---

## Upcoming phases (summary)

| Phase | Package | Key deliverable |
| --- | --- | --- |
| 6 | @sveltesentio/i18n | URL→cookie→Accept-Language (D28), paraglide src/lib/paraglide/messages/ (D17) |
| 7 | @sveltesentio/auth | OIDC client, `$derived` permission stores, auth guards, `{userId,roles,expiresAt}` (D19) |
| 8 | @sveltesentio/realtime | `createSSESource()` → $state (D20), sveltekit-sse peer, ConnectRPC (D7) |
| 9 | @sveltesentio/flow | `FlowCanvas` + built-in undo/redo (D24) |
| 10 | @sveltesentio/media | CSS var placeholder per item (D25), D-pad focus manager in framework |
| 11 | @sveltesentio/charts | `RealtimeChart` accepts `data={$state}` (D26) |
| 12 | @sveltesentio/ai | `ChatStream` bind:messages managed internally (D27), Vercel AI SDK compat (D14) |
| 13 | @sveltesentio/files | Virtual scroll + drag-drop file manager (@neodrag/svelte, @tanstack/svelte-virtual) |
| 14 | create-sveltesentio | `npx create-sveltesentio my-app` interactive scaffolder (D16) |

---

## Decision log

| Date | ID | Decision | Choice | Reason |
| --- | --- | --- | --- | --- |
| 2026-04-17 | D1 | Release pipeline | release-please | Mirrors golusoris, zero manual steps |
| 2026-04-17 | D2 | npm scope | Public npm @sveltesentio/* | Open source, same as golusoris philosophy |
| 2026-04-17 | D3 | shadcn approach | CLI wrapper | Preserves shadcn copy-paste model, framework owns config |
| 2026-04-17 | D4 | Reusable CI | Yes (ci-sveltekit.yml) | Mirrors golusoris ci-go.yml pattern |
| 2026-04-17 | D5 | Theme default | Per interface-type preset | Media=dark, webapp=system, pwa=system |
| 2026-04-17 | D6 | Icons | Both (iconify default + lucide opt-in) | app-arca uses iconify, app-revenge uses lucide |
| 2026-04-17 | D7 | ConnectRPC | Yes, in @sveltesentio/realtime | app-subdo requires it |
| 2026-04-17 | D8 | Component docs | Histoire | Svelte 5 native, Vite-powered, fast |
| 2026-04-17 | D9 | Query toasts | Built-in (svelte-sonner string shortcuts) | All apps need mutation feedback; string shortcut keeps call sites clean |
| 2026-04-17 | D10 | API client location | In @sveltesentio/query | query is the data layer; avoids a separate tiny package |
| 2026-04-17 | D11 | Forms exports | Both schema-only + full component | Apps can adopt incrementally |
| 2026-04-17 | D12 | Auth patterns | All 4 (OIDC client + permission stores + guards + JWT decode) | Each app needs at least 2; ship all 4 to keep consistent |
| 2026-04-17 | D13 | SSE peer dep | sveltekit-sse | Thin wrapper maintained by svelte community; not bundled |
| 2026-04-17 | D14 | AI streaming format | Vercel AI SDK compatible | Most SvelteKit AI tutorials use it; interoperable |
| 2026-04-17 | D15 | Files package | New @sveltesentio/files (separate) | app-arca has heavy file manager; worth dedicated package |
| 2026-04-17 | D16 | CLI scaffolder | create-sveltesentio (npx) | Matches create-svelte UX; D15 confirmed separate package |
| 2026-04-17 | D17 | Paraglide messages path | src/lib/paraglide/messages/ | Standard paraglide-sveltekit convention |
| 2026-04-17 | D18 | Superforms Zod adapter | zod4 from sveltekit-superforms/adapters | Zod v4 is default; separate import required |
| 2026-04-17 | D19 | Session shape | {userId, roles, expiresAt} | Minimal but sufficient; roles is string[] for RBAC |
| 2026-04-17 | D20 | SSE return type | createSSESource() returns $state | Svelte 5 runes-first; reactive by default |
| 2026-04-17 | D21 | Mutation toast API | String shortcut (onSuccess: "Saved!") | Reduces boilerplate at call sites |
| 2026-04-17 | D22 | Form component style | Unstyled + CSS vars | Apps own styles; shadcn does the same |
| 2026-04-17 | D23 | SSR hydration | dehydrate/HydrationBoundary pattern | TanStack Query v6 standard; no custom serialization |
| 2026-04-17 | D24 | Flow undo/redo | Built-in in FlowCanvas (not app-level) | Framework manages graph state; apps get undo for free |
| 2026-04-17 | D25 | Media placeholder | CSS var per item (dominant color via JS) | Pure CSS approach; no extra deps |
| 2026-04-17 | D26 | Chart reactive data | Chart accepts data={$state} directly | Svelte 5 runes propagate reactivity naturally |
| 2026-04-17 | D27 | ChatStream messages | bind:messages managed internally | Component owns message list; app can read via bind: |
| 2026-04-17 | D28 | i18n locale detection order | URL prefix → cookie → Accept-Language header | URL is canonical for SEO; cookie persists preference; header is fallback |

---

## Session log

| Date | Summary |
| --- | --- |
| 2026-04-17 | Phase 1 complete: repo, CI, branch protection, 12 package stubs, docs, skills, hooks |
| 2026-04-17 | Phase 2 complete: @sveltesentio/core — id/env/errors/log/clock/vite, tests green |
| 2026-04-17 | Phase 3 complete: @sveltesentio/ui — 7 token CSS presets, ThemeToggle, bin/add-shadcn |
| 2026-04-17 | Phase 4 complete: @sveltesentio/query — client/query/mutation/hydration/infinite, tests green |
| 2026-04-17 | Added @sveltesentio/files stub (D15), 8 additional skills, file-context.sh hook |
| 2026-04-17 | Resolved D9–D28 via decision session; updated decisions.md and PLAN.md |
| 2026-04-17 | Removed app migration from scope (was never in scope per user); removed Phases 14-15 from PLAN.md |
