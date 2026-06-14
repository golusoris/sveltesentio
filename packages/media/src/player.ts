/**
 * Headless player-source model: rendition selection, OS media-session
 * metadata, a typed play/pause/quality state machine, and a bring-your-own
 * `hls.js` attachment seam. Pure and framework-agnostic — the heavy
 * `<Player>` UI shell (vidstack) is a follow-through and intentionally absent
 * here so this package stays free of runtime media dependencies.
 *
 * @see ADR-0042 (Vidstack `@next` + `hls.js`) — issues #67 / #68.
 */

/**
 * One HLS variant. Models separate-rendition (un-muxed) streaming as used by
 * media servers: a rendition may carry video, audio, or both, so quality and
 * audio-track switching are independent concerns.
 */
export interface HlsRendition {
	/** Stable identifier (e.g. the HLS level index or a server stream id). */
	readonly id: string;
	/** Vertical resolution in pixels; omit for audio-only renditions. */
	readonly height?: number;
	/** Average/peak bitrate in bits per second, if known. */
	readonly bitrate?: number;
	/** RFC 6381 codec string, e.g. `"hvc1.1.6.L93.B0"` or `"avc1.640028"`. */
	readonly codec?: string;
	/** BCP 47 language tag for audio renditions, e.g. `"en"`. */
	readonly language?: string;
	/** Whether this is the server-default rendition. */
	readonly default?: boolean;
}

export interface PickRenditionOptions {
	/** Cap selection to renditions at or below this height. */
	readonly maxHeight?: number;
	/**
	 * Prefer renditions whose `codec` starts with this prefix (case-insensitive),
	 * e.g. `"hvc1"` / `"hev1"` for HEVC, `"avc1"` for H.264. Non-matching
	 * renditions remain eligible as a fallback.
	 */
	readonly preferCodec?: string;
}

function isAtOrBelowHeight(r: HlsRendition, maxHeight: number | undefined): boolean {
	if (maxHeight === undefined) return true;
	if (r.height === undefined) return true; // audio-only is never excluded by height
	return r.height <= maxHeight;
}

function rank(r: HlsRendition): number {
	if (r.height !== undefined) return r.height * 1_000_000 + (r.bitrate ?? 0);
	return r.bitrate ?? 0;
}

/**
 * Select the best HLS rendition under the given constraints. Picks the highest
 * eligible height (then bitrate). When `preferCodec` is set, codec-matching
 * renditions win over non-matching ones of equal-or-greater rank, so a HEVC
 * preference is honoured without discarding an H.264 fallback. Returns
 * `undefined` only when `renditions` is empty.
 */
export function pickRendition(
	renditions: readonly HlsRendition[],
	options: PickRenditionOptions = {},
): HlsRendition | undefined {
	const { maxHeight, preferCodec } = options;
	const eligible = renditions.filter((r) => isAtOrBelowHeight(r, maxHeight));
	const pool = eligible.length > 0 ? eligible : renditions;
	if (pool.length === 0) return undefined;

	const prefix = preferCodec?.toLowerCase();
	const matches = (r: HlsRendition): boolean =>
		prefix !== undefined && (r.codec?.toLowerCase().startsWith(prefix) ?? false);

	let best: HlsRendition | undefined;
	for (const r of pool) {
		if (best === undefined) {
			best = r;
			continue;
		}
		const rMatch = matches(r);
		const bestMatch = matches(best);
		if (rMatch !== bestMatch) {
			if (rMatch) best = r;
			continue;
		}
		if (rank(r) > rank(best)) best = r;
	}
	return best;
}

/** One album-art / poster image for the OS media session. */
export interface MediaSessionArtwork {
	readonly src: string;
	/** e.g. `"512x512"`. */
	readonly sizes?: string;
	/** e.g. `"image/png"`. */
	readonly type?: string;
}

export interface MediaSessionMetadataInit {
	readonly title: string;
	readonly artist?: string;
	readonly album?: string;
	readonly artwork?: readonly MediaSessionArtwork[];
}

/**
 * Shape compatible with the `MediaMetadataInit` accepted by the browser
 * `navigator.mediaSession.metadata = new MediaMetadata(...)` API. Returned as a
 * plain object so the caller — not this package — owns the DOM boundary.
 */
