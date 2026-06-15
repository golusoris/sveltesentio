import { ProblemError } from '@sveltesentio/core';

/**
 * Length-prefixed message framing over a byte stream.
 *
 * Wire format: a 4-byte big-endian unsigned length header followed by exactly
 * that many payload bytes. Pure + dependency-free so it unit-tests without any
 * socket; the same codec serialises Tier-1 (AF_UNIX) and, once golusoris#27
 * pins the sockhash, Tier-3 (eBPF SK_MSG) traffic unchanged.
 */

/** Bytes reserved for the big-endian u32 length prefix. */
export const FRAME_HEADER_BYTES = 4;

/** Upper bound on a single frame's payload, guarding against hostile/garbled lengths. */
export const MAX_FRAME_BYTES = 64 * 1024 * 1024;

const FRAMING_TYPE = 'https://sveltesentio.dev/problems/ipc-framing';

function framingError(detail: string, extensions?: Record<string, unknown>): ProblemError {
	return new ProblemError({
		type: FRAMING_TYPE,
		title: 'IPC frame decode failed',
		status: 422,
		detail,
		...(extensions === undefined ? {} : { extensions }),
	});
}

/**
 * Encode a single payload into a length-prefixed frame.
 *
 * @throws {ProblemError} when the payload exceeds {@link MAX_FRAME_BYTES}.
 */
export function encodeFrame(payload: Uint8Array): Uint8Array {
	if (payload.byteLength > MAX_FRAME_BYTES) {
		throw framingError(
			`Frame payload ${payload.byteLength} exceeds max ${MAX_FRAME_BYTES}`,
			{ length: payload.byteLength, max: MAX_FRAME_BYTES },
		);
	}
	const frame = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength);
	const view = new DataView(frame.buffer, frame.byteOffset, FRAME_HEADER_BYTES);
	view.setUint32(0, payload.byteLength, false);
	frame.set(payload, FRAME_HEADER_BYTES);
	return frame;
}

/** Result of feeding a chunk to {@link FrameDecoder.push}. */
export interface DecodeResult {
	/** Fully-decoded frame payloads, in order. */
	readonly frames: readonly Uint8Array[];
	/** Bytes retained internally awaiting more input (header + partial payload). */
	readonly pending: number;
}

/**
 * Streaming decoder for length-prefixed frames.
 *
 * Handles the two realities of a byte stream: a single chunk may carry several
 * whole frames, and a single frame may be split across many chunks. Buffers the
 * remainder between {@link push} calls until a complete frame is available.
 */
export class FrameDecoder {
	private buffer = new Uint8Array(0);

	/** Bytes currently buffered awaiting completion of the next frame. */
	get pendingBytes(): number {
		return this.buffer.byteLength;
	}

	/**
	 * Feed a chunk and drain every complete frame it completes.
	 *
	 * @throws {ProblemError} when a declared length exceeds {@link MAX_FRAME_BYTES}.
	 */
	push(chunk: Uint8Array): DecodeResult {
		if (chunk.byteLength > 0) {
			const merged = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
			merged.set(this.buffer, 0);
			merged.set(chunk, this.buffer.byteLength);
			this.buffer = merged;
		}

		const frames: Uint8Array[] = [];
		let offset = 0;
		while (this.buffer.byteLength - offset >= FRAME_HEADER_BYTES) {
			const view = new DataView(
				this.buffer.buffer,
				this.buffer.byteOffset + offset,
				FRAME_HEADER_BYTES,
			);
			const length = view.getUint32(0, false);
			if (length > MAX_FRAME_BYTES) {
				throw framingError(`Declared frame length ${length} exceeds max ${MAX_FRAME_BYTES}`, {
					length,
					max: MAX_FRAME_BYTES,
				});
			}
			const frameEnd = offset + FRAME_HEADER_BYTES + length;
			if (this.buffer.byteLength < frameEnd) break;
			frames.push(this.buffer.slice(offset + FRAME_HEADER_BYTES, frameEnd));
			offset = frameEnd;
		}

		this.buffer =
			offset === 0 ? this.buffer : this.buffer.slice(offset);
		return { frames, pending: this.buffer.byteLength };
	}

	/** Discard buffered bytes (e.g. on socket teardown). */
	reset(): void {
		this.buffer = new Uint8Array(0);
	}
}

/**
 * Decode every complete frame contained in a single contiguous buffer.
 *
 * Convenience for callers that already hold the whole stream in memory; for
 * incremental reads use {@link FrameDecoder}.
 *
 * @throws {ProblemError} when the buffer ends mid-frame or a length is invalid.
 */
export function decodeFrame(buffer: Uint8Array): readonly Uint8Array[] {
	const decoder = new FrameDecoder();
	const { frames, pending } = decoder.push(buffer);
	if (pending !== 0) {
		throw framingError(`Buffer ends mid-frame with ${pending} trailing byte(s)`, {
			pending,
		});
	}
	return frames;
}

/**
 * Tiers of the colocated-IPC ladder (ADR-0051).
 *
 * - `sockmap` — Tier 3: a pinned `BPF_MAP_TYPE_SOCKHASH` is present, so the
 *   kernel SK_MSG hook bypasses the TCP stack (activated golusoris-side per
 *   golusoris#27). Detection-only here; no userspace registration yet.
 * - `af_unix` — Tier 1: an AF_UNIX socket is present.
 * - `none` — neither is reachable; caller falls back to loopback TCP.
 */
export type IpcTier = 'sockmap' | 'af_unix' | 'none';

/**
 * `fs.access`-like probe. Resolves when the path is reachable, rejects
 * otherwise. Injected so detection unit-tests without touching the filesystem;
 * the default in {@link createIpcClient} is `node:fs/promises` `access`.
 */
export type AccessFn = (path: string) => Promise<void>;

/** Inputs to {@link detectTransport}. */
export interface DetectTransportOptions {
	/** AF_UNIX socket path (Tier 1). */
	readonly socketPath: string;
	/** Pinned BPF sockhash path (Tier 3); omit if the deployment never pins one. */
	readonly bpfMapPath?: string | undefined;
	/** Probe for path reachability. Defaults to `node:fs/promises` `access`. */
	readonly access?: AccessFn | undefined;
}

let defaultAccess: AccessFn | undefined;

async function resolveAccess(access: AccessFn | undefined): Promise<AccessFn> {
	if (access) return access;
	if (!defaultAccess) {
		const { access: fsAccess } = await import('node:fs/promises');
		defaultAccess = (path: string): Promise<void> => fsAccess(path);
	}
	return defaultAccess;
}

async function reachable(access: AccessFn, path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Probe which ladder tier is available, highest first.
 *
 * Returns `sockmap` when the pinned BPF sockhash exists (Tier 3), else
 * `af_unix` when the socket exists (Tier 1), else `none`. The probe never
 * throws — an unreachable path simply rules its tier out.
 */
export async function detectTransport(options: DetectTransportOptions): Promise<IpcTier> {
	const access = await resolveAccess(options.access);
	if (options.bpfMapPath !== undefined && (await reachable(access, options.bpfMapPath))) {
		return 'sockmap';
	}
	if (await reachable(access, options.socketPath)) {
		return 'af_unix';
	}
	return 'none';
}
