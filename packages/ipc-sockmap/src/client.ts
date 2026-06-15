import { ProblemError } from '@sveltesentio/core';
import {
	FrameDecoder,
	detectTransport,
	encodeFrame,
	type AccessFn,
	type IpcTier,
} from './transport.js';

/**
 * Colocated-IPC client over AF_UNIX (Tier 1 of ADR-0051).
 *
 * Speaks length-prefixed frames (see {@link encodeFrame}) over a Unix domain
 * socket. eBPF SK_MSG acceleration (Tier 3) is transparent and kernel-side: once
 * golusoris#27 pins the `BPF_MAP_TYPE_SOCKHASH`, the kernel redirects these same
 * socket buffers without stack traversal — no client code change. The resolved
 * tier is exposed via {@link IpcClient.tier} for observability only.
 */

const CONNECT_TYPE = 'https://sveltesentio.dev/problems/ipc-connect';
const REQUEST_TYPE = 'https://sveltesentio.dev/problems/ipc-request';

/** Minimal slice of `node:net.Socket` the client drives — keeps the seam fake-able. */
export interface SocketLike {
	on(event: 'connect', handler: () => void): this;
	on(event: 'data', handler: (chunk: Uint8Array) => void): this;
	on(event: 'error', handler: (error: Error) => void): this;
	on(event: 'close', handler: () => void): this;
	write(data: Uint8Array): boolean;
	end(): void;
	destroy(error?: Error): void;
}

/** Factory producing a connecting {@link SocketLike}. Mirrors `net.createConnection`. */
export type ConnectFn = (options: { path: string }) => SocketLike;

/** Inputs to {@link createIpcClient}. */
export interface IpcClientOptions {
	/** AF_UNIX socket path (Tier 1). */
	readonly socketPath: string;
	/** Pinned BPF sockhash path (Tier 3 detection); informational only today. */
	readonly bpfMapPath?: string | undefined;
	/** Socket factory. Defaults to `node:net` `createConnection`. */
	readonly connect?: ConnectFn | undefined;
	/** Path-reachability probe forwarded to {@link detectTransport}. */
	readonly access?: AccessFn | undefined;
	/** Per-request ceiling in milliseconds. Omit to disable. */
	readonly requestTimeoutMs?: number | undefined;
}

/** A connected colocated-IPC client. */
export interface IpcClient {
	/** Ladder tier resolved at connect time (`'sockmap' | 'af_unix'`). */
	readonly tier: Exclude<IpcTier, 'none'>;
	/** Send one frame and await exactly one response frame. */
	request(payload: Uint8Array): Promise<Uint8Array>;
	/** Close the underlying socket. */
	close(): void;
}

interface PendingRequest {
	resolve(payload: Uint8Array): void;
	reject(error: ProblemError): void;
	timer: ReturnType<typeof setTimeout> | undefined;
}

let defaultConnect: ConnectFn | undefined;

async function resolveConnect(connect: ConnectFn | undefined): Promise<ConnectFn> {
	if (connect) return connect;
	if (!defaultConnect) {
		const { createConnection } = await import('node:net');
		defaultConnect = (options: { path: string }): SocketLike => createConnection(options);
	}
	return defaultConnect;
}

function connectError(detail: string, cause?: unknown): ProblemError {
	return new ProblemError({
		type: CONNECT_TYPE,
		title: 'IPC connect failed',
		status: 502,
		detail,
		...(cause === undefined ? {} : { cause }),
	});
}

function requestError(detail: string, status: number, cause?: unknown): ProblemError {
	return new ProblemError({
		type: REQUEST_TYPE,
		title: 'IPC request failed',
		status,
		detail,
		...(cause === undefined ? {} : { cause }),
	});
}

/**
 * Connect a colocated-IPC client over AF_UNIX.
 *
 * Probes the ladder ({@link detectTransport}); throws {@link ProblemError} when
 * no tier is reachable. Establishes the socket via the injected (or default
 * `node:net`) factory and rejects with {@link ProblemError} on connect/transport
 * failure. Requests are strictly framed: one request frame, one response frame.
 *
 * @throws {ProblemError} when no tier is reachable or the socket errors before connecting.
 */
export async function createIpcClient(options: IpcClientOptions): Promise<IpcClient> {
	const tier = await detectTransport({
		socketPath: options.socketPath,
		bpfMapPath: options.bpfMapPath,
		access: options.access,
	});
	if (tier === 'none') {
		throw connectError(
			`No colocated-IPC transport reachable at socket ${options.socketPath}`,
		);
	}

	const connect = await resolveConnect(options.connect);
	const decoder = new FrameDecoder();
	const queue: PendingRequest[] = [];
	let closed = false;
	let connected = false;
	let fatal: ProblemError | undefined;

	const socket = connect({ path: options.socketPath });

	const failAll = (error: ProblemError): void => {
		fatal = error;
		while (queue.length > 0) {
			const pending = queue.shift();
			if (!pending) continue;
			if (pending.timer !== undefined) clearTimeout(pending.timer);
			pending.reject(error);
		}
	};

	await new Promise<void>((resolve, reject) => {
		const onConnect = (): void => {
			connected = true;
			resolve();
		};
		const onConnectError = (error: Error): void => {
			if (!connected) reject(connectError('Socket errored before connect', error));
		};
		socket.on('connect', onConnect);
		socket.on('error', onConnectError);
	});

	socket.on('error', (error: Error) => {
		failAll(requestError('Socket transport error', 502, error));
	});
	socket.on('close', () => {
		if (!closed) failAll(requestError('Socket closed by peer', 502));
		closed = true;
	});
	socket.on('data', (chunk: Uint8Array) => {
		let result;
		try {
			result = decoder.push(chunk);
		} catch (error) {
			failAll(
				error instanceof ProblemError
					? error
					: requestError('Frame decode error', 422, error),
			);
			socket.destroy();
			return;
		}
		for (const frame of result.frames) {
			const pending = queue.shift();
			if (!pending) continue;
			if (pending.timer !== undefined) clearTimeout(pending.timer);
			pending.resolve(frame);
		}
	});

	return {
		tier,
		request(payload: Uint8Array): Promise<Uint8Array> {
			if (fatal) return Promise.reject(fatal);
			if (closed) {
				return Promise.reject(requestError('Client is closed', 409));
			}
			return new Promise<Uint8Array>((resolve, reject) => {
				const pending: PendingRequest = { resolve, reject, timer: undefined };
				if (options.requestTimeoutMs !== undefined) {
					pending.timer = setTimeout(() => {
						const index = queue.indexOf(pending);
						if (index >= 0) queue.splice(index, 1);
						reject(
							requestError(
								`Request timed out after ${options.requestTimeoutMs}ms`,
								504,
							),
						);
					}, options.requestTimeoutMs);
				}
				queue.push(pending);
				try {
					socket.write(encodeFrame(payload));
				} catch (error) {
					const index = queue.indexOf(pending);
					if (index >= 0) queue.splice(index, 1);
					if (pending.timer !== undefined) clearTimeout(pending.timer);
					reject(
						error instanceof ProblemError
							? error
							: requestError('Socket write failed', 502, error),
					);
				}
			});
		},
		close(): void {
			if (closed) return;
			closed = true;
			decoder.reset();
			socket.end();
		},
	};
}
