// Stub for SvelteKit's `$app/server` virtual module so the
// `@sveltesentio/forms` barrel (which transitively imports superforms'
// server entry with its server-only guard `import '$app/server';`)
// loads under vitest outside a Kit build.
