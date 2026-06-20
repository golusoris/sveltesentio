import { ProblemError } from '@sveltesentio/core/problem';

/**
 * Tier-3 (eBPF SK_MSG sockmap) observability + handoff client for ADR-0051.
 *
 * golusoris's `pkg/sockmap` owns the pinned `BPF_MAP_TYPE_SOCKHASH` and its FD
 * lifecycle (SOCK_OPS populates it from kernel context; it removes entries
 * pre-shutdown). This package is strictly a *map client*: it never writes the
 * map (Node has no `bpf()` syscall, and kernel `struct sock *` values can't be
 * copied to userspace — iterate keys, not values). It does three pure,
 * injectable jobs and otherwise degrades to Tier 1 (AF_UNIX):
 *
 *  1. {@link probeSockmap} — capability probe (Linux ≥5.10, cgroup v2, pin present).
 *  2. {@link activationListeners} — systemd socket-activation FD handoff, the
 *     Node-side mirror of golusoris `sockmap.ActivationListeners`.
 *  3. {@link readSockmapStats} — observability (active sockets via key count,
 *     redirected-bytes / errors via golusoris's Prometheus counters).
 *
 * Every entry point takes injected probes so it unit-tests without a kernel.
 */

import os from 'node:os';
import { access } from 'node:fs/promises';

/** Default pin path of golusoris's sockhash (config key `sockmap.pin_path`). */
export const DEFAULT_PIN_PATH = '/sys/fs/bpf/golusoris/sockhash';

/** Minimum kernel for CO-RE/BTF sockmap (golusoris `min_kernel_{major,minor}`). */
export const MIN_KERNEL_MAJOR = 5;
export const MIN_KERNEL_MINOR = 10;

/** cgroup v2 unified-hierarchy mount + the marker proving v2 (not v1/hybrid). */
export const CGROUP_V2_MOUNT = '/sys/fs/cgroup';
export const CGROUP_V2_MARKER = `${CGROUP_V2_MOUNT}/cgroup.controllers`;

/** systemd socket-activation FDs start at 3 (SD_LISTEN_FDS_START); 0/1/2 are stdio. */
export const SD_LISTEN_FDS_START = 3;

/**
 * golusoris-owned Prometheus counter names. sveltesentio *reads* these for
 * observability and never emits them — golusoris is the source of truth.
 */
export const METRIC_NAMES = {
  redirectedBytes: 'golusoris_sockmap_redirected_bytes_total',
  activeSockets: 'golusoris_sockmap_active_sockets',
  redirectErrors: 'golusoris_sockmap_redirect_errors_total',
} as const;

const SOCKMAP_TYPE = 'https://sveltesentio.dev/problems/ipc-sockmap';

function sockmapError(detail: string, extensions?: Record<string, unknown>): ProblemError {
  return new ProblemError({
    type: SOCKMAP_TYPE,
    title: 'Sockmap activation failed',
    status: 422,
    detail,
    ...(extensions === undefined ? {} : { extensions }),
  });
}

// ---------------------------------------------------------------------------
// 1. Capability probe
// ---------------------------------------------------------------------------

/** A parsed `major.minor` kernel version. */
export interface KernelVersion {
  readonly major: number;
  readonly minor: number;
}

/** Probe outcome when Tier 3 is usable. */
export interface SockmapAvailable {
  readonly available: true;
  readonly pinPath: string;
  readonly kernel: KernelVersion;
}

/** Probe outcome when Tier 3 is not usable; callers degrade to AF_UNIX. */
export interface SockmapUnavailable {
  readonly available: false;
  readonly degradeTo: 'af_unix';
  readonly reason: string;
}

export type SockmapProbe = SockmapAvailable | SockmapUnavailable;

/** Injected existence probe (path → reachable?). Defaults to `fs.access`. */
export type ExistsFn = (path: string) => Promise<boolean>;

/** Inputs to {@link probeSockmap}; every host signal is injectable for tests. */
export interface ProbeOptions {
  /** Pinned sockhash path. Defaults to {@link DEFAULT_PIN_PATH}. */
  readonly pinPath?: string | undefined;
  /** Platform. Defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform | undefined;
  /** Kernel release string (`uname -r`). Defaults to `os.release()`. */
  readonly kernelRelease?: string | undefined;
  /** Path-existence probe. Defaults to `node:fs/promises` `access`. */
  readonly exists?: ExistsFn | undefined;
}

async function fsExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a `uname -r` release (`"5.15.0-91-generic"`) into `{ major, minor }`.
 * Returns `undefined` when the leading `major.minor` can't be read.
 */
