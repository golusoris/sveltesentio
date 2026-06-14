/**
 * Realtime composition: `@sveltesentio/realtime` `SseClient` (with an injected
 * EventSource factory so it runs without the DOM) plus `computeBackoff` for the
 * reconnect schedule. Proves the realtime surface composes outside a browser.
 */
import { SseClient, computeBackoff } from '@sveltesentio/realtime';
import type { EventSourceFactory, BackoffOptions } from '@sveltesentio/realtime';

/** Build an SSE client for the `/live` stream with an injectable transport. */
export function liveFeedClient(url: string, eventSourceFactory: EventSourceFactory): SseClient {
	return new SseClient({ url, eventSourceFactory });
}

/** Reconnect delay for the n-th attempt, using the realtime backoff curve. */
export function reconnectDelay(attempt: number, options?: BackoffOptions): number {
	return computeBackoff(attempt, options);
}
