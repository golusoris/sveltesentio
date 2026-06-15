// @sveltesentio/ipc-sockmap — colocated-IPC ladder (ADR-0051).
//
// LANDED: Tier 1 (AF_UNIX) client + the transport-ladder detection model.
// PENDING: Tier 3 (eBPF SK_MSG sockhash) kernel-bypass registration is
// golusoris-side and blocked on golusoris/golusoris#27. detectTransport already
// reports 'sockmap' when the pinned map is present; acceleration is then
// transparent to this client — no code change required here.

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
