import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import {
	createIpcClient,
	type ConnectFn,
	type IpcClient,
	type IpcClientOptions,
	type SocketLike,
} from '../src/client.js';
import {
	CGROUP_V2_MARKER,
	probeSockmap,
	resolveSockmapTier,
	type ExistsFn,
	type KernelVersion,
	type SockmapProbe,
} from '../src/sockmap.js';
import { detectTransport, encodeFrame, type AccessFn } from '../src/transport.js';

const SOCK = '/run/golusoris/api.sock';
const MAP = '/sys/fs/bpf/golusoris/sockhash';
const LINUX_RELEASE = '6.8.0-1015-azure';
const EXPECTED_KERNEL: KernelVersion = { major: 6, minor: 8 };

type Handler = (...args: never[]) => void;

interface MutablePaths {
	readonly access: AccessFn;
	readonly exists: ExistsFn;
	readonly add: (p: string) => void;
	readonly remove: (p: string) => void;
}

interface ConnectedPeer {
	readonly client: IpcClient;
	readonly socket: FakeSocket;
}

interface ClientHarness {
	readonly paths: MutablePaths;
	readonly connectCalls: { path: string }[];
	readonly open: () => Promise<ConnectedPeer>;
}

/**
 * Test double for `node:net.Socket` driven through {@link SocketLike}.
 *
 * Emits `connect` on a microtask once a listener attaches so client handshake
 * completes without a real socket or timer.
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
		let listeners = this.handlers.get(event);
		if (listeners === undefined) {
			listeners = new Set();
			this.handlers.set(event, listeners);
		}
		listeners.add(handler);
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

/**
 * Build mutable `access` and `exists` probes backed by one `Set` so tests can
 * flip path reachability between calls.
 */
function mutablePaths(initial: readonly string[]): MutablePaths {
	const reachable = new Set<string>(initial);
	return {
		access: (p: string): Promise<void> => {
			if (!reachable.has(p)) {
				return Promise.reject(new Error(`ENOENT: ${p}`));
			}
			return Promise.resolve();
		},
		exists: (p: string): Promise<boolean> => Promise.resolve(reachable.has(p)),
		add: (p: string): void => {
			reachable.add(p);
		},
		remove: (p: string): void => {
			reachable.delete(p);
		},
	};
}

/** Format the exact degrade reason {@link probeSockmap} emits when `pinPath` is absent. */
function pinAbsentReason(pinPath: string): string {
	return `pinned sockhash absent (${pinPath}); golusoris sockmap not loaded`;
}

/**
 * Run {@link probeSockmap} with a qualifying Linux 6.8 release against `exists`
 * and `pinPath`.
 */
function probeLinux(exists: ExistsFn, pinPath: string = MAP): Promise<SockmapProbe> {
	return probeSockmap({
		platform: 'linux',
		kernelRelease: LINUX_RELEASE,
		pinPath,
		exists,
	});
}

/**
 * Wire a {@link FakeSocket} connector and {@link mutablePaths} seam so tests
 * can open sequential clients while flipping path reachability between them.
 */
function createClientHarness(initial: readonly string[]): ClientHarness {
	const paths = mutablePaths(initial);
	const connectCalls: { path: string }[] = [];
	const baseOptions: Omit<IpcClientOptions, 'connect'> = {
		socketPath: SOCK,
		bpfMapPath: MAP,
		access: paths.access,
	};
	return {
		paths,
		connectCalls,
		open: async (): Promise<ConnectedPeer> => {
			const socket = new FakeSocket();
			const connect: ConnectFn = (options) => {
				connectCalls.push(options);
				return socket;
			};
			const client = await createIpcClient({ ...baseOptions, connect });
			return { client, socket };
		},
	};
}

/**
 * Issue a single-byte framed request on `client`, assert one frame was written
 * to `socket`, emit a single-byte framed response, and return the decoded reply.
 */
function exchangeFrame(
	client: IpcClient,
	socket: FakeSocket,
	reqByte: number,
	resByte: number,
): Promise<Uint8Array> {
	const beforeCount = socket.written.length;
	const payload = Uint8Array.from([reqByte]);
	const pending = client.request(payload);
	expect(socket.written).toHaveLength(beforeCount + 1);
	expect(socket.written[beforeCount]).toEqual(encodeFrame(payload));
	socket.emit('data', encodeFrame(Uint8Array.from([resByte])));
	return pending;
}

/**
 * Check whether `path` is reachable on the real filesystem via `fs.access`,
 * resolving `true` on success and `false` on error.
 */
async function realPathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Probe `exists` seam that stubs {@link CGROUP_V2_MARKER} for non-Linux CI
 * runners and checks every other path with `fs.access`.
 */
function tempPinExists(p: string): Promise<boolean> {
	return p === CGROUP_V2_MARKER ? Promise.resolve(true) : realPathExists(p);
}

