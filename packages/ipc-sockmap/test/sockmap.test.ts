import { describe, expect, it } from 'vitest';
import { ProblemError } from '@sveltesentio/core/problem';
import {
  CGROUP_V2_MARKER,
  DEFAULT_PIN_PATH,
  METRIC_NAMES,
  SD_LISTEN_FDS_START,
  activationListeners,
  bpftoolKeyCount,
  kernelAtLeast,
  parseKernelVersion,
  parsePrometheusMetrics,
  probeSockmap,
  readSockmapStats,
  resolveSockmapTier,
} from '../src/sockmap';

describe('parseKernelVersion', () => {
  it('reads major.minor from a uname release', () => {
    expect(parseKernelVersion('5.15.0-91-generic')).toEqual({ major: 5, minor: 15 });
    expect(parseKernelVersion('6.1')).toEqual({ major: 6, minor: 1 });
  });
  it('returns undefined for an unparseable release', () => {
    expect(parseKernelVersion('not-a-kernel')).toBeUndefined();
  });
});

describe('kernelAtLeast', () => {
  it('compares major then minor', () => {
    expect(kernelAtLeast({ major: 6, minor: 0 }, 5, 10)).toBe(true); // major greater
    expect(kernelAtLeast({ major: 4, minor: 99 }, 5, 10)).toBe(false); // major lower
    expect(kernelAtLeast({ major: 5, minor: 10 }, 5, 10)).toBe(true); // equal
    expect(kernelAtLeast({ major: 5, minor: 15 }, 5, 10)).toBe(true); // minor greater
    expect(kernelAtLeast({ major: 5, minor: 4 }, 5, 10)).toBe(false); // minor lower
  });
});

describe('probeSockmap', () => {
  const linux = { platform: 'linux' as const, kernelRelease: '5.15.0' };
  const present = () => Promise.resolve(true);

  it('reports available when every signal passes', async () => {
    const probe = await probeSockmap({ ...linux, exists: present });
    expect(probe).toEqual({
      available: true,
      pinPath: DEFAULT_PIN_PATH,
      kernel: { major: 5, minor: 15 },
    });
  });

  it('honours a custom pin path and probes it', async () => {
    const seen: string[] = [];
    const probe = await probeSockmap({
      ...linux,
      pinPath: '/sys/fs/bpf/custom/sockhash',
      exists: (p) => {
        seen.push(p);
        return Promise.resolve(true);
      },
    });
    expect(probe.available).toBe(true);
    expect(seen).toContain('/sys/fs/bpf/custom/sockhash');
  });

  it('degrades on a non-Linux platform', async () => {
    const probe = await probeSockmap({ platform: 'darwin', exists: present });
    expect(probe).toMatchObject({ available: false, degradeTo: 'af_unix' });
    if (!probe.available) expect(probe.reason).toContain('non-Linux');
  });

  it('degrades on an unparseable kernel release', async () => {
    const probe = await probeSockmap({ platform: 'linux', kernelRelease: 'xx', exists: present });
    expect(probe.available).toBe(false);
    if (!probe.available) expect(probe.reason).toContain('unparseable');
  });

  it('degrades when the kernel is too old', async () => {
    const probe = await probeSockmap({
      platform: 'linux',
      kernelRelease: '5.4.0',
      exists: present,
    });
    expect(probe.available).toBe(false);
    if (!probe.available) expect(probe.reason).toContain('< required 5.10');
  });

  it('degrades when cgroup v2 is absent', async () => {
    const probe = await probeSockmap({
      ...linux,
      exists: (p) => Promise.resolve(p !== CGROUP_V2_MARKER),
    });
    expect(probe.available).toBe(false);
    if (!probe.available) expect(probe.reason).toContain('cgroup v2');
  });

  it('degrades when the pinned sockhash is absent', async () => {
    const probe = await probeSockmap({
      ...linux,
      exists: (p) => Promise.resolve(p === CGROUP_V2_MARKER),
    });
    expect(probe.available).toBe(false);
    if (!probe.available) expect(probe.reason).toContain('pinned sockhash absent');
  });
});

describe('resolveSockmapTier', () => {
  it('maps probe state to the ladder tier', () => {
    expect(
      resolveSockmapTier({ available: true, pinPath: 'x', kernel: { major: 5, minor: 15 } }),
    ).toBe('sockmap');
    expect(resolveSockmapTier({ available: false, degradeTo: 'af_unix', reason: 'x' })).toBe(
      'af_unix',
    );
  });
});

