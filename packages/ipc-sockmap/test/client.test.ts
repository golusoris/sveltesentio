import { describe, expect, it, vi } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import { createIpcClient, type SocketLike } from '../src/client.js';
import { encodeFrame, type AccessFn } from '../src/transport.js';

type Handler = (...args: never[]) => void;

/**
 * Test double for `node:net.Socket` driven through {@link SocketLike}.
 *
 * Fires `connect` on its own microtask once a listener attaches (mirrors the
 * real socket's async connect), so tests need not count microtask hops.
 */
class FakeSocket implements SocketLike {
	readonly written: Uint8Array[] = [];
	ended = false;
	destroyed = false;
	autoConnect = true;
	private readonly handlers = new Map<string, Set<Handler>>();

	on(event: 'connect', handler: () => void): this;
	on(event: 'data', handler: (chunk: Uint8Array) => void): this;
	on(event: 'error', handler: (error: Error) => void): this;
	on(event: 'close', handler: () => void): this;
	on(event: string, handler: Handler): this {
		if (!this.handlers.has(event)) this.handlers.set(event, new Set());
		this.handlers.get(event)!.add(handler);
		if (event === 'connect' && this.autoConnect) {
			this.autoConnect = false;
			queueMicrotask(() => this.emit('connect'));
		}
		return this;
	}

	write(data: Uint8Array): boolean {
		this.written.push(data);
		return true;
	}

	end(): void {
		this.ended = true;
	}

	destroy(): void {
		this.destroyed = true;
	}

	emit(event: string, ...args: unknown[]): void {
		for (const handler of this.handlers.get(event) ?? []) {
			(handler as (...a: unknown[]) => void)(...args);
		}
	}
}

const reachable = (paths: readonly string[]): AccessFn => async (path: string) => {
	if (!paths.includes(path)) throw new Error(`ENOENT: ${path}`);
};

const SOCK = '/run/golusoris/api.sock';
const MAP = '/sys/fs/bpf/golusoris/sockhash';

/** Create a connected client whose socket the test controls. */
async function connectedClient(opts?: { bpfMapPath?: string; reachablePaths?: string[] }) {
	const socket = new FakeSocket();
	const connect = vi.fn(() => socket);
	const client = await createIpcClient({
		socketPath: SOCK,
		bpfMapPath: opts?.bpfMapPath,
		access: reachable(opts?.reachablePaths ?? [SOCK]),
		connect,
	});
	return { client, socket, connect };
}

describe('createIpcClient', () => {
	it('throws a ProblemError when no transport is reachable', async () => {
		await expect(
			createIpcClient({
				socketPath: SOCK,
				access: reachable([]),
				connect: () => new FakeSocket(),
			}),
		).rejects.toBeInstanceOf(ProblemError);
	});

	it('resolves tier "af_unix" when only the socket exists', async () => {
		const { client } = await connectedClient();
		expect(client.tier).toBe('af_unix');
	});

	it('resolves tier "sockmap" when the pinned BPF map exists', async () => {
		const { client } = await connectedClient({
			bpfMapPath: MAP,
			reachablePaths: [MAP, SOCK],
		});
		expect(client.tier).toBe('sockmap');
	});

	it('connects via the injected factory using the socket path', async () => {
		const { connect } = await connectedClient();
		expect(connect).toHaveBeenCalledWith({ path: SOCK });
	});

	it('frames a request and resolves with the response frame', async () => {
		const { client, socket } = await connectedClient();
		const pending = client.request(Uint8Array.from([0x01, 0x02]));

		expect(socket.written).toHaveLength(1);
		expect(Array.from(socket.written[0]!)).toEqual([0, 0, 0, 2, 0x01, 0x02]);

		socket.emit('data', encodeFrame(Uint8Array.from([0xff, 0xee])));
		expect(Array.from(await pending)).toEqual([0xff, 0xee]);
	});

	it('matches responses to requests in FIFO order', async () => {
		const { client, socket } = await connectedClient();
		const first = client.request(Uint8Array.from([1]));
		const second = client.request(Uint8Array.from([2]));

		socket.emit('data', encodeFrame(Uint8Array.from([0xa1])));
		socket.emit('data', encodeFrame(Uint8Array.from([0xb2])));

		expect(Array.from(await first)).toEqual([0xa1]);
		expect(Array.from(await second)).toEqual([0xb2]);
	});

	it('reassembles a response split across two data chunks', async () => {
		const { client, socket } = await connectedClient();
		const pending = client.request(Uint8Array.from([0]));
		const frame = encodeFrame(Uint8Array.from([0x9, 0x8, 0x7]));
		socket.emit('data', frame.subarray(0, 5));
		socket.emit('data', frame.subarray(5));
		expect(Array.from(await pending)).toEqual([0x9, 0x8, 0x7]);
	});

	it('rejects in-flight requests with a ProblemError on a socket error', async () => {
		const { client, socket } = await connectedClient();
		const pending = client.request(Uint8Array.from([1]));
		socket.emit('error', new Error('ECONNRESET'));
		await expect(pending).rejects.toBeInstanceOf(ProblemError);
	});

	it('rejects with a ProblemError when the peer closes the socket', async () => {
		const { client, socket } = await connectedClient();
		const pending = client.request(Uint8Array.from([1]));
		socket.emit('close');
		await expect(pending).rejects.toBeInstanceOf(ProblemError);
	});

	it('rejects requests issued after close()', async () => {
		const { client, socket } = await connectedClient();
		client.close();
		expect(socket.ended).toBe(true);
		await expect(client.request(Uint8Array.from([1]))).rejects.toBeInstanceOf(ProblemError);
	});

	it('rejects on request timeout', async () => {
		vi.useFakeTimers();
		try {
			const socket = new FakeSocket();
			const client = await createIpcClient({
				socketPath: SOCK,
				access: reachable([SOCK]),
				connect: () => socket,
				requestTimeoutMs: 1000,
			});
			const pending = client.request(Uint8Array.from([1]));
			// attach the rejection assertion before the timer fires so the
			// rejection is never momentarily unhandled
			const assertion = expect(pending).rejects.toBeInstanceOf(ProblemError);
			await vi.advanceTimersByTimeAsync(1001);
			await assertion;
		} finally {
			vi.useRealTimers();
		}
	});

	it('rejects with a ProblemError when a malformed frame is received', async () => {
		const { client, socket } = await connectedClient();
		const pending = client.request(Uint8Array.from([1]));
		const bad = new Uint8Array(4);
		new DataView(bad.buffer).setUint32(0, 0x7fffffff, false); // > MAX_FRAME_BYTES
		socket.emit('data', bad);
		await expect(pending).rejects.toBeInstanceOf(ProblemError);
		expect(socket.destroyed).toBe(true);
	});
});
