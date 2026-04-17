# golusoris Apps Frontend Audit

Surveyed 2026-04-17.

## app-arca — ROM Management Platform (PRODUCTION)

Status: Production SvelteKit 5 frontend in `web/`

Key deps:
- @sveltejs/adapter-node ^5.5.4
- @sveltejs/kit ^2.57.1 + svelte ^5.55.2
- tailwindcss ^4.2.2 + @tailwindcss/vite
- @tanstack/svelte-query ^6.1.16
- @tanstack/svelte-virtual ^3.13.23
- sveltekit-superforms ^2.30.1 + zod ^4.3.6
- @inlang/paraglide-sveltekit ^0.16.1 (DEPRECATED — migrate to paraglide-js v2)
- @iconify/svelte ^5.2.1
- svelte-sonner ^1.1.0
- layerchart ^1.0.13
- @formkit/auto-animate ^0.9.0
- @neodrag/svelte ^2.3.3
- tinykeys ^3.0.0
- dompurify ^3.3.3
- marked ^18.0.0
- @vincjo/datatables ^2.8.0

Dev server proxies /api → localhost:8080, /ws → backend WebSocket.

## app-revenge — Go Media Server (PLANNED)

Status: package.json exists in `web/`, frontend not yet implemented.
Adapter: @sveltejs/adapter-static (embedded in Go binary)

Key deps:
- @tanstack/svelte-query ^6.1.14
- hls.js ^1.6.15 (HLS streaming)
- mode-watcher ^0.5.1 (dark mode)
- zod ^3.25.76
- @lucide/svelte ^0.561.0 (different from app-arca which uses iconify!)
- bits-ui ^2.17.3
- embla-carousel-svelte ^8.6.0 (carousel)
- svelte ^5.55.3 + @sveltejs/kit ^2.57.1 + tailwindcss ^4.2.2

Note: uses @lucide/svelte not @iconify/svelte — decision D6 chose both.

## app-subdo — Visual Flow Editor (PLANNED)

Status: Makefile references `cd frontend && pnpm dev` but no frontend code committed yet.

Architecture requires:
- Yjs (collaborative editing — already in golusoris backend)
- ConnectRPC (@connectrpc/connect) for bidirectional streaming
- @xyflow/svelte for DAG flow editor
- Complex state management (node graph)

Decision D7 chose to include ConnectRPC in @sveltesentio/realtime.

## app-lurkarr — *Arr Media Automation

Status: SvelteKit frontend exists (repo is 64MB, updated 2026-04-13).
Details: narrower UI focused on *Arr ecosystem automation.

## gohookarr — (Brand new, 2026-04-16)

Status: Just .gitignore + docs/ folder. Purpose unknown. No frontend.

## Key cross-app findings

1. Icon library divergence: app-arca uses iconify, app-revenge uses lucide → both supported (D6)
2. adapter-static pattern (app-revenge): Go binary embeds frontend static files
3. Yjs / ConnectRPC needed for app-subdo → included in realtime module (D7)
4. @inlang/paraglide-sveltekit is deprecated → all apps need to migrate to @inlang/paraglide-js v2
5. hls.js + embla-carousel + mode-watcher from app-revenge add to the framework stack
