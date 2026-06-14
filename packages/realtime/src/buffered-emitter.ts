export interface BufferedEmitterOptions<T> {
	bufferMs: number;
	onFlush: (batch: readonly T[]) => void;
	setTimeoutImpl?: typeof setTimeout;
	clearTimeoutImpl?: typeof clearTimeout;
}

export interface BufferedEmitter<T> {
	push(value: T): void;
	flush(): void;
	stop(): void;
	readonly size: number;
}

export function createBufferedEmitter<T>(options: BufferedEmitterOptions<T>): BufferedEmitter<T> {
	const setTimer = options.setTimeoutImpl ?? setTimeout;
	const clearTimer = options.clearTimeoutImpl ?? clearTimeout;
	let batch: T[] = [];
	let handle: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;

	const flush = () => {
		if (handle !== undefined) {
			clearTimer(handle);
			handle = undefined;
		}
		if (batch.length === 0) return;
		const current = batch;
		batch = [];
		options.onFlush(current);
	};

	return {
		get size() {
			return batch.length;
		},
		push(value) {
			if (stopped) return;
			batch.push(value);
			if (options.bufferMs <= 0) {
				flush();
				return;
			}
			if (handle === undefined) {
				handle = setTimer(flush, options.bufferMs);
			}
		},
		flush,
		stop() {
			stopped = true;
			if (handle !== undefined) {
				clearTimer(handle);
				handle = undefined;
			}
			batch = [];
		},
	};
}
