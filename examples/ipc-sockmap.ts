// Length-prefixed binary IPC framing (userspace tier).
import {
  FrameDecoder,
  decodeFrame,
  FRAME_HEADER_BYTES,
  MAX_FRAME_BYTES,
} from '@sveltesentio/ipc-sockmap';

const decoder = new FrameDecoder();
for (const frame of decoder.push(chunk)) handle(frame); // yields complete frames only
