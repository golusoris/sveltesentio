export { computeBackoff } from './backoff.js';
export type { BackoffOptions } from './backoff.js';

export { createBufferedEmitter } from './buffered-emitter.js';
export type { BufferedEmitter, BufferedEmitterOptions } from './buffered-emitter.js';

export { SseClient } from './sse-client.js';
export type {
	EventSourceFactory,
	EventSourceLike,
	SseClientOptions,
	SseClientState,
	SseEventLike,
} from './sse-client.js';
