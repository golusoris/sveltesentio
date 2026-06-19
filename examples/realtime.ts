// SSE client + ConnectRPC streams with jittered backoff.
import { SseClient, computeBackoff, createConnectStream } from '@sveltesentio/realtime';

const sse = new SseClient('/api/events');
sse.subscribe((msg) => console.warn('event', msg));
const delay = computeBackoff(attempt); // capped exponential + full jitter