describe('activationListeners', () => {
  it('returns [] when not socket-activated', () => {
    expect(activationListeners({}, 100)).toEqual([]);
    expect(activationListeners({ LISTEN_FDS: '' }, 100)).toEqual([]);
    expect(activationListeners({ LISTEN_FDS: '0' }, 100)).toEqual([]);
  });

  it('adopts FDs from SD_LISTEN_FDS_START with names', () => {
    const got = activationListeners(
      { LISTEN_PID: '100', LISTEN_FDS: '2', LISTEN_FDNAMES: 'api:metrics' },
      100,
    );
    expect(got).toEqual([
      { fd: SD_LISTEN_FDS_START, name: 'api' },
      { fd: SD_LISTEN_FDS_START + 1, name: 'metrics' },
    ]);
  });

  it('falls back to fd-<n> when names are missing, short, or empty', () => {
    expect(activationListeners({ LISTEN_FDS: '2' }, 1)).toEqual([
      { fd: 3, name: 'fd-3' },
      { fd: 4, name: 'fd-4' },
    ]);
    expect(activationListeners({ LISTEN_FDS: '2', LISTEN_FDNAMES: 'api' }, 1)[1]).toEqual({
      fd: 4,
      name: 'fd-4',
    });
    expect(activationListeners({ LISTEN_FDS: '2', LISTEN_FDNAMES: 'api:' }, 1)[1]).toEqual({
      fd: 4,
      name: 'fd-4',
    });
  });

  it('honours the LISTEN_PID guard (env leaks to children)', () => {
    expect(activationListeners({ LISTEN_PID: '999', LISTEN_FDS: '1' }, 100)).toEqual([]);
    // No LISTEN_PID → no guard, adopt anyway.
    expect(activationListeners({ LISTEN_FDS: '1' }, 100)).toHaveLength(1);
  });

  it('throws a ProblemError on a malformed LISTEN_FDS', () => {
    expect(() => activationListeners({ LISTEN_FDS: 'x' }, 1)).toThrow(ProblemError);
    expect(() => activationListeners({ LISTEN_FDS: '-1' }, 1)).toThrow(ProblemError);
  });
});

describe('bpftoolKeyCount', () => {
  it('counts array entries (parsed or raw text)', () => {
    expect(bpftoolKeyCount([{ key: 'a' }, { key: 'b' }])).toBe(2);
    expect(bpftoolKeyCount('[{"key":"a"}]')).toBe(1);
    expect(bpftoolKeyCount('[]')).toBe(0);
  });
  it('returns 0 for non-arrays and bad JSON', () => {
    expect(bpftoolKeyCount('not json')).toBe(0);
    expect(bpftoolKeyCount({ not: 'an array' })).toBe(0);
    expect(bpftoolKeyCount(null)).toBe(0);
  });
});

describe('parsePrometheusMetrics', () => {
  it('extracts the three golusoris sockmap counters', () => {
    const text = [
      '# HELP golusoris_sockmap_redirected_bytes_total bytes',
      `${METRIC_NAMES.redirectedBytes} 4096`,
      `${METRIC_NAMES.activeSockets}{pod="api"} 7`,
      `${METRIC_NAMES.redirectErrors} 0`,
      'unrelated_metric 99',
      '',
    ].join('\n');
    expect(parsePrometheusMetrics(text)).toEqual({
      redirectedBytes: 4096,
      activeSockets: 7,
      redirectErrors: 0,
    });
  });
  it('omits absent counters and skips malformed lines', () => {
    expect(parsePrometheusMetrics('# only a comment\nno_value_here')).toEqual({});
    expect(parsePrometheusMetrics(`${METRIC_NAMES.redirectedBytes} not-a-number`)).toEqual({});
  });
});

describe('readSockmapStats', () => {
  it('reads active sockets from the key counter; metrics optional', async () => {
    const seen: string[] = [];
    const stats = await readSockmapStats({
      countKeys: (p) => {
        seen.push(p);
        return Promise.resolve(3);
      },
    });
    expect(stats).toEqual({
      activeSockets: 3,
      redirectedBytes: undefined,
      redirectErrors: undefined,
    });
    expect(seen).toEqual([DEFAULT_PIN_PATH]);
  });

  it('merges Prometheus counters and a custom pin path', async () => {
    const stats = await readSockmapStats({
      pinPath: '/sys/fs/bpf/custom/sockhash',
      countKeys: () => Promise.resolve(5),
      readMetrics: () => Promise.resolve({ redirectedBytes: 8192, redirectErrors: 1 }),
    });
    expect(stats).toEqual({ activeSockets: 5, redirectedBytes: 8192, redirectErrors: 1 });
  });
});
