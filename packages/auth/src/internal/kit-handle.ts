import type { sequence } from '@sveltejs/kit/hooks';

/**
 * SvelteKit's `Handle` hook type, derived from `sequence` instead of imported by
 * name. SvelteKit 2 exports `Handle` from `@sveltejs/kit` only, SvelteKit 3 from
 * `@sveltejs/kit/hooks` only; `sequence` is exported from `@sveltejs/kit/hooks`
 * by both, and its parameters are `Handle[]` in both. A named import would tie
 * this package to one of the two majors.
 */
export type Handle = Parameters<typeof sequence>[number];
