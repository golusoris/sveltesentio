// Server state belongs in TanStack Query, never a writable() store.
import { createQueryClient, createSentioQuery, isRetryableProblem } from '@sveltesentio/query';

export const client = createQueryClient(); // RFC9457-aware retry: backs off only on retryable Problems

export const user = createSentioQuery(() => ({
	queryKey: ['user', 1],
	queryFn: ({ signal }) => fetch('/api/users/1', { signal }).then((r) => r.json()),
	retry: (n, err) => n < 3 && isRetryableProblem(err),
}));
