import { vi } from 'vitest';

// Modules in @sveltesentio/query import QueryClient, dehydrate, HydrationBoundary,
// or QueryClientProvider from @tanstack/svelte-query, whose barrel re-exports `.svelte`
// files and rune hooks. The mock stubs those component exports while keeping the real
// query-core QueryClient and dehydrate intact so files import cleanly in node.
// The factory is dynamically imported *inside* the mock body so `vi.mock`
// hoisting does not hit the helper's temporal dead zone.
vi.mock('@tanstack/svelte-query', async () => {
	const { svelteQueryMockFactory } = await import('./_svelte-query-mock.js');
	return svelteQueryMockFactory();
});
