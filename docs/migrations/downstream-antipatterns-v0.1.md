# Downstream antipatterns — v0.1 adoption checklist

> When adopting `@sveltesentio/*` v0.1, each downstream app must remediate the antipatterns below. This document is the authoritative migration checklist across `golusoris/app-{arca,revenge,subdo,lurkarr}` (local working copies `~/dev/{arca,revenge,subdo,Lurkarr}`).
>
> Each row links the dispositive evidence, the replacement ADR, and the migration shape. Rows are grouped by app for review ergonomics; ordering within a group prioritises **security > correctness > maintenance**.

## Legend

- **Severity**: `security` (immediate fix — covered by OWASP ASVS L2) · `correctness` (breaks under real conditions) · `maintenance` (works but drift risk) · `dead` (unused / stale dep).
- **Replacement** points to the sveltesentio artefact that lands the fix.
- **Migration**: one-line shape of the change. Longer recipes live in the linked ADR / compose doc.

---

## revenge

| Antipattern | Severity | Evidence | Replacement | Migration |
|---|---|---|---|---|
| Refresh token stored in `localStorage` | **security** | `.workingdir/research/deepread-revenge.md` — auth store | ADR-0034 (HttpOnly cookie sessions) | Server sets `Set-Cookie: session=...; HttpOnly; Secure; SameSite=Lax`; client drops all `localStorage.setItem('refreshToken', ...)` calls; SvelteKit `+hooks.server.ts` forwards the cookie. |
| MFA challenge detected by substring-matching error message (`error.message.includes('mfa')`) | **security** | `.workingdir/research/deepread-revenge.md` — auth MFA flow | ADR-0036 (structured MFA codes) | Parse Golusoris `ProblemError` via ADR-0019 middleware; switch on `error.type === 'urn:golusoris:auth:mfa_required'`; render `<MfaChallenge>` from `@sveltesentio/auth`. |
| `marked.parse()` without DOMPurify on user content | **security** | `.workingdir/research/deepread-revenge.md` — comments/notes render path | ADR-0026 (`ui/markdown` with DOMPurify sink) | Replace direct `marked.parse()` calls with `<Markdown source={value} />` from `@sveltesentio/ui/markdown`; remove the raw `marked` import from components. |
| `mode-watcher@0.5.x` pinned (pre-runes, pre-Svelte-5) | **correctness** | `package.json` — `mode-watcher` devDep | ADR-0030 (mode-watcher ≥1.1) | `pnpm up mode-watcher@^1.1`; audit any `ModeWatcher` component props that changed between 0.5 and 1.1 (renamed slots, new `track` option). |
| `vidstack@latest` (legacy 0.6.15) in package.json if present | **correctness** | registry vs. project pin check | ADR-0042 (Vidstack `@next`) | `pnpm rm vidstack && pnpm add vidstack@next`; verify no imports from the old `@vidstack/player` scope. |
| `zod@^3.24.0` floor (divergent from the framework's Zod 4) | **correctness** | `.workingdir/research/deepread-revenge.md` — deps | ADR-0001 (Zod v4 floor) | `pnpm up zod@^4`; run the Zod v3→v4 codemod (see upstream Zod migration guide); rerun type-check. |

## arca

| Antipattern | Severity | Evidence | Replacement | Migration |
|---|---|---|---|---|
| `NotesEditor.svelte:62-63` literal TODO: "should add DOMPurify in prod" with zero DOMPurify imports | **security** | source file | ADR-0026 (`ui/markdown` with DOMPurify sink) | Same replacement as revenge above — swap to `<Markdown>`; delete the TODO. |
| `@vincjo/datatables` installed but unused after `ui/data` migration | **dead** | `package.json` vs. grep across `src/` | ADR-0011 + ADR-0024 (`ui/data` + TanStack Virtual) | `pnpm rm @vincjo/datatables`; migrate any remaining table view to `@sveltesentio/ui/data` `DataTable<T>` + TanStack Table headless primitive. |
| `@iconify/svelte` used while the framework defaults to `@lucide/svelte` | **maintenance** | `package.json` | ADR-0002 (`@lucide/svelte` default + pluggable `ui/icons`) | Keep `@iconify/svelte` via the pluggable icon loader in `@sveltesentio/ui/icons` — no code change required, just register the loader in `+layout.svelte`. |

## subdo

| Antipattern | Severity | Evidence | Replacement | Migration |
|---|---|---|---|---|
| ConnectRPC called via raw `fetch` + manual JSON decode | **correctness** | `.workingdir/research/deepread-subdo.md` — API calls | ADR-0038 (`createPromiseClient`) | Replace `fetch('/api.X/method', …)` with `client.method(input)` from `createPromiseClient(Service, { transport })`; wire `transport = createConnectTransport({ baseUrl: '…' })`. |
| `lucide-svelte` (old npm scope) instead of `@lucide/svelte` (new scope) | **maintenance** | `package.json` | ADR-0002 (`@lucide/svelte`) | `pnpm rm lucide-svelte && pnpm add @lucide/svelte`; update imports from `lucide-svelte` → `@lucide/svelte`. Codemod friendly. |
| Hand-rolled Yjs `observe()` + `toArray()` pattern per component | **maintenance** | `.workingdir/research/deepread-subdo.md` — collab components | ADR-0039 (`createYjsStore` helper) | Replace the imperative subscribe/sync cycle with `const list = createYjsStore(yArray)`; iterate with `{#each list as item}`. |

## Lurkarr

No security / correctness antipatterns identified in pass 1. Lurkarr is the nearest reference (latest shadcn-svelte, `mode-watcher@1`, `@lucide/svelte` new scope). Track as the positive baseline.

---

## Checking your app

Run this checklist per downstream repo before pulling any `@sveltesentio/*` v0.1 dep:

1. `pnpm outdated mode-watcher @lucide/svelte zod vidstack` — verify versions match ADR floors.
2. `grep -rn 'localStorage.setItem.*\(token\|session\|refresh\)' src/` — should be empty.
3. `grep -rn 'marked\.parse' src/` — only allowed inside `@sveltesentio/ui/markdown` itself.
4. `grep -rn 'cmdk-sv' .` — package should not appear; migrate to `bits-ui` Command per ADR-0025.
5. `grep -rn "from 'lucide-svelte'" src/` — should be empty (all `@lucide/svelte`).
6. `grep -rn 'includes..mfa' src/` — substring MFA detection is the antipattern; replace with structured `ProblemError` typing.
7. Engine check: `node --version` should be ≥ 24 (ADR-0021).

Any match to items 2-6 blocks adoption.

## Tracking

| App | Items remaining (as of 2026-04-17) |
|---|---|
| revenge | 6 |
| arca | 3 |
| subdo | 3 |
| Lurkarr | 0 |

Per-app migration PRs track by conventional-commit title `chore(migrate): sveltesentio v0.1 prep — <app>`; include this checklist's relevant rows in the PR body so reviewers can tick them off.

## Related

- All linked ADRs live under [docs/adr/](../adr/).
- Per-ADR migration notes live inside each ADR's "Documentation obligations" section.
- `.workingdir/research/ecosystem-pass-1-summary.md` aggregates the research evidence.