export interface MediaSessionMetadata {
	readonly title: string;
	readonly artist: string;
	readonly album: string;
	readonly artwork: readonly MediaSessionArtwork[];
}

/**
 * Build a normalised media-session metadata object for the OS lock-screen /
 * media keys. Empty `artist` / `album` default to `""` (the API's own
 * defaults) so the result can be passed straight to `new MediaMetadata(...)`.
 */
export function buildMediaSessionMetadata(
	init: MediaSessionMetadataInit,
): MediaSessionMetadata {
	return {
		title: init.title,
		artist: init.artist ?? '',
		album: init.album ?? '',
		artwork: init.artwork ?? [],
	};
}

/** Playback lifecycle states for the headless machine. */
export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended';

/** Events the state machine accepts. */
export type PlaybackEvent =
	| { readonly type: 'load' }
	| { readonly type: 'ready' }
	| { readonly type: 'play' }
	| { readonly type: 'pause' }
	| { readonly type: 'end' }
	| { readonly type: 'selectQuality'; readonly renditionId: string }
	| { readonly type: 'reset' };

export interface PlaybackState {
	readonly status: PlaybackStatus;
	/** Currently-selected rendition id, or `null` for automatic (ABR). */
	readonly renditionId: string | null;
}

export const initialPlaybackState: PlaybackState = {
	status: 'idle',
	renditionId: null,
};

/**
 * Pure reducer for the play/pause/quality machine. Invalid transitions (e.g.
 * `play` while `idle`) are no-ops that return the input state unchanged, so the
 * machine never throws on a stray event. Quality selection is orthogonal to the
 * play/pause lifecycle and is accepted in any non-terminal state.
 */
export function playbackReducer(
	state: PlaybackState,
	event: PlaybackEvent,
): PlaybackState {
	switch (event.type) {
		case 'load':
			return state.status === 'idle'
				? { ...state, status: 'loading' }
				: state;
		case 'ready':
			return state.status === 'loading'
				? { ...state, status: 'paused' }
				: state;
		case 'play':
			return state.status === 'paused' || state.status === 'ended'
				? { ...state, status: 'playing' }
				: state;
		case 'pause':
			return state.status === 'playing'
				? { ...state, status: 'paused' }
				: state;
		case 'end':
			return state.status === 'playing'
				? { ...state, status: 'ended' }
				: state;
		case 'selectQuality':
			return state.status === 'idle'
				? state
				: { ...state, renditionId: event.renditionId };
		case 'reset':
			return initialPlaybackState;
	}
}

/**
 * Minimal structural view of an `hls.js` instance — only the members the
 * attachment seam touches. Kept local so this package needs no `hls.js`
 * dependency (it is an optional peer).
 */
export interface HlsLike {
	loadSource(url: string): void;
	attachMedia(media: HTMLMediaElement): void;
	destroy(): void;
	/** Manual quality override; `-1` restores automatic ABR. */
	currentLevel?: number;
}

/** A constructor compatible with `new Hls(config)`. */
export type HlsConstructorLike = new (config?: unknown) => HlsLike;

export interface HlsAttachmentOptions {
	/** Optional `hls.js` config passed straight to its constructor. */
	readonly config?: unknown;
}

export interface HlsAttachment {
	/** Wire an HLS source to a media element; returns a detach/destroy handle. */
	attach(media: HTMLMediaElement, source: string): { destroy(): void };
}

/**
 * Bring-your-own-`hls.js` seam. The caller injects the `hls.js` constructor
 * (so this package neither bundles nor dynamically imports it), and gets back a
 * tiny attachment helper that wires a source to a media element. Downstreams
 * already on raw `hls.js` can adopt this without pulling any UI shell.
 *
 * @example
 * import Hls from 'hls.js';
 * const hls = createHlsAttachment(Hls);
 * const handle = hls.attach(videoEl, manifestUrl);
 * // later: handle.destroy();
 */
export function createHlsAttachment(
	HlsCtor: HlsConstructorLike,
	options: HlsAttachmentOptions = {},
): HlsAttachment {
	return {
		attach(media, source) {
			const instance =
				options.config === undefined
					? new HlsCtor()
					: new HlsCtor(options.config);
			instance.attachMedia(media);
			instance.loadSource(source);
			return {
				destroy: () => {
					instance.destroy();
				},
			};
		},
	};
}
