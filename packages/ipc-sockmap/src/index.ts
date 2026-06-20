// @sveltesentio/ipc-sockmap — colocated-IPC ladder (ADR-0051).
//
// LANDED: Tier 1 (AF_UNIX) client + the transport-ladder detection model.
// LANDED: Tier 3 (eBPF SK_MSG sockhash) observe/handoff client (golusoris#27
// shipped pkg/sockmap). golusoris owns the pinned sockhash + all map writes;
// this package is a map *client* — capability probe + systemd socket-activation
// FD handoff + key-count / Prometheus observability, degrading to Tier 1 when
// the pin is absent. The acceleration itself stays kernel-side + transparent.

export {
	FRAME_HEADER_BYTES,
	FrameDecoder,
	MAX_FRAME_BYTES,
	decodeFrame,
	detectTransport,
	encodeFrame,
} from './transport.js';
export type {
	AccessFn,
	DecodeResult,
	DetectTransportOptions,
	IpcTier,
} from './transport.js';

export { createIpcClient } from './client.js';
export type {
	ConnectFn,
	IpcClient,
	IpcClientOptions,
	SocketLike,
} from './client.js';

export {
	CGROUP_V2_MARKER,
	CGROUP_V2_MOUNT,
	DEFAULT_PIN_PATH,
	METRIC_NAMES,
	MIN_KERNEL_MAJOR,
	MIN_KERNEL_MINOR,
	SD_LISTEN_FDS_START,
	activationListeners,
	bpftoolKeyCount,
	kernelAtLeast,
	parseKernelVersion,
	parsePrometheusMetrics,
	probeSockmap,
	readSockmapStats,
	resolveSockmapTier,
} from './sockmap.js';
export type {
	ActivatedListener,
	ActivationEnv,
	ExistsFn,
	KernelVersion,
	KeyCountReader,
	MetricsReader,
	ProbeOptions,
	SockmapAvailable,
	SockmapProbe,
	SockmapStats,
	SockmapUnavailable,
	StatsOptions,
} from './sockmap.js';
