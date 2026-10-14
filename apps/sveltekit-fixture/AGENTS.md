# @sveltesentio/sveltekit-fixture — agent guide

Private, non-published SvelteKit app. Caller target of `.github/workflows/ci-sveltekit-selftest.yml`, which runs reusable `.github/workflows/ci-sveltekit.yml` with `working-directory: apps/sveltekit-fixture`.
Verification artifact, not deployable app: `private: true`, `version 0.0.0`, never in release config.

Script contract = what reusable workflow calls: `lint`, `typecheck`, `test` (coverage flag passed by workflow, `json-summary` reporter in `vite.config.ts`), `build`.
Keep app minimal: one `#lib` function + tests, one prerendered route.
Dependency versions = versions other workspace apps already pin; no dependency of its own.
