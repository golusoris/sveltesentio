import { createRequire } from 'node:module';
import { vi } from 'vitest';

/**
 * Shared mock for `@tanstack/svelte-query` used by the wrapper tests.
 *
 * The monorepo runs vitest in the `node` environment with no Svelte vite
 * plugin, so two things cannot be loaded as-is:
 *   1. The package's `.svelte` re-exports (`HydrationBoundary`,
 *      `QueryClientProvider`) — node's loader cannot parse `.svelte`.
 *   2. The rune-based hooks (`createQuery`/`createMutation`/
 *      `createInfiniteQuery`) — they call `$derived`/`$effect`/`$state` and
 *      read a `QueryClient` out of Svelte component context at runtime.
 *
 * This factory therefore keeps the *real* query-core surface (`QueryClient`,
 * `dehydrate`, `hydrate` — pure, no runes/Svelte) so `query-client.ts` and
 * `hydration.ts` exercise genuine behaviour, while replacing the rune hooks
 * with spies that capture the `Accessor<Options>` (`() => ({...})`) the
 * wrapper hands them. Tests assert on the *shaped options* the accessor
 * returns, which is exactly the wrapper's contract.
 */
export type Accessor<T = Record<string, unknown>> = () => T;

const require_ = createRequire(import.meta.url);
const corePath = createRequire(
	require_.resolve('@tanstack/svelte-query/package.json'),
).resolve('@tanstack/query-core');

export interface SvelteQueryMock {
	createQuery: ReturnType<typeof vi.fn>;
	createMutation: ReturnType<typeof vi.fn>;
	createInfiniteQuery: ReturnType<typeof vi.fn>;
	useQueryClient: ReturnType<typeof vi.fn>;
}

/** Factory passed to `vi.mock('@tanstack/svelte-query', svelteQueryMockFactory)`. */
export async function svelteQueryMockFactory(): Promise<Record<string, unknown>> {
	const core = (await import(corePath)) as Record<string, unknown>;
	return {
		...core,
		// Spread first, then override the two rune hooks + the context reader.
		HydrationBoundary: function HydrationBoundary(): void {},
		QueryClientProvider: function QueryClientProvider(): void {},
		createQuery: vi.fn((accessor: Accessor) => ({ __accessor: accessor })),
		createMutation: vi.fn((accessor: Accessor) => ({ __accessor: accessor })),
		createInfiniteQuery: vi.fn((accessor: Accessor) => ({ __accessor: accessor })),
		useQueryClient: vi.fn(),
	};
}

/** Pull the captured `Accessor<Options>` from the Nth call of a hook spy. */
export function accessorFromCall<T = Record<string, unknown>>(
	spy: ReturnType<typeof vi.fn>,
	call = 0,
): Accessor<T> {
	const calls = (spy as unknown as { mock: { calls: [Accessor<T>][] } }).mock.calls;
	const accessor = calls[call]?.[0];
	if (typeof accessor !== 'function') {
		throw new Error(`hook spy was not called with an accessor function (call ${call})`);
	}
	return accessor;
}
