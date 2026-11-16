import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	CGROUP_V2_MARKER,
	DEFAULT_PIN_PATH,
	kernelAtLeast,
	parseKernelVersion,
	probeSockmap,
	resolveSockmapTier,
	type ExistsFn,
	type KernelVersion,
	type SockmapProbe,
} from '../src/sockmap.js';

type HostGate = 'platform' | 'kernel' | 'cgroup' | 'pin';

interface AvailableKernelRow {
	readonly label: string;
	readonly release: string;
	readonly kernel: KernelVersion;
}

interface BelowMinKernelRow {
	readonly label: string;
	readonly release: string;
	readonly reason: string;
}

interface UnparseableKernelRow {
	readonly label: string;
	readonly release: string;
}

interface CgroupLayoutRow {
	readonly label: string;
	readonly present: readonly string[];
	readonly expectedProbe: SockmapProbe;
	readonly expectedTier: 'sockmap' | 'af_unix';
	readonly expectedCalls: readonly string[];
}

interface GateOrderRow {
	readonly label: string;
	readonly platform: NodeJS.Platform;
	readonly release: string;
	readonly present: readonly string[];
	readonly expectedReason: string;
	readonly exact: boolean;
	readonly expectedCalls: readonly string[];
}

const PIN_PATH = DEFAULT_PIN_PATH;
const CGROUP_MATRIX_RELEASE = '6.8.0-1015-azure';
const CGROUP_REASON =
	'cgroup v2 unified hierarchy not found (/sys/fs/cgroup/cgroup.controllers); cgroup v1/hybrid is unsupported';
const PIN_REASON = `pinned sockhash absent (${PIN_PATH}); golusoris sockmap not loaded`;
const HYBRID_V2_SUBMOUNT = '/sys/fs/cgroup/unified/cgroup.controllers';
const V1_MEMORY_MOUNT = '/sys/fs/cgroup/memory';
const V1_CPU_MOUNT = '/sys/fs/cgroup/cpu,cpuacct';
const HOST_TAG = `${process.platform} ${os.release()}`;

const ALL_HOST_GATES: readonly HostGate[] = ['platform', 'kernel', 'cgroup', 'pin'];

const GATE_REASON_PATTERNS: Record<HostGate, RegExp> = {
	platform: /^non-Linux platform /,
	kernel: /^(unparseable kernel release |kernel \d+\.\d+ < required )/,
	cgroup: /^cgroup v2 unified hierarchy not found /,
	pin: /^pinned sockhash absent /,
};

const AVAILABLE_KERNEL_ROWS: readonly AvailableKernelRow[] = [
	{
		label: 'exact 5.10 minimum Debian release (boundary)',
		release: '5.10.0-28-amd64',
		kernel: { major: 5, minor: 10 },
	},
	{
		label: 'Amazon Linux 2 5.10 patch release',
		release: '5.10.205-195.807.amzn2.x86_64',
		kernel: { major: 5, minor: 10 },
	},
	{
		label: 'bare three-part 5.11 release',
		release: '5.11.0',
		kernel: { major: 5, minor: 11 },
	},
	{
		label: 'four-part WSL2 5.15 release',
		release: '5.15.153.1-microsoft-standard-WSL2',
		kernel: { major: 5, minor: 15 },
	},
	{
		label: 'major above minimum with minor 0 (boundary)',
		release: '6.0.0',
		kernel: { major: 6, minor: 0 },
	},
	{
		label: 'major above minimum with minor below 10',
		release: '6.8.0-1015-azure',
		kernel: { major: 6, minor: 8 },
	},
	{
		label: 'two-digit major with minor below 10',
		release: '10.2.1',
		kernel: { major: 10, minor: 2 },
	},
];

const BELOW_MIN_KERNEL_ROWS: readonly BelowMinKernelRow[] = [
	{
		label: '5.9 below minimum, sorts after 5.10 as text (boundary)',
		release: '5.9.16',
		reason: 'kernel 5.9 < required 5.10',
	},
	{
		label: 'Ubuntu 5.4 generic LTS release',
		release: '5.4.0-150-generic',
		reason: 'kernel 5.4 < required 5.10',
	},
	{
		label: 'Debian 4.19 with minor above 10 and major below',
		release: '4.19.0-26-amd64',
		reason: 'kernel 4.19 < required 5.10',
	},
	{
		label: 'RHEL 8 4.18 with minor above 10 and major below',
		release: '4.18.0-553.el8_10.x86_64',
		reason: 'kernel 4.18 < required 5.10',
	},
	{
		label: 'RHEL 7 3.10 with minor equal to 10 and major below (boundary)',
		release: '3.10.0-1160.el7.x86_64',
		reason: 'kernel 3.10 < required 5.10',
	},
];

