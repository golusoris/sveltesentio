import { QueryClient, type QueryClientConfig } from '@tanstack/svelte-query';
import { isRetryableProblem } from './retry.js';

export { isRetryableProblem } from './retry.js';

export interface CreateQueryClientOptions {
	/** Base stale time for queries, ms (default 30_000). */
	staleTime?: number;
	/** Max attempts for retryable failures (default 3). */
	maxRetries?: number;
	/** Extra QueryClientConfig merged over the sveltesentio defaults. */
	config?: QueryClientConfig;
}

/**
 * Create a TanStack `QueryClient` with sveltesentio defaults: 30s stale time and
 * an RFC 9457-aware retry policy (no retries on typed 4xx, exponential backoff
 * capped at 30s on transient failures). Pass `config` to override.
 */
export function createQueryClient(options: CreateQueryClientOptions = {}): QueryClient {
	const { staleTime = 30_000, maxRetries = 3, config } = options;
	return new QueryClient({
		...config,
		defaultOptions: {
			...config?.defaultOptions,
			queries: {
				staleTime,
				retry: (failureCount, error) => failureCount < maxRetries && isRetryableProblem(error),
				retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 30_000),
				...config?.defaultOptions?.queries,
			},
		},
	});
}
