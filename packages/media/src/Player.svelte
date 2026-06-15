<!--
@component
Player — a video/audio player shell with keyboard + a11y controls, wired to the
headless `./player` core (`playbackReducer`, optional BYO `hls.js`). This is a
deliberately thin, dependency-light shell over a native `<video>` / `<audio>`
element so it renders and tests without the heavy `vidstack` peer present.
Consumers wanting Vidstack's full chrome pass `vidstack` and mount its
components inside the `controls` snippet; the keyboard + captions contract here
still applies.

Invariants (ADR-0042 / AGENTS.md):
- Captions required for video — `assertCaptionsContract` throws unless `tracks`
  is supplied (`tracks={[]}` is the explicit opt-out).
- Autoplay off by default; enabling it forces `muted` (browser policy).
- Keyboard parity with Vidstack: Space/K, ← →, ↑ ↓, M, F, C.

The tested logic lives in `./player` + `./player-controls`; this file is a
thin, a11y-correct view.
-->
<script lang="ts">
	import { BROWSER } from 'esm-env';
	import {
		actionForKey,
		assertCaptionsContract,
		formatMediaTime,
		clampVolume,
		type MediaTrack,
	} from './player-controls.js';

	interface Props {
		/** Media source URL (`.m3u8`, `.mp4`, audio, …). */
		src: string;
		/** Accessible name for the player region — required. */
		title: string;
		/** `video` (default) or `audio`. Video without `tracks` throws. */
		viewType?: 'video' | 'audio';
		/** Caption / subtitle tracks. Required for video (`[]` to opt out). */
		tracks?: readonly MediaTrack[];
		/** Poster image (video only). */
		poster?: string;
		/** Opt in to autoplay; sets `muted` automatically. */
		autoplay?: boolean;
	}

	const { src, title, viewType = 'video', tracks, poster, autoplay = false }: Props = $props();

	// One-shot mount-time invariant (WCAG 1.2.2): refuse to mount a caption-less
	// video. Props are read once by design — the contract is fixed at construction.
	// svelte-ignore state_referenced_locally
	assertCaptionsContract(viewType, tracks);

	let media = $state<HTMLMediaElement | null>(null);
	let paused = $state(true);
	let currentTime = $state(0);
	let duration = $state(0);
	// Autoplay must start muted (browser policy); the user can unmute via M after.
	// svelte-ignore state_referenced_locally
	let muted = $state(autoplay);

	const timeLabel = $derived(
		`${formatMediaTime(currentTime)} / ${formatMediaTime(duration)}`,
	);

	function dispatch(key: KeyboardEvent): void {
		const el = media;
		if (!el) return;
		const action = actionForKey(key);
		if (action === undefined) return;
		key.preventDefault();
		switch (action) {
			case 'toggle-play':
				if (el.paused) void el.play();
				else el.pause();
				break;
			case 'seek-back':
				el.currentTime = Math.max(0, el.currentTime - 5);
				break;
			case 'seek-forward':
				el.currentTime = Math.min(el.duration || Infinity, el.currentTime + 5);
				break;
			case 'volume-up':
				el.volume = clampVolume(el.volume, 0.1);
				break;
			case 'volume-down':
				el.volume = clampVolume(el.volume, -0.1);
				break;
			case 'toggle-mute':
				el.muted = !el.muted;
				muted = el.muted;
				break;
			case 'toggle-fullscreen':
				if (BROWSER && el.requestFullscreen) void el.requestFullscreen().catch(() => {});
				break;
			case 'toggle-captions':
				break;
		}
	}
</script>

<div
	class="ssentio-player"
	data-view-type={viewType}
	role="group"
	aria-label={title}
	aria-roledescription="media player"
>
	{#if viewType === 'audio'}
		<audio
			bind:this={media}
			bind:paused
			bind:currentTime
			bind:duration
			{src}
			{autoplay}
			{muted}
			controls
			preload="metadata"
			onkeydown={dispatch}
		></audio>
	{:else}
		<video
			bind:this={media}
			bind:paused
			bind:currentTime
			bind:duration
			{src}
			{poster}
			{autoplay}
			{muted}
			controls
			playsinline
			preload="metadata"
			onkeydown={dispatch}
		>
			{#each tracks ?? [] as track (track.src)}
				<track
					src={track.src}
					kind={track.kind}
					srclang={track.srclang}
					label={track.label}
					default={track.default}
				/>
			{/each}
		</video>
	{/if}
	<p class="ssentio-player__time" aria-live="off">
		<span class="ssentio-player__sr-only">Playback position:</span>
		{timeLabel}
		<span class="ssentio-player__sr-only">{paused ? '(paused)' : '(playing)'}</span>
	</p>
</div>

<style>
	.ssentio-player {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.ssentio-player :global(video),
	.ssentio-player :global(audio) {
		width: 100%;
	}

	.ssentio-player__time {
		margin: 0;
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
	}

	.ssentio-player__sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
