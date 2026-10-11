// Minimal mount page that drives the REAL `@sveltesentio/media` headless player
// logic in a real browser (Playwright/chromium). No Svelte component
// compilation is needed: `actionForKey` + `playbackReducer` + `clampVolume` +
// `formatMediaTime` are framework-agnostic, so we wire them to a real, focusable
// `<video>` + a `keydown` listener directly. This sidesteps the
// Playwright-CT-for-Svelte-5 gap while exercising the shipped keyboard-shortcut
// contract (ADR-0042, Vidstack parity) end-to-end. Authoritative state is
// mirrored onto `#player-root` `data-*` attributes for deterministic assertions.

import {
	actionForKey,
	clampVolume,
	formatMediaTime,
	type PlayerAction,
} from '../../src/player-controls.ts';
import { initialPlaybackState, playbackReducer, type PlaybackState } from '../../src/player.ts';

const SEEK_STEP = 10; // seconds per ← / → press
const VOLUME_STEP = 0.1; // per ↑ / ↓ press
const CLIP_DURATION = 120; // harness clip length, seconds

interface PlayerView {
	playback: PlaybackState;
	currentTime: number;
	volume: number;
	muted: boolean;
	captions: boolean;
	fullscreen: boolean;
}

// Seed a ready-to-play state via the SHIPPED reducer (idle → loading → paused),
// so the first Space toggles play — the reducer rejects `play` while `idle`.
const view: PlayerView = {
	playback: playbackReducer(playbackReducer(initialPlaybackState, { type: 'load' }), {
		type: 'ready',
	}),
	currentTime: 0,
	volume: 0.5,
	muted: false,
	captions: false,
	fullscreen: false,
};

interface PlayerElements {
	figure: HTMLElement;
	video: HTMLVideoElement;
	timecode: HTMLElement;
}

function createPlayerDom(root: HTMLElement): PlayerElements {
	const figure = document.createElement('figure');
	figure.id = 'player-root';
	figure.style.margin = '0';

	// Focusable (tabindex) but WITHOUT native `controls`, so chromium's built-in
	// media key handling never competes with the shipped `actionForKey` mapping.
	const video = document.createElement('video');
	video.id = 'player';
	video.tabIndex = 0;
	video.setAttribute('aria-label', 'Sample player');
	video.style.cssText = 'width:480px;height:270px;background:#000;display:block';

	const figcaption = document.createElement('figcaption');
	const timecode = document.createElement('span');
	timecode.id = 'timecode';
	figcaption.appendChild(timecode);

	figure.append(video, figcaption);
	root.appendChild(figure);

	return { figure, video, timecode };
}

function reflectPlayerState(elements: PlayerElements, currentView: PlayerView): void {
	// Best-effort onto the real media element (harmless without a decoded
	// source); the data-* mirror is what tests assert against.
	elements.video.volume = currentView.volume;
	elements.video.muted = currentView.muted;
	elements.figure.dataset.status = currentView.playback.status;
	elements.figure.dataset.time = String(currentView.currentTime);
	elements.figure.dataset.volume = currentView.volume.toFixed(2);
	elements.figure.dataset.muted = String(currentView.muted);
	elements.figure.dataset.captions = String(currentView.captions);
	elements.figure.dataset.fullscreen = String(currentView.fullscreen);
	elements.timecode.textContent = formatMediaTime(currentView.currentTime);
}

function dispatchPlayerAction(action: PlayerAction, currentView: PlayerView): void {
	switch (action) {
		case 'toggle-play':
			currentView.playback = playbackReducer(
				currentView.playback,
				currentView.playback.status === 'playing' ? { type: 'pause' } : { type: 'play' },
			);
			break;
		case 'seek-back':
			currentView.currentTime = Math.max(0, currentView.currentTime - SEEK_STEP);
			break;
		case 'seek-forward':
			currentView.currentTime = Math.min(CLIP_DURATION, currentView.currentTime + SEEK_STEP);
			break;
		case 'volume-up':
			currentView.volume = clampVolume(currentView.volume, VOLUME_STEP);
			break;
		case 'volume-down':
			currentView.volume = clampVolume(currentView.volume, -VOLUME_STEP);
			break;
		case 'toggle-mute':
			currentView.muted = !currentView.muted;
			break;
		case 'toggle-captions':
			currentView.captions = !currentView.captions;
			break;
		case 'toggle-fullscreen':
			currentView.fullscreen = !currentView.fullscreen;
			break;
	}
}

function mount(root: HTMLElement): void {
	const elements = createPlayerDom(root);

	elements.video.addEventListener('keydown', (event) => {
		const action = actionForKey(event);
		if (action === undefined) return;
		event.preventDefault();
		dispatchPlayerAction(action, view);
		reflectPlayerState(elements, view);
	});

	reflectPlayerState(elements, view);
	elements.video.focus();
}

const app = document.getElementById('app');
if (app !== null) mount(app);
