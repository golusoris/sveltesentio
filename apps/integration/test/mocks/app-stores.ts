// Stub for SvelteKit's `$app/stores` virtual module (see app-environment.ts).
import { readable } from 'svelte/store';

export const page = readable({ url: new URL('https://integration.test/'), params: {} });
export const navigating = readable(null);
export const updated = readable(false);
