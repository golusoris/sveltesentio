/**
 * Headless player-control helpers for the `<Player>` shell: keyboard-event →
 * action mapping (Vidstack-compatible defaults), a captions-invariant guard,
 * and time formatting for the progress label. Pure and DOM-free so the mapping
 * table is unit-tested without rendering a component.
 *
 * @see ADR-0042 (Vidstack `@next` + `hls.js`) — keyboard parity with Vidstack.
 */

import { ProblemError } from '@sveltesentio/core';

/** A discrete player control intent produced by a key press. */
export type PlayerAction =
	| 'toggle-play'
	| 'seek-back'
	| 'seek-forward'
	| 'volume-up'
	| 'volume-down'
	| 'toggle-mute'
	| 'toggle-fullscreen'
	| 'toggle-captions';

/**
 * Map a keyboard event to a player action, mirroring Vidstack's default
 * shortcuts: Space / K toggle play, ← → seek, ↑ ↓ volume, M mute, F fullscreen,
 * C captions. Returns `undefined` for unmapped keys or when a modifier is held
 * (so browser/OS chords are never hijacked). Matching is case-insensitive.
 */
export function actionForKey(event: {
	readonly key: string;
	readonly ctrlKey?: boolean;
	readonly metaKey?: boolean;
	readonly altKey?: boolean;
}): PlayerAction | undefined {
	if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
	switch (event.key.toLowerCase()) {
		case ' ':
		case 'spacebar':
		case 'k':
			return 'toggle-play';
		case 'arrowleft':
			return 'seek-back';
		case 'arrowright':
			return 'seek-forward';
		case 'arrowup':
			return 'volume-up';
		case 'arrowdown':
			return 'volume-down';
		case 'm':
			return 'toggle-mute';
		case 'f':
			return 'toggle-fullscreen';
		case 'c':
			return 'toggle-captions';
		default:
			return undefined;
	}
}

/** One caption / subtitle track for a consumer-supplied video. */
export interface MediaTrack {
	readonly src: string;
	/** Track kind; `captions` / `subtitles` satisfy WCAG 1.2.2. */
	readonly kind: 'captions' | 'subtitles' | 'descriptions' | 'chapters' | 'metadata';
	/** BCP 47 language tag, e.g. `"en"`. */
	readonly srclang?: string;
	/** Human label shown in the track menu, e.g. `"English"`. */
	readonly label?: string;
	/** Whether the browser shows this track by default. */
	readonly default?: boolean;
}

/**
 * Enforce the captions invariant for video (WCAG 2.2 SC 1.2.2): a video
 * `<Player>` must receive a `tracks` prop, even if empty. Passing `tracks`
 * (including `[]`) is the explicit opt-out a consumer makes when the source has
 * no spoken audio. Audio-only players are exempt. Throws an RFC 9457
 * `ProblemError` rather than rendering a caption-less video.
 */
export function assertCaptionsContract(
	viewType: 'video' | 'audio',
	tracks: readonly MediaTrack[] | undefined,
): void {
	if (viewType === 'audio') return;
	if (tracks === undefined) {
		throw new ProblemError({
			status: 500,
			title: 'Captions contract violated',
			detail:
				'A video <Player> requires a `tracks` prop (use `tracks={[]}` to opt out explicitly when the source has no spoken audio). WCAG 2.2 SC 1.2.2.',
			type: 'https://sveltesentio.dev/problems/media/captions-required',
		});
	}
}

/** Pad a non-negative integer to two digits. */
function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

/**
 * Format a media time (seconds) as `M:SS` or `H:MM:SS`. Non-finite or negative
 * input clamps to `0:00`. Used for the visible time-code and the progress
 * slider's `aria-valuetext`.
 */
export function formatMediaTime(seconds: number): string {
	const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
	const hrs = Math.floor(total / 3600);
	const mins = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	if (hrs > 0) return `${hrs}:${pad2(mins)}:${pad2(secs)}`;
	return `${mins}:${pad2(secs)}`;
}

/**
 * Clamp a volume to the valid `[0, 1]` range, mapping non-finite input to `0`.
 * Volume key steps add/subtract `step` (default `0.1`) before clamping.
 */
export function clampVolume(value: number, step = 0): number {
	const v = Number.isFinite(value) ? value + step : 0;
	if (v < 0) return 0;
	if (v > 1) return 1;
	return v;
}
