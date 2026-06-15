import { describe, expect, it } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import {
	FRAME_HEADER_BYTES,
	FrameDecoder,
	MAX_FRAME_BYTES,
	decodeFrame,
	encodeFrame,
} from '../src/transport.js';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

const concat = (...parts: Uint8Array[]): Uint8Array => {
	const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.byteLength;
	}
	return out;
};

describe('encodeFrame', () => {
	it('prefixes a big-endian u32 length header', () => {
		const frame = encodeFrame(bytes(0xaa, 0xbb, 0xcc));
		expect(frame.byteLength).toBe(FRAME_HEADER_BYTES + 3);
		expect(Array.from(frame.subarray(0, 4))).toEqual([0, 0, 0, 3]);
		expect(Array.from(frame.subarray(4))).toEqual([0xaa, 0xbb, 0xcc]);
	});

	it('encodes an empty payload as a bare zero header', () => {
		const frame = encodeFrame(new Uint8Array(0));
		expect(Array.from(frame)).toEqual([0, 0, 0, 0]);
	});

	it('throws a ProblemError when the payload exceeds the max', () => {
		const oversized = { byteLength: MAX_FRAME_BYTES + 1 } as unknown as Uint8Array;
		expect(() => encodeFrame(oversized)).toThrowError(ProblemError);
	});
});

describe('decodeFrame (whole buffer)', () => {
	it('round-trips a single frame', () => {
		const payload = bytes(1, 2, 3, 4);
		const frames = decodeFrame(encodeFrame(payload));
		expect(frames).toHaveLength(1);
		expect(Array.from(frames[0]!)).toEqual([1, 2, 3, 4]);
	});

	it('decodes multiple frames packed in one buffer', () => {
		const buffer = concat(
			encodeFrame(bytes(0x01)),
			encodeFrame(bytes(0x02, 0x03)),
			encodeFrame(new Uint8Array(0)),
		);
		const frames = decodeFrame(buffer);
		expect(frames.map((f) => Array.from(f))).toEqual([[0x01], [0x02, 0x03], []]);
	});

	it('throws when the buffer ends mid-frame', () => {
		const truncated = encodeFrame(bytes(9, 9, 9)).subarray(0, 5);
		expect(() => decodeFrame(truncated)).toThrowError(ProblemError);
	});
});

describe('FrameDecoder (streaming)', () => {
	it('reassembles a frame split across multiple chunks', () => {
		const frame = encodeFrame(bytes(0x10, 0x20, 0x30, 0x40));
		const decoder = new FrameDecoder();

		const first = decoder.push(frame.subarray(0, 2));
		expect(first.frames).toHaveLength(0);
		expect(first.pending).toBe(2);
		expect(decoder.pendingBytes).toBe(2);

		const second = decoder.push(frame.subarray(2, 5));
		expect(second.frames).toHaveLength(0);
		expect(second.pending).toBe(5);

		const third = decoder.push(frame.subarray(5));
		expect(third.frames).toHaveLength(1);
		expect(Array.from(third.frames[0]!)).toEqual([0x10, 0x20, 0x30, 0x40]);
		expect(third.pending).toBe(0);
	});

	it('drains several whole frames from one chunk and keeps a partial remainder', () => {
		const decoder = new FrameDecoder();
		const whole = concat(encodeFrame(bytes(0xa1)), encodeFrame(bytes(0xb2, 0xb3)));
		const partialNext = encodeFrame(bytes(0xc4, 0xc5, 0xc6)).subarray(0, 6); // header + 2 of 3
		const result = decoder.push(concat(whole, partialNext));

		expect(result.frames.map((f) => Array.from(f))).toEqual([[0xa1], [0xb2, 0xb3]]);
		expect(result.pending).toBe(6); // 4-byte header + 2 buffered payload bytes
	});

	it('handles a header split across the chunk boundary', () => {
		const frame = encodeFrame(bytes(0x7f));
		const decoder = new FrameDecoder();
		expect(decoder.push(frame.subarray(0, 3)).frames).toHaveLength(0);
		const done = decoder.push(frame.subarray(3));
		expect(done.frames).toHaveLength(1);
		expect(Array.from(done.frames[0]!)).toEqual([0x7f]);
	});

	it('throws a ProblemError on a declared length over the max', () => {
		const decoder = new FrameDecoder();
		const header = new Uint8Array(FRAME_HEADER_BYTES);
		new DataView(header.buffer).setUint32(0, MAX_FRAME_BYTES + 1, false);
		expect(() => decoder.push(header)).toThrowError(ProblemError);
	});

	it('reset() discards buffered bytes', () => {
		const decoder = new FrameDecoder();
		decoder.push(encodeFrame(bytes(1, 2, 3)).subarray(0, 4));
		expect(decoder.pendingBytes).toBe(4);
		decoder.reset();
		expect(decoder.pendingBytes).toBe(0);
	});
});
