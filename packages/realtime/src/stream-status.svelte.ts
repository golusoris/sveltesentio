/// <reference types="svelte" />
import { createMessageBuffer } from './message-buffer.svelte.js';

/**
 * Live getters exposed by {@link StreamStatus}.
 */
export interface StreamStatusGetters<TState extends string, TMessage> {
	/** Current transport or stream state. */
	readonly state: TState;
	/** Most recent message, or `undefined` before the first arrives. */
	readonly lastMessage: TMessage | undefined;
	/** Bounded buffer of recent messages, oldest first. */
	readonly messages: readonly TMessage[];
	/** Last error surfaced by the transport or attempt. */
	readonly error: unknown;
	/** Reconnect attempt counter. */
	readonly attempt: number;
}

/**
 * Shared reactive core for streaming composables (`useSSE` and `useConnectStream`).
 *
 * Encapsulates the reactive `$state` cells for stream state, last error, and
 * reconnect attempt counter, as well as the bounded, throttled message buffer.
 * Exposes explicit live getters and lifecycle mutation helpers (HISS-19).
 */
export interface StreamStatus<TState extends string, TMessage> extends StreamStatusGetters<
	TState,
	TMessage
> {
	/** Transition the current state cell. */
	onStateChange(next: TState): void;
	/** Record a transport error and updated reconnect attempt. */
	onError(err: unknown, nextAttempt: number): void;
	/** Record one message into the buffer. */
	push(message: TMessage): void;
	/** Clear the last recorded error. */
	resetError(): void;
	/** Reset the reconnect attempt counter to 0. */
	resetAttempt(): void;
	/** Stop the message throttle. */
	stop(): void;
	/**
	 * Attach reactive status getters to `target` via `Object.defineProperties` so
	 * each property remains a live getter without object-spread pitfall.
	 *
	 * `NoInfer` keeps `TTarget` inferred from `target` alone: TypeScript 5.5
	 * otherwise infers it from the caller's declared return type and rejects a
	 * target that lacks the getters this call adds.
	 */
	attach<TTarget extends object>(
		target: TTarget,
	): NoInfer<TTarget> & StreamStatusGetters<TState, TMessage>;
}

/**
 * Attaches reactive status getters to `target` via `Object.defineProperties` so
 * each property remains a live getter delegating to `status`.
 */
export function attachStreamStatus<TTarget extends object, TState extends string, TMessage>(
	target: TTarget,
	status: StreamStatus<TState, TMessage>,
): NoInfer<TTarget> & StreamStatusGetters<TState, TMessage> {
	Object.defineProperties(target, {
		state: { get: () => status.state, enumerable: true },
		lastMessage: { get: () => status.lastMessage, enumerable: true },
		messages: { get: () => status.messages, enumerable: true },
		error: { get: () => status.error, enumerable: true },
		attempt: { get: () => status.attempt, enumerable: true },
	});
	return target as TTarget & StreamStatusGetters<TState, TMessage>;
}

/**
 * Creates a stream status container holding reactive `$state` cells and message buffer.
 */
export function createStreamStatus<TState extends string, TMessage>(
	initial: TState,
	historyLimit: number,
	bufferMs: number,
): StreamStatus<TState, TMessage> {
	let state = $state<TState>(initial);
	let error = $state<unknown>(undefined);
	let attempt = $state(0);
	const buffer = createMessageBuffer<TMessage>(historyLimit, bufferMs);

	const status: StreamStatus<TState, TMessage> = {
		get state() {
			return state;
		},
		get lastMessage() {
			return buffer.lastMessage;
		},
		get messages() {
			return buffer.messages;
		},
		get error() {
			return error;
		},
		get attempt() {
			return attempt;
		},
		onStateChange(next: TState): void {
			state = next;
		},
		onError(err: unknown, nextAttempt: number): void {
			error = err;
			attempt = nextAttempt;
		},
		push(message: TMessage): void {
			buffer.push(message);
		},
		resetError(): void {
			error = undefined;
		},
		resetAttempt(): void {
			attempt = 0;
		},
		stop(): void {
			buffer.stop();
		},
		attach<TTarget extends object>(target: TTarget) {
			return attachStreamStatus(target, status);
		},
	};

	return status;
}
