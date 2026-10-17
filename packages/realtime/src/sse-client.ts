import { computeBackoff, type BackoffOptions } from './backoff.js';

export interface SseEventLike {
	readonly type: string;
	readonly data: string;
	readonly lastEventId?: string;
}

export type EventSourceLike = {
	addEventListener(type: string, handler: (event: unknown) => void): void;
	removeEventListener(type: string, handler: (event: unknown) => void): void;
	close(): void;
};

export type EventSourceFactory = (
	url: string,
	init?: { withCredentials?: boolean },
) => EventSourceLike;

export type SseClientState = 'idle' | 'connecting' | 'open' | 'closed';

export interface SseClientOptions {
	url: string;
	withCredentials?: boolean;
	backoff?: BackoffOptions;
	eventSourceFactory?: EventSourceFactory;
	setTimeoutImpl?: typeof setTimeout;
	clearTimeoutImpl?: typeof clearTimeout;
	/** Named SSE event types to listen for besides `message`; delivered through onMessage with `type` = event name. */
	events?: readonly string[];
	onOpen?: () => void;
	onMessage?: (event: SseEventLike) => void;
	onError?: (error: unknown, attempt: number) => void;
	onStateChange?: (state: SseClientState) => void;
}

export class SseClient {
	private readonly options: SseClientOptions;
	private source: EventSourceLike | undefined;
	private attempt = 0;
	private reconnectHandle: ReturnType<typeof setTimeout> | undefined;
	private state: SseClientState = 'idle';
	private readonly setTimer: typeof setTimeout;
	private readonly clearTimer: typeof clearTimeout;
	private readonly factory: EventSourceFactory;
	private namedHandlers: Array<[string, (event: unknown) => void]> = [];

	constructor(options: SseClientOptions) {
		this.options = options;
		this.setTimer = options.setTimeoutImpl ?? setTimeout;
		this.clearTimer = options.clearTimeoutImpl ?? clearTimeout;
		const factory = options.eventSourceFactory ?? defaultFactory;
		if (!factory) {
			throw new Error('SseClient requires an eventSourceFactory (no global EventSource present)');
		}
		this.factory = factory;
	}

	get currentState(): SseClientState {
		return this.state;
	}

	get currentAttempt(): number {
		return this.attempt;
	}

	start(): void {
		if (this.state === 'connecting' || this.state === 'open') return;
		this.connect();
	}

	close(): void {
		this.clearReconnect();
		this.teardownSource();
		this.setState('closed');
	}

	private connect(): void {
		this.setState('connecting');
		const source = this.factory(this.options.url, {
			withCredentials: this.options.withCredentials ?? false,
		});
		this.source = source;
		source.addEventListener('open', this.handleOpen);
		source.addEventListener('message', this.handleMessage);
		source.addEventListener('error', this.handleError);
		this.registerNamedListeners(source);
	}

	private registerNamedListeners(source: EventSourceLike): void {
		if (!this.options.events) return;
		const seen = new Set<string>(['message', 'open', 'error', '']);
		for (const name of this.options.events) {
			if (seen.has(name)) continue;
			seen.add(name);
			const handler = (event: unknown): void => {
				this.deliver(event, name);
			};
			this.namedHandlers.push([name, handler]);
			source.addEventListener(name, handler);
		}
	}

	private handleOpen = (): void => {
		this.attempt = 0;
		this.setState('open');
		this.options.onOpen?.();
	};

	private handleMessage = (event: unknown): void => {
		this.deliver(event, 'message');
	};

	private deliver(event: unknown, fallbackType: string): void {
		const evt = event as Partial<SseEventLike>;
		const payload: SseEventLike = {
			type: typeof evt.type === 'string' ? evt.type : fallbackType,
			data: typeof evt.data === 'string' ? evt.data : '',
			...(typeof evt.lastEventId === 'string' ? { lastEventId: evt.lastEventId } : {}),
		};
		this.options.onMessage?.(payload);
	}

	private handleError = (error: unknown): void => {
		this.options.onError?.(error, this.attempt);
		this.teardownSource();
		this.scheduleReconnect();
	};

	private scheduleReconnect(): void {
		this.attempt += 1;
		const delay = computeBackoff(this.attempt, this.options.backoff);
		this.setState('connecting');
		this.reconnectHandle = this.setTimer(() => {
			this.reconnectHandle = undefined;
			this.connect();
		}, delay);
	}

	private clearReconnect(): void {
		if (this.reconnectHandle !== undefined) {
			this.clearTimer(this.reconnectHandle);
			this.reconnectHandle = undefined;
		}
	}

	private teardownSource(): void {
		if (!this.source) return;
		this.source.removeEventListener('open', this.handleOpen);
		this.source.removeEventListener('message', this.handleMessage);
		this.source.removeEventListener('error', this.handleError);
		for (const [name, handler] of this.namedHandlers) {
			this.source.removeEventListener(name, handler);
		}
		this.namedHandlers = [];
		this.source.close();
		this.source = undefined;
	}

	private setState(next: SseClientState): void {
		if (this.state === next) return;
		this.state = next;
		this.options.onStateChange?.(next);
	}
}

const defaultFactory: EventSourceFactory | undefined = (() => {
	const es = (globalThis as { EventSource?: unknown }).EventSource;
	if (typeof es !== 'function') return undefined;
	return (url: string, init?: { withCredentials?: boolean }) => {
		const Ctor = es as new (url: string, init?: { withCredentials?: boolean }) => EventSourceLike;
		return new Ctor(url, init);
	};
})();
