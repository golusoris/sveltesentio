// Stub for SvelteKit's `$app/environment` virtual module so the
// `@sveltesentio/forms` barrel (which transitively imports superforms'
// SuperDebug.svelte) loads under vitest outside a Kit build. See AGENTS.md note.
export const browser = false;
export const dev = false;
export const building = false;
export const version = 'integration-test';
