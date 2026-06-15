import { describe, expect, it, vi } from 'vitest';
import { detectTransport, type AccessFn } from '../src/transport.js';

/** Build an access fn that resolves only for the listed reachable paths. */
const accessFor = (reachable: readonly string[]): AccessFn =>
	vi.fn(async (path: string) => {
		if (!reachable.includes(path)) throw new Error(`ENOENT: ${path}`);
	});

const SOCK = '/run/golusoris/api.sock';
const MAP = '/sys/fs/bpf/golusoris/sockhash';

describe('detectTransport', () => {
	it('returns "sockmap" when the pinned BPF map is reachable (Tier 3)', async () => {
		const tier = await detectTransport({
			socketPath: SOCK,
			bpfMapPath: MAP,
			access: accessFor([MAP, SOCK]),
		});
		expect(tier).toBe('sockmap');
	});

	it('prefers Tier 3 over Tier 1 when both paths exist', async () => {
		const access = accessFor([MAP, SOCK]);
		await detectTransport({ socketPath: SOCK, bpfMapPath: MAP, access });
		// the map is probed first; the socket need not be probed at all
		expect(access).toHaveBeenCalledWith(MAP);
	});

	it('falls back to "af_unix" when only the socket exists (Tier 1)', async () => {
		const tier = await detectTransport({
			socketPath: SOCK,
			bpfMapPath: MAP,
			access: accessFor([SOCK]),
		});
		expect(tier).toBe('af_unix');
	});

	it('returns "af_unix" when no bpfMapPath is configured but the socket exists', async () => {
		const tier = await detectTransport({
			socketPath: SOCK,
			access: accessFor([SOCK]),
		});
		expect(tier).toBe('af_unix');
	});

	it('returns "none" when neither path is reachable', async () => {
		const tier = await detectTransport({
			socketPath: SOCK,
			bpfMapPath: MAP,
			access: accessFor([]),
		});
		expect(tier).toBe('none');
	});

	it('never probes the map when bpfMapPath is omitted', async () => {
		const access = accessFor([SOCK]);
		await detectTransport({ socketPath: SOCK, access });
		expect(access).not.toHaveBeenCalledWith(MAP);
		expect(access).toHaveBeenCalledWith(SOCK);
	});

	it('uses the default node:fs/promises probe when no access fn is injected', async () => {
		// No `access` override exercises the lazily-imported `node:fs/promises`
		// default; the paths below cannot exist, so every tier is ruled out.
		const tier = await detectTransport({
			socketPath: '/nonexistent/sveltesentio-ipc-test.sock',
			bpfMapPath: '/nonexistent/sveltesentio-ipc-test.map',
		});
		expect(tier).toBe('none');
	});
});
