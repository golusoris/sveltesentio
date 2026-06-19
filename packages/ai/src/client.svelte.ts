/**
 * Runes-native chat client (ADR-0043: browser side NEVER imports a provider
 * SDK). `useLLMChat` holds the conversation in `$state` and drives it through
 * an injectable {@link ChatTransport} — in production a transport that POSTs to
 * your own `+server.ts` and reads the SSE stream; in tests, a fake async
 * iterable. No network or keys are baked in here, so it unit-tests with fakes.
 */
import type { ChatMessage } from './proxy.js';

/** One streamed text delta from the transport. */
export interface ChatTransportChunk {
	text: string;
}

/** Parameters handed to the transport for a single send. */
export interface ChatTransportRequest {
	messages: readonly ChatMessage[];
	/** Cooperative cancellation for the in-flight request. */
	signal?: AbortSignal | undefined;
}

/**
 * The seam {@link useLLMChat} streams over. A production transport wraps
 * `@sveltesentio/realtime` SSE pointed at the app's `+server.ts` (ADR-0037);
 * a test transport yields a fixed sequence of chunks.
 */
export type ChatTransport = (
	request: ChatTransportRequest,
) => AsyncIterable<ChatTransportChunk>;

export interface UseLLMChatOptions {
	/** Injectable streaming transport (fake in tests; SSE in prod). */
	transport: ChatTransport;
	/** Seed messages (e.g. a system prompt or hydrated history). */
	initialMessages?: readonly ChatMessage[] | undefined;
}

export interface UseLLMChat {
	/** Reactive conversation, oldest first. The streaming reply is the last entry. */
	readonly messages: readonly ChatMessage[];
	/** `true` while a reply is streaming. */
	readonly streaming: boolean;
	/** Last error surfaced by the transport, cleared on the next `send`. */
	readonly error: unknown;
	/**
	 * Append a user message and stream the assistant reply. Resolves when the
	 * stream completes. Calling while already streaming is a no-op.
	 */
	send(content: string): Promise<void>;
	/** Abort the in-flight stream (if any) and clear the streaming flag. */
	stop(): void;
	/** Reset the conversation back to the initial messages and clear error. */
	reset(): void;
}

/**
 * Create a runes-backed chat controller. Hold one per chat surface:
 *
 * ```svelte
 * <script lang="ts">
 *   import { useLLMChat } from '@sveltesentio/ai/client';
 *   const chat = useLLMChat({ transport });
 * </script>
 * ```
 */
export function useLLMChat(options: UseLLMChatOptions): UseLLMChat {
	const seed = options.initialMessages ? [...options.initialMessages] : [];

	let messages = $state<ChatMessage[]>([...seed]);
	let streaming = $state(false);
	let error = $state<unknown>(undefined);
	let controller: AbortController | undefined;

	return {
		get messages() {
			return messages;
		},
		get streaming() {
			return streaming;
		},
		get error() {
			return error;
		},

		async send(content: string): Promise<void> {
			if (streaming) return;
			error = undefined;
			controller = new AbortController();
			streaming = true;

			const userMessage: ChatMessage = { role: 'user', content };
			const reply: ChatMessage = { role: 'assistant', content: '' };
			// One reassignment per push so each `$state` write is observed.
			messages = [...messages, userMessage, reply];
			const replyIndex = messages.length - 1;

			try {
				const stream = options.transport({
					messages: messages.slice(0, replyIndex),
					signal: controller.signal,
				});
				for await (const chunk of stream) {
					const next = [...messages];
					const current = next[replyIndex];
					if (current) {
						next[replyIndex] = {
							role: current.role,
							content: current.content + chunk.text,
						};
					}
					messages = next;
				}
			} catch (err) {
				error = err;
			} finally {
				streaming = false;
				controller = undefined;
			}
		},

		stop(): void {
			controller?.abort();
			controller = undefined;
			streaming = false;
		},

		reset(): void {
			controller?.abort();
			controller = undefined;
			streaming = false;
			error = undefined;
			messages = [...seed];
		},
	};
}
