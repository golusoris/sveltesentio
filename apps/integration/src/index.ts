/**
 * `@sveltesentio/integration` — a private, non-published verification artifact.
 * Each module composes several `@sveltesentio/*` packages the way a real
 * SvelteKit app would, so a `tsc --noEmit` over this consumer catches
 * cross-package integration regressions the per-package suites can't see.
 */
export * from './server-prefetch.js';
export * from './signup-form.js';
export * from './client-dashboard.js';
export * from './auth-flow.js';
export * from './live-feed.js';
