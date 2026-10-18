// Length-prefixed binary IPC framing (userspace tier).
import {
	FrameDecoder,
	decodeFrame,
	FRAME_HEADER_BYTES,
	MAX_FRAME_BYTES,
} from '@sveltesentio/ipc-sockmap';

const decoder = new FrameDecoder();
for (const frame of decoder.push(chunk)) handle(frame); // yields complete frames only
// One-shot decode of a whole buffer; each frame is a FRAME_HEADER_BYTES length prefix
// plus at most MAX_FRAME_BYTES of payload.
export const frames = decodeFrame(buffer);
export const limits = { header: FRAME_HEADER_BYTES, payload: MAX_FRAME_BYTES };
