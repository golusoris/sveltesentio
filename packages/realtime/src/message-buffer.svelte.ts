import { appendBounded } from './bounded-history.js';
import { createBufferedEmitter } from './buffered-emitter.js';

/**
 * The reactive message history the stream composables keep.
 *
 * `useSSE` and `useConnectStream` held this identically: two `$state` cells, an
 * `append` that trims through {@link appendBounded}, and an optional buffered
 * emitter in front of it. Only the message type differed. `bounded-history.ts`
 * already deduped the trim itself; this takes the rest of the shape with it, so
 * there is one place where "what arrived, bounded, optionally throttled" is
 * decided (HISS-19).
 *
 * It also brings both composables under the 60-line function cap (HISS-04),
 * which they exceeded by carrying this inline.
 */
export interface MessageBuffer<TMessage> {
	/** Newest-last history, at most `historyLimit` entries. */
	readonly messages: TMessage[];
	/** The most recent entry, or `undefined` before anything arrives. */
	readonly lastMessage: TMessage | undefined;
	/** Record one message, through the throttle when one is configured. */
	push(message: TMessage): void;
	/** Stop the throttle. Safe to call when none was configured. */
	stop(): void;
}

/**
 * Creates a message history bounded at `historyLimit`.
 *
 * When `bufferMs` is greater than zero, pushes are collected and flushed at most
 * once per interval, so a high-rate feed cannot thrash the render loop. At zero
 * — the callers' default — each push lands synchronously.
 */
export function createMessageBuffer<TMessage>(
	historyLimit: number,
	bufferMs: number,
): MessageBuffer<TMessage> {
	let messages = $state<TMessage[]>([]);
	let lastMessage = $state<TMessage | undefined>(undefined);

	const append = (batch: readonly TMessage[]): void => {
		if (batch.length === 0) return;
		lastMessage = batch[batch.length - 1];
		messages = appendBounded(messages, batch, historyLimit);
	};

	const emitter =
		bufferMs > 0 ? createBufferedEmitter<TMessage>({ bufferMs, onFlush: append }) : undefined;

	return {
		get messages() {
			return messages;
		},
		get lastMessage() {
			return lastMessage;
		},
		push(message: TMessage): void {
			if (emitter) emitter.push(message);
			else append([message]);
		},
		stop(): void {
			emitter?.stop();
		},
	};
}