const UNPARSEABLE_KERNEL_ROWS: readonly UnparseableKernelRow[] = [
	{
		label: 'empty release string (boundary)',
		release: '',
	},
	{
		label: 'leading v prefix before version',
		release: 'v5.15',
	},
	{
		label: 'kernel name prefix before version',
		release: 'Linux 5.15',
	},
	{
		label: 'single major integer without minor',
		release: '5',
	},
	{
		label: 'leading dot before major.minor',
		release: '.5.10',
	},
];

const CGROUP_LAYOUT_ROWS: readonly CgroupLayoutRow[] = [
	{
		label: 'unified v2 hierarchy with pin present',
		present: [CGROUP_V2_MARKER, PIN_PATH],
		expectedProbe: {
			available: true,
			pinPath: PIN_PATH,
			kernel: { major: 6, minor: 8 },
		},
		expectedTier: 'sockmap',
		expectedCalls: [CGROUP_V2_MARKER, PIN_PATH],
	},
	{
		label: 'hybrid v1/v2 hierarchy with unified submount',
		present: [HYBRID_V2_SUBMOUNT, V1_MEMORY_MOUNT, PIN_PATH],
		expectedProbe: {
			available: false,
			degradeTo: 'af_unix',
			reason: CGROUP_REASON,
		},
		expectedTier: 'af_unix',
		expectedCalls: [CGROUP_V2_MARKER],
	},
	{
		label: 'legacy cgroup v1 per-controller mounts',
		present: [V1_MEMORY_MOUNT, V1_CPU_MOUNT, PIN_PATH],
		expectedProbe: {
			available: false,
			degradeTo: 'af_unix',
			reason: CGROUP_REASON,
		},
		expectedTier: 'af_unix',
		expectedCalls: [CGROUP_V2_MARKER],
	},
	{
		label: 'no cgroup mount present (boundary)',
		present: [PIN_PATH],
		expectedProbe: {
			available: false,
			degradeTo: 'af_unix',
			reason: CGROUP_REASON,
		},
		expectedTier: 'af_unix',
		expectedCalls: [CGROUP_V2_MARKER],
	},
	{
		label: 'unified v2 hierarchy with pinned sockhash absent',
		present: [CGROUP_V2_MARKER],
		expectedProbe: {
			available: false,
			degradeTo: 'af_unix',
			reason: PIN_REASON,
		},
		expectedTier: 'af_unix',
		expectedCalls: [CGROUP_V2_MARKER, PIN_PATH],
	},
];

const GATE_ORDER_ROWS: readonly GateOrderRow[] = [
	{
		label: 'kernel gate before legacy v1 cgroup gate',
		platform: 'linux',
		release: '4.19.0-26-amd64',
		present: [V1_MEMORY_MOUNT, V1_CPU_MOUNT, PIN_PATH],
		expectedReason: 'kernel 4.19 < required 5.10',
		exact: true,
		expectedCalls: [],
	},
	{
		label: 'darwin platform gate before below-minimum kernel gate',
		platform: 'darwin',
		release: '4.19.0',
		present: [],
		expectedReason: 'non-Linux platform (darwin)',
		exact: false,
		expectedCalls: [],
	},
	{
		label: 'win32 platform gate before qualifying kernel and fs gates',
		platform: 'win32',
		release: '6.8.0',
		present: [CGROUP_V2_MARKER, PIN_PATH],
		expectedReason: 'non-Linux platform (win32)',
		exact: false,
		expectedCalls: [],
	},
	{
		label: 'cgroup v2 gate before absent pin gate',
		platform: 'linux',
		release: CGROUP_MATRIX_RELEASE,
		present: [V1_MEMORY_MOUNT],
		expectedReason: CGROUP_REASON,
		exact: true,
		expectedCalls: [CGROUP_V2_MARKER],
	},
];

/**
 * Build an {@link ExistsFn} that records every probed path in call order and
 * resolves `true` only for paths listed in `present`.
 */
function recordingExists(present: readonly string[]): { exists: ExistsFn; calls: string[] } {
	const calls: string[] = [];
	const exists: ExistsFn = (path: string): Promise<boolean> => {
		calls.push(path);
		return Promise.resolve(present.includes(path));
	};
	return { exists, calls };
}

/**
 * Independently determine which capability gate must fire first on the current
 * host when the pinned sockhash path is absent.
 */
async function expectedHostGate(): Promise<HostGate> {
	if (process.platform !== 'linux') return 'platform';
	const kernel = parseKernelVersion(os.release());
	if (kernel === undefined || !kernelAtLeast(kernel, 5, 10)) return 'kernel';
	try {
		await access(CGROUP_V2_MARKER);
		return 'pin';
	} catch {
		return 'cgroup';
	}
}

