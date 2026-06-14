import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBufferedEmitter } from '../src/buffered-emitter.js';

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe('createBufferedEmitter', () => {
	it('batches pushes and flushes after bufferMs', () => {
		const onFlush = vi.fn<(batch: readonly number[]) => void>();
		const emitter = createBufferedEmitter({ bufferMs: 50, onFlush });

		emitter.push(1);
		emitter.push(2);
		emitter.push(3);
		expect(onFlush).not.toHaveBeenCalled();
		expect(emitter.size).toBe(3);

		vi.advanceTimersByTime(50);
		expect(onFlush).toHaveBeenCalledOnce();
		expect(onFlush.mock.calls[0]?.[0]).toEqual([1, 2, 3]);
		expect(emitter.size).toBe(0);
	});

	it('flush() drains immediately', () => {
		const onFlush = vi.fn<(batch: readonly string[]) => void>();
		const emitter = createBufferedEmitter({ bufferMs: 100, onFlush });
		emitter.push('a');
		emitter.flush();
		expect(onFlush).toHaveBeenCalledWith(['a']);
	});

	it('flushes synchronously when bufferMs=0', () => {
		const onFlush = vi.fn<(batch: readonly number[]) => void>();
		const emitter = createBufferedEmitter({ bufferMs: 0, onFlush });
		emitter.push(1);
		expect(onFlush).toHaveBeenCalledWith([1]);
	});

	it('stop() drops pending + ignores subsequent pushes', () => {
		const onFlush = vi.fn<(batch: readonly number[]) => void>();
		const emitter = createBufferedEmitter({ bufferMs: 100, onFlush });
		emitter.push(1);
		emitter.stop();
		emitter.push(2);
		vi.advanceTimersByTime(200);
		expect(onFlush).not.toHaveBeenCalled();
	});
});
