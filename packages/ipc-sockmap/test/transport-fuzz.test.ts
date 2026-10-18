/**
 * Property-based fuzzing of the length-prefixed framing: frames round-trip
 * however the stream is chunked, and arbitrary bytes fail only as ProblemError.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import { FrameDecoder, decodeFrame, encodeFrame } from '../src/transport.js';

const payloads = fc.array(fc.uint8Array({ maxLength: 256 }), { maxLength: 8 });

function concat(parts: readonly Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.byteLength;
	}
	return out;
}

/** Splits `stream` at the sorted, de-duplicated `cuts`. */
function split(stream: Uint8Array, cuts: readonly number[]): Uint8Array[] {
	const points = [...new Set(cuts.map((c) => c % (stream.byteLength + 1)))].sort((a, b) => a - b);
	const chunks: Uint8Array[] = [];
	let start = 0;
	for (const point of [...points, stream.byteLength]) {
		chunks.push(stream.subarray(start, point));
		start = point;
	}
	return chunks;
}

describe('framing — property fuzzing', () => {
	it('decodeFrame inverts encodeFrame for any payload sequence', () => {
		fc.assert(
			fc.property(payloads, (frames) => {
				const decoded = decodeFrame(concat(frames.map(encodeFrame)));
				expect(decoded.map((f) => Array.from(f))).toEqual(frames.map((f) => Array.from(f)));
			}),
		);
	});

	it('FrameDecoder yields the same frames however the stream is chunked', () => {
		fc.assert(
			fc.property(payloads, fc.array(fc.nat(), { maxLength: 16 }), (frames, cuts) => {
				const decoder = new FrameDecoder();
				const out: number[][] = [];
				let pending = 0;
				for (const chunk of split(concat(frames.map(encodeFrame)), cuts)) {
					const result = decoder.push(chunk);
					for (const frame of result.frames) out.push(Array.from(frame));
					pending = result.pending;
				}
				expect(out).toEqual(frames.map((f) => Array.from(f)));
				expect(pending).toBe(0);
			}),
		);
	});

	it('arbitrary bytes either decode or fail as ProblemError', () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 512 }), (buffer) => {
				try {
					decodeFrame(buffer);
				} catch (error) {
					expect(error).toBeInstanceOf(ProblemError);
				}
			}),
			{ numRuns: 500 },
		);
	});
});
