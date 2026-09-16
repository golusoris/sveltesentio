/**
 * Headless player-control helpers for the `<Player>` shell: keyboard-event →
 * action mapping (Vidstack-compatible defaults), a captions-invariant guard,
 * and time formatting for the progress label. Pure and DOM-free so the mapping
 * table is unit-tested without rendering a component.
 *
 * @see ADR-0042 (Vidstack `@next` + `hls.js`) — keyboard parity with Vidstack.
 */

// Subpath import (not the `@sveltesentio/core` barrel): the barrel re-exports
// `clock.ts`, which pulls `node:async_hooks` and would drag server-only code
// into any client bundle that imports these headless `<Player>` controls.
import { ProblemError } from '@sveltesentio/core/problem';

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
/**
 * Keyboard shortcuts, lower-cased key to action.
 *
 * A table rather than a switch so the shortcut set reads as data: the whole keymap
 * is visible at once, and adding a binding is one entry instead of a new branch.
 * `' '` and `'spacebar'` are both present because older engines report the space
 * key under the legacy name.
 */
const KEY_ACTIONS: Readonly<Record<string, PlayerAction>> = {
	' ': 'toggle-play',
	spacebar: 'toggle-play',
	k: 'toggle-play',
	arrowleft: 'seek-back',
	arrowright: 'seek-forward',
	arrowup: 'volume-up',
	arrowdown: 'volume-down',
	m: 'toggle-mute',
	f: 'toggle-fullscreen',
	c: 'toggle-captions',
};

/** Seek increment for the arrow-key shortcuts, in seconds. */
const SEEK_STEP_SECONDS = 5;
/** Volume increment for the arrow-key shortcuts, as a 0..1 fraction. */
const VOLUME_STEP = 0.1;

export function actionForKey(event: {
	readonly key: string;
	readonly ctrlKey?: boolean;
	readonly metaKey?: boolean;
	readonly altKey?: boolean;
}): PlayerAction | undefined {
	if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
	return KEY_ACTIONS[event.key.toLowerCase()];
}

/**
 * Applies the actions that only move the media element: play/pause, seek, volume.
 *
 * Returns `false` for actions the component must handle itself because they touch
 * state outside the element — mute mirrors into reactive component state,
 * fullscreen needs the browser guard, captions belong to the track menu. Keeping
 * the element-only half here makes it testable without mounting the component.
 */
export function applyTransportAction(el: HTMLMediaElement, action: PlayerAction): boolean {
	switch (action) {
		case 'toggle-play':
			if (el.paused) void el.play();
			else el.pause();
			return true;
		case 'seek-back':
			el.currentTime = Math.max(0, el.currentTime - SEEK_STEP_SECONDS);
			return true;
		case 'seek-forward':
			el.currentTime = Math.min(el.duration || Infinity, el.currentTime + SEEK_STEP_SECONDS);
			return true;
		case 'volume-up':
			el.volume = clampVolume(el.volume, VOLUME_STEP);
			return true;
		case 'volume-down':
			el.volume = clampVolume(el.volume, -VOLUME_STEP);
			return true;
		default:
			return false;
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