describe('probeSockmap kernel release matrix', () => {
	it.each(AVAILABLE_KERNEL_ROWS)('accepts $release ($label)', async (row) => {
		const { exists, calls } = recordingExists([CGROUP_V2_MARKER, PIN_PATH]);
		const probe = await probeSockmap({
			platform: 'linux',
			kernelRelease: row.release,
			pinPath: PIN_PATH,
			exists,
		});
		expect(probe).toEqual({
			available: true,
			pinPath: PIN_PATH,
			kernel: row.kernel,
		});
		expect(resolveSockmapTier(probe)).toBe('sockmap');
		expect(calls).toEqual([CGROUP_V2_MARKER, PIN_PATH]);
	});

	it.each(BELOW_MIN_KERNEL_ROWS)('degrades $release ($label)', async (row) => {
		const { exists, calls } = recordingExists([CGROUP_V2_MARKER, PIN_PATH]);
		const probe = await probeSockmap({
			platform: 'linux',
			kernelRelease: row.release,
			pinPath: PIN_PATH,
			exists,
		});
		expect(probe).toEqual({
			available: false,
			degradeTo: 'af_unix',
			reason: row.reason,
		});
		expect(resolveSockmapTier(probe)).toBe('af_unix');
		expect(calls).toEqual([]);
	});

	it.each(UNPARSEABLE_KERNEL_ROWS)('rejects unparseable $label', async (row) => {
		const { exists, calls } = recordingExists([CGROUP_V2_MARKER, PIN_PATH]);
		const probe = await probeSockmap({
			platform: 'linux',
			kernelRelease: row.release,
			pinPath: PIN_PATH,
			exists,
		});
		expect(probe).toEqual({
			available: false,
			degradeTo: 'af_unix',
			reason: `unparseable kernel release ${JSON.stringify(row.release)}`,
		});
		expect(resolveSockmapTier(probe)).toBe('af_unix');
		expect(calls).toEqual([]);
	});
});

describe('probeSockmap cgroup layout matrix', () => {
	it.each(CGROUP_LAYOUT_ROWS)('handles $label', async (row) => {
		const { exists, calls } = recordingExists(row.present);
		const probe = await probeSockmap({
			platform: 'linux',
			kernelRelease: CGROUP_MATRIX_RELEASE,
			pinPath: PIN_PATH,
			exists,
		});
		expect(probe).toEqual(row.expectedProbe);
		expect(resolveSockmapTier(probe)).toBe(row.expectedTier);
		expect(calls).toEqual(row.expectedCalls);
	});
});

describe('probeSockmap gate order (negative)', () => {
	it.each(GATE_ORDER_ROWS)('enforces $label', async (row) => {
		const { exists, calls } = recordingExists(row.present);
		const probe = await probeSockmap({
			platform: row.platform,
			kernelRelease: row.release,
			pinPath: PIN_PATH,
			exists,
		});
		expect(probe.available).toBe(false);
		if (probe.available) return;
		expect(probe.degradeTo).toBe('af_unix');
		expect(resolveSockmapTier(probe)).toBe('af_unix');
		if (row.exact) {
			expect(probe.reason).toBe(row.expectedReason);
		} else {
			expect(probe.reason.startsWith(row.expectedReason)).toBe(true);
		}
		expect(calls).toEqual(row.expectedCalls);
	});
});

describe('probeSockmap real-host gate attribution (portability legs)', () => {
	let scratchDir = '';
	let absentPath = '';

	beforeAll(async () => {
		scratchDir = await mkdtemp(join(os.tmpdir(), 'sveltesentio-ipc-sockmap-matrix-'));
		absentPath = join(scratchDir, 'sockhash');
	});

	afterAll(async () => {
		await rm(scratchDir, { recursive: true, force: true });
	});

	it(`names the first failing gate on ${HOST_TAG}`, async () => {
		const gate = await expectedHostGate();
		const msg = `expected host gate=${gate} (${HOST_TAG})`;
		const probe = await probeSockmap({ pinPath: absentPath });
		expect(probe.available, msg).toBe(false);
		if (probe.available) return;
		expect(probe.degradeTo, msg).toBe('af_unix');
		expect(resolveSockmapTier(probe), msg).toBe('af_unix');
		expect(probe.reason, msg).toMatch(GATE_REASON_PATTERNS[gate]);
		for (const other of ALL_HOST_GATES) {
			if (other !== gate) {
				const pattern = GATE_REASON_PATTERNS[other];
				expect(probe.reason, `${msg} vs ${other}`).not.toMatch(pattern);
			}
		}
		if (gate === 'pin') {
			expect(probe.reason, msg).toContain(absentPath);
		}
	});
});
