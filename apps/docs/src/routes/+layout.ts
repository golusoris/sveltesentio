import { navGroups } from '$lib/docs';

// Static docs site: prerender everything, no client router needed at runtime
// beyond hydration.
export const prerender = true;

export function load() {
  return { nav: navGroups() };
}