describe('probeSockmap across runtime unpin', () => {
	it('degrades on unpin and recovers on re-pin (positive)', async () => {
		const paths = mutablePaths([CGROUP_V2_MARKER, MAP]);

		const initial = await probeLinux(paths.exists);
		expect(initial).toEqual({
			available: true,
			pinPath: MAP,
			kernel: EXPECTED_KERNEL,
		});
		expect(resolveSockmapTier(initial)).toBe('sockmap');

		paths.remove(MAP);
		const unpinned = await probeLinux(paths.exists);
		expect(unpinned).toEqual({
			available: false,
			degradeTo: 'af_unix',
			reason: pinAbsentReason(MAP),
		});
		expect(resolveSockmapTier(unpinned)).toBe('af_unix');

		paths.add(MAP);
		const recovered = await probeLinux(paths.exists);
		expect(recovered).toEqual({
			available: true,
			pinPath: MAP,
			kernel: EXPECTED_KERNEL,
		});
		expect(resolveSockmapTier(recovered)).toBe('sockmap');
	});

	it('reads live state after unpin and re-pin between probes (boundary)', async () => {
		const paths = mutablePaths([CGROUP_V2_MARKER, MAP]);
		expect((await probeLinux(paths.exists)).available).toBe(true);

		paths.remove(MAP);
		paths.add(MAP);

		const after = await probeLinux(paths.exists);
		expect(after).toEqual({
			available: true,
			pinPath: MAP,
			kernel: EXPECTED_KERNEL,
		});
		expect(resolveSockmapTier(after)).toBe('sockmap');
	});

	it('stays available when an unrelated path is removed (negative)', async () => {
		const otherPath = '/sys/fs/bpf/other/sockhash';
		const paths = mutablePaths([CGROUP_V2_MARKER, MAP, otherPath]);
		expect((await probeLinux(paths.exists)).available).toBe(true);

		paths.remove(otherPath);

		const after = await probeLinux(paths.exists);
		expect(after).toEqual({
			available: true,
			pinPath: MAP,
			kernel: EXPECTED_KERNEL,
		});
		expect(resolveSockmapTier(after)).toBe('sockmap');
	});
});

describe('detectTransport across runtime unpin', () => {
	it('steps through sockmap, af_unix, and none as paths flip (positive)', async () => {
		const paths = mutablePaths([MAP, SOCK]);
		const opts = { socketPath: SOCK, bpfMapPath: MAP, access: paths.access };

		expect(await detectTransport(opts)).toBe('sockmap');

		paths.remove(MAP);
		expect(await detectTransport(opts)).toBe('af_unix');

		paths.add(MAP);
		expect(await detectTransport(opts)).toBe('sockmap');

		paths.remove(MAP);
		paths.remove(SOCK);
		expect(await detectTransport(opts)).toBe('none');

		paths.add(SOCK);
		expect(await detectTransport(opts)).toBe('af_unix');
	});

	it('retains sockmap when unpinned and re-pinned between calls (boundary)', async () => {
		const paths = mutablePaths([MAP, SOCK]);
		const opts = { socketPath: SOCK, bpfMapPath: MAP, access: paths.access };

		expect(await detectTransport(opts)).toBe('sockmap');
		paths.remove(MAP);
		paths.add(MAP);
		expect(await detectTransport(opts)).toBe('sockmap');
	});

	it('ignores unrelated path removal during tier detection (negative)', async () => {
		const otherPath = '/run/golusoris/other.sock';
		const paths = mutablePaths([MAP, SOCK, otherPath]);
		const opts = { socketPath: SOCK, bpfMapPath: MAP, access: paths.access };

		expect(await detectTransport(opts)).toBe('sockmap');
		paths.remove(otherPath);
		expect(await detectTransport(opts)).toBe('sockmap');
	});
});