export function parseKernelVersion(release: string): KernelVersion | undefined {
  const match = /^(\d+)\.(\d+)/.exec(release);
  if (match === null) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/** True when `kernel` is at least `major.minor`. */
export function kernelAtLeast(kernel: KernelVersion, major: number, minor: number): boolean {
  if (kernel.major !== major) return kernel.major > major;
  return kernel.minor >= minor;
}

function degrade(reason: string): SockmapUnavailable {
  return { available: false, degradeTo: 'af_unix', reason };
}

/**
 * Probe whether the Tier-3 fast path is usable on this host. Checks, in order:
 * Linux platform, kernel ≥ {@link MIN_KERNEL_MAJOR}.{@link MIN_KERNEL_MINOR}, a
 * cgroup v2 unified hierarchy, and the presence of golusoris's pinned sockhash.
 * Never throws — an unusable host returns a {@link SockmapUnavailable} with a
 * human-readable `reason`, so callers transparently stay on Tier 1.
 */
export async function probeSockmap(options: ProbeOptions = {}): Promise<SockmapProbe> {
  const pinPath = options.pinPath ?? DEFAULT_PIN_PATH;
  const platform = options.platform ?? process.platform;
  if (platform !== 'linux') {
    return degrade(
      `non-Linux platform (${platform}); Tier 3 requires Linux ≥${MIN_KERNEL_MAJOR}.${MIN_KERNEL_MINOR}`,
    );
  }
  const release = options.kernelRelease ?? os.release();
  const kernel = parseKernelVersion(release);
  if (kernel === undefined) {
    return degrade(`unparseable kernel release ${JSON.stringify(release)}`);
  }
  if (!kernelAtLeast(kernel, MIN_KERNEL_MAJOR, MIN_KERNEL_MINOR)) {
    return degrade(
      `kernel ${kernel.major}.${kernel.minor} < required ${MIN_KERNEL_MAJOR}.${MIN_KERNEL_MINOR}`,
    );
  }
  const exists = options.exists ?? fsExists;
  if (!(await exists(CGROUP_V2_MARKER))) {
    return degrade(
      `cgroup v2 unified hierarchy not found (${CGROUP_V2_MARKER}); cgroup v1/hybrid is unsupported`,
    );
  }
  if (!(await exists(pinPath))) {
    return degrade(`pinned sockhash absent (${pinPath}); golusoris sockmap not loaded`);
  }
  return { available: true, pinPath, kernel };
}

/** Collapse a probe to the resolved ladder tier. */
export function resolveSockmapTier(probe: SockmapProbe): 'sockmap' | 'af_unix' {
  return probe.available ? 'sockmap' : 'af_unix';
}

// ---------------------------------------------------------------------------
// 2. systemd socket activation (Node-side FD handoff)
// ---------------------------------------------------------------------------

/** An inherited, socket-activated listener FD. */
export interface ActivatedListener {
  /** File descriptor (≥ {@link SD_LISTEN_FDS_START}) to pass to `server.listen({ fd })`. */
  readonly fd: number;
  /** Name from `LISTEN_FDNAMES`, or `fd-<n>` when unnamed. */
  readonly name: string;
}

/** The three systemd socket-activation env vars (subset of `process.env`). */
export interface ActivationEnv {
  readonly LISTEN_PID?: string | undefined;
  readonly LISTEN_FDS?: string | undefined;
  readonly LISTEN_FDNAMES?: string | undefined;
}

function parseFdNames(raw: string | undefined, count: number): readonly string[] {
  if (raw === undefined || raw === '') return [];
  return raw.split(':').slice(0, count);
}

/**
 * Node-side half of the systemd socket-activation handoff — the mirror of
 * golusoris `sockmap.ActivationListeners`. Parses `LISTEN_FDS` / `LISTEN_PID` /
 * `LISTEN_FDNAMES` and returns the inherited listener FDs (numbered from
 * {@link SD_LISTEN_FDS_START}) to hand to `server.listen({ fd })`.
 *
 * Returns `[]` when the process was not socket-activated (`LISTEN_FDS` unset or
 * `0`) or when `LISTEN_PID` names a different process — the env leaks to
 * children, so the PID guard prevents a child adopting its parent's sockets.
 *
 * @throws {ProblemError} when `LISTEN_FDS` is present but not a non-negative integer.
 */
export function activationListeners(
  env: ActivationEnv = process.env,
  selfPid: number = process.pid,
): readonly ActivatedListener[] {
  const rawFds = env.LISTEN_FDS;
  if (rawFds === undefined || rawFds === '') return [];
  const count = Number(rawFds);
  if (!Number.isInteger(count) || count < 0) {
    throw sockmapError(
      `bad LISTEN_FDS ${JSON.stringify(rawFds)} (expected a non-negative integer)`,
      {
        LISTEN_FDS: rawFds,
      },
    );
  }
  if (count === 0) return [];
  const pid = env.LISTEN_PID;
  if (pid !== undefined && pid !== '' && Number(pid) !== selfPid) return [];
  const names = parseFdNames(env.LISTEN_FDNAMES, count);
  const listeners: ActivatedListener[] = [];
  for (let i = 0; i < count; i++) {
    const fd = SD_LISTEN_FDS_START + i;
    const named = names[i];
    listeners.push({ fd, name: named === undefined || named === '' ? `fd-${fd}` : named });
  }
  return listeners;
}

// ---------------------------------------------------------------------------
// 3. Observability
// ---------------------------------------------------------------------------

/** A snapshot of Tier-3 redirect activity. */
export interface SockmapStats {
  /** Live entries in the sockhash — its key count (values are kernel-only). */
  readonly activeSockets: number;
  /** Bytes redirected by the SK_MSG program (golusoris Prometheus counter). */
  readonly redirectedBytes?: number | undefined;
  /** Redirect errors (golusoris Prometheus counter). */
  readonly redirectErrors?: number | undefined;
}

/**
 * Count the keys in a `bpftool map dump pinned <path> --json` payload. The dump
 * is an array of `{ key, value, ... }` entries; we count keys only because the
 * sockhash's `struct sock *` values are ENOSPC from userspace (see
 * golusoris `pkg/sockmap` AGENTS.md). Accepts the parsed JSON or its raw text.
 */
export function bpftoolKeyCount(dump: unknown): number {
  const parsed = typeof dump === 'string' ? safeJsonArray(dump) : dump;
  return Array.isArray(parsed) ? parsed.length : 0;
}

function safeJsonArray(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

/**
 * Extract golusoris's three sockmap counters from a Prometheus exposition text.
 * Unknown / commented (`#`) lines are ignored; absent counters are omitted.
 */
export function parsePrometheusMetrics(
  text: string,
): Partial<Pick<SockmapStats, 'redirectedBytes' | 'redirectErrors'>> & { activeSockets?: number } {
  const out: { redirectedBytes?: number; redirectErrors?: number; activeSockets?: number } = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const space = trimmed.lastIndexOf(' ');
    if (space === -1) continue;
    const name = trimmed.slice(0, space).split('{')[0];
    const value = Number(trimmed.slice(space + 1));
    if (!Number.isFinite(value)) continue;
    if (name === METRIC_NAMES.redirectedBytes) out.redirectedBytes = value;
    else if (name === METRIC_NAMES.redirectErrors) out.redirectErrors = value;
    else if (name === METRIC_NAMES.activeSockets) out.activeSockets = value;
  }
  return out;
}

/** Injected reader returning the sockhash key count for a pin path. */
export type KeyCountReader = (pinPath: string) => Promise<number>;

/** Injected reader for golusoris's Prometheus sockmap counters. */
export type MetricsReader = () => Promise<
  Partial<Pick<SockmapStats, 'redirectedBytes' | 'redirectErrors'>>
>;

/** Inputs to {@link readSockmapStats}. */
export interface StatsOptions {
  /** Pinned sockhash path. Defaults to {@link DEFAULT_PIN_PATH}. */
  readonly pinPath?: string | undefined;
  /** Returns the live key count (e.g. wrapping `bpftool map dump`). */
  readonly countKeys: KeyCountReader;
  /** Optional Prometheus counter reader for redirected-bytes / errors. */
  readonly readMetrics?: MetricsReader | undefined;
}

/**
 * Read a {@link SockmapStats} snapshot. `activeSockets` comes from the injected
 * key counter (values are kernel-only); `redirectedBytes` / `redirectErrors`
 * come from the optional golusoris Prometheus reader. Pure orchestration over
 * the two injected sources, so it tests without a kernel or a metrics endpoint.
 */
export async function readSockmapStats(options: StatsOptions): Promise<SockmapStats> {
  const pinPath = options.pinPath ?? DEFAULT_PIN_PATH;
  const activeSockets = await options.countKeys(pinPath);
  const metrics = options.readMetrics === undefined ? {} : await options.readMetrics();
  return {
    activeSockets,
    redirectedBytes: metrics.redirectedBytes,
    redirectErrors: metrics.redirectErrors,
  };
}
