# sveltesentio — Locked Decisions

## Phase 1 decisions — resolved 2026-04-17

| # | Decision | Choice | Reason |
| --- | --- | --- | --- |
| D1 | Release pipeline | release-please | Mirrors golusoris, zero manual steps, auto changelog |
| D2 | npm publishing | Public npm `@sveltesentio/*` | Open source, same philosophy as golusoris |
| D3 | shadcn-svelte approach | CLI wrapper — `sveltesentio-ui add <component>` | Preserves shadcn copy-paste model; framework owns config/tokens, app owns component code |
| D4 | Reusable CI workflows | Yes — `ci-sveltekit.yml` + `release-sveltekit.yml` | Mirrors golusoris `ci-go.yml` pattern; downstream apps call them |
| D5 | Default theme mode | Per interface-type preset | media=dark, webapp=system, pwa=system, ten-foot=dark, flow=dark |
| D6 | Icon library | Both — `@iconify/svelte` default, `lucide-svelte` opt-in peer dep | app-arca uses iconify, app-revenge uses lucide; don't force migration |
| D7 | ConnectRPC in realtime | Yes — `@sveltesentio/realtime` includes ConnectRPC transport | app-subdo requires it |
| D8 | Component docs | Histoire (Svelte 5 native, Vite-powered) | Faster, Svelte-native stories over Storybook |

## Phase 2–3 decisions — resolved 2026-04-17

| # | Decision | Choice | Reason |
| --- | --- | --- | --- |
| D9 | Query mutation toasts | Built-in via svelte-sonner peer dep | Apps shouldn't wire toast manually for every mutation; opt-out not opt-in |
| D10 | API client placement | In `@sveltesentio/query` (`createApiClient()`) | Tight integration with SSR hydration and TanStack cache keys; one import |
| D11 | Forms field components | Both — logic at `.` + styled at `./components` sub-export | Logic-only for purists; styled components for speed; apps choose |
| D12 | Auth patterns | All 4: cookie session (httpOnly), OIDC/OAuth2 PKCE, role guards + permission runes, JWT decode util | Cover all golusoris app auth patterns; each is opt-in |
| D13 | SSE implementation | sveltekit-sse peer dep | Proven package, less code to maintain, auto-reconnect included |
| D14 | AI streaming format | Vercel AI SDK compatible | Widest ecosystem; works with any compliant backend, not just golusoris |
| D15 | File manager | Separate `@sveltesentio/files` package | Distinct interface type with own complexity; clean separation |
| D16 | CLI tool name | `create-sveltesentio` | Follows npm `create-*` convention; `npx create-sveltesentio my-app` |

## Phase 4–12 API decisions — resolved 2026-04-17

| # | Decision | Choice |
| --- | --- | --- |
| D17 | i18n messages path | `src/lib/paraglide/messages/` (paraglide-js v2 default) |
| D18 | Superforms adapter import | `sveltekit-superforms/adapters` → `{ zod4 }` |
| D19 | Auth session locals type | `{ userId, roles, expiresAt }` minimal — apps extend via `locals.d.ts` |
| D20 | Realtime SSE client naming | `createSSESource()` returns Svelte 5 `$state`-compatible reactive object |
| D21 | Mutation toast API | String shortcut: `{ onSuccess: 'Saved!', onError: 'Failed' }` + function form |
| D22 | Forms field component styling | Unstyled + CSS custom properties from preset tokens (`var(--input-bg)` etc.) |
| D23 | SSR hydration pattern | `dehydrate(queryClient)` in `load()` → `HydrationBoundary` on client |
| D24 | Flow canvas undo/redo | Built-in in `FlowCanvas` — Ctrl+Z/Y out of the box, snapshot history internal |
| D25 | Artwork placeholder | CSS var per item: `style="--placeholder-color: oklch(...)"` from server data |
| D26 | RealtimeChart data source | Accepts `data={$liveState}` — decoupled from transport, app wires SSE → state → chart |
| D27 | ChatStream message state | Managed internally (`$state`), exposed via `bind:messages` for parent read access |
| D28 | Locale detection order | URL prefix → cookie → `Accept-Language` header |
