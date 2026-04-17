# sveltesentio — Locked Decisions

All resolved 2026-04-17.

| # | Decision | Choice |
|---|---|---|
| D1 | Release pipeline | release-please (googleapis/release-please-action v4.4.1) |
| D2 | npm publishing | Public npm under `@sveltesentio/*` |
| D3 | shadcn-svelte approach | CLI wrapper — `sveltesentio add <component>` calls shadcn-svelte CLI |
| D4 | Reusable CI workflows | Yes — `ci-sveltekit.yml` + `release-sveltekit.yml` for downstream apps |
| D5 | Default theme mode | Per interface-type preset (media=dark, webapp=system, pwa=system) |
| D6 | Icon library | Both — `@iconify/svelte` default, `lucide-svelte` as opt-in peer dep |
| D7 | ConnectRPC in realtime | Yes — `@sveltesentio/realtime` includes ConnectRPC transport adapter |
| D8 | Component docs | Histoire (Svelte 5 native, Vite-powered) |
