import type { sequence } from '@sveltejs/kit/hooks';

/**
 * SvelteKit's `Handle` hook type, derived from `sequence` instead of imported by
 * name. SvelteKit 3 exports `sequence` from `@sveltejs/kit/hooks` whose
 * parameters are `Handle[]`. Kept as derived form per ADR-0058.
 */
export type Handle = Parameters<typeof sequence>[number];