describe('createIpcClient across runtime unpin', () => {
	it('keeps established client alive while new clients adapt (positive)', async () => {
		const harness = createClientHarness([MAP, SOCK]);

		const first = await harness.open();
		expect(first.client.tier).toBe('sockmap');
		expect(harness.connectCalls).toHaveLength(1);
		expect(harness.connectCalls[0]).toEqual({ path: SOCK });

		harness.paths.remove(MAP);
		const reply = await exchangeFrame(first.client, first.socket, 0x11, 0x22);
		expect(reply).toEqual(Uint8Array.from([0x22]));
		expect(first.client.tier).toBe('sockmap');
		expect(harness.connectCalls).toHaveLength(1);

		const second = await harness.open();
		expect(second.client.tier).toBe('af_unix');
		expect(harness.connectCalls).toHaveLength(2);
		expect(harness.connectCalls[1]).toEqual({ path: SOCK });

		harness.paths.add(MAP);
		const third = await harness.open();
		expect(third.client.tier).toBe('sockmap');
		expect(harness.connectCalls).toHaveLength(3);
		expect(harness.connectCalls[2]).toEqual({ path: SOCK });
	});

	it('preserves af_unix connect tier after pin is restored (boundary)', async () => {
		const harness = createClientHarness([SOCK]);

		const degraded = await harness.open();
		expect(degraded.client.tier).toBe('af_unix');

		harness.paths.add(MAP);
		const reply = await exchangeFrame(degraded.client, degraded.socket, 0x05, 0x06);
		expect(reply).toEqual(Uint8Array.from([0x06]));
		expect(degraded.client.tier).toBe('af_unix');
		expect(harness.connectCalls).toHaveLength(1);

		const upgraded = await harness.open();
		expect(upgraded.client.tier).toBe('sockmap');
		expect(harness.connectCalls).toHaveLength(2);
		expect(harness.connectCalls[1]).toEqual({ path: SOCK });
	});

	it('rejects fourth client when socket vanishes while first serves (negative)', async () => {
		const harness = createClientHarness([MAP, SOCK]);
		const first = await harness.open();

		harness.paths.remove(MAP);
		const second = await harness.open();
		expect(second.client.tier).toBe('af_unix');

		harness.paths.add(MAP);
		const third = await harness.open();
		expect(third.client.tier).toBe('sockmap');

		harness.paths.remove(MAP);
		harness.paths.remove(SOCK);
		await expect(harness.open()).rejects.toBeInstanceOf(ProblemError);
		expect(harness.connectCalls).toHaveLength(3);

		const reply = await exchangeFrame(first.client, first.socket, 0x33, 0x44);
		expect(reply).toEqual(Uint8Array.from([0x44]));
		expect(first.client.tier).toBe('sockmap');
	});
});

describe('real filesystem unpin and recovery', () => {
	let dir = '';
	let pinPath = '';
	let socketPath = '';

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'sveltesentio-sockmap-unpin-'));
		pinPath = join(dir, 'sockhash');
		socketPath = join(dir, 'api.sock');
		await writeFile(pinPath, '');
		await writeFile(socketPath, '');
	});

	afterEach(async () => {
		if (dir === '') return;
		await rm(dir, { recursive: true, force: true });
		dir = '';
	});

	it('re-evaluates default detectTransport across rm and writeFile (positive)', async () => {
		expect(await detectTransport({ socketPath, bpfMapPath: pinPath })).toBe('sockmap');

		await rm(pinPath);
		expect(await detectTransport({ socketPath, bpfMapPath: pinPath })).toBe('af_unix');

		await writeFile(pinPath, '');
		expect(await detectTransport({ socketPath, bpfMapPath: pinPath })).toBe('sockmap');
	});

	it('re-evaluates probeSockmap against real pin rm and writeFile (positive)', async () => {
		const initial = await probeLinux(tempPinExists, pinPath);
		expect(initial).toEqual({
			available: true,
			pinPath,
			kernel: EXPECTED_KERNEL,
		});
		expect(resolveSockmapTier(initial)).toBe('sockmap');

		await rm(pinPath);
		const unpinned = await probeLinux(tempPinExists, pinPath);
		expect(unpinned).toEqual({
			available: false,
			degradeTo: 'af_unix',
			reason: pinAbsentReason(pinPath),
		});
		expect(resolveSockmapTier(unpinned)).toBe('af_unix');

		await writeFile(pinPath, '');
		const recovered = await probeLinux(tempPinExists, pinPath);
		expect(recovered).toEqual({
			available: true,
			pinPath,
			kernel: EXPECTED_KERNEL,
		});
		expect(resolveSockmapTier(recovered)).toBe('sockmap');
	});

	it('sees sockmap when pin is unlinked and recreated before probe (boundary)', async () => {
		expect(await detectTransport({ socketPath, bpfMapPath: pinPath })).toBe('sockmap');

		await rm(pinPath);
		await writeFile(pinPath, '');

		expect(await detectTransport({ socketPath, bpfMapPath: pinPath })).toBe('sockmap');
		const probe = await probeLinux(tempPinExists, pinPath);
		expect(probe).toEqual({
			available: true,
			pinPath,
			kernel: EXPECTED_KERNEL,
		});
	});

	it('reports none and rejects client when both temp files vanish (negative)', async () => {
		expect(await detectTransport({ socketPath, bpfMapPath: pinPath })).toBe('sockmap');

		await rm(pinPath);
		await rm(socketPath);

		expect(await detectTransport({ socketPath, bpfMapPath: pinPath })).toBe('none');
		await expect(
			createIpcClient({
				socketPath,
				bpfMapPath: pinPath,
				connect: () => new FakeSocket(),
			}),
		).rejects.toBeInstanceOf(ProblemError);
	});
});
