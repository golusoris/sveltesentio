<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Player from './Player.svelte';
	import type { MediaTrack } from './player-controls.js';

	// `vidstack` + `hls.js` are OPTIONAL peers and are NOT installed in this
	// Storybook workspace. The shell deliberately degrades to a native
	// `<video>` / `<audio>` element, so every story below renders the
	// dependency-light fallback path with sample `src` / `poster` args.
	const SAMPLE_VIDEO = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
	const SAMPLE_VIDEO_MP4 =
		'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
	const SAMPLE_AUDIO = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
	const SAMPLE_POSTER =
		'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg';

	// A video <Player> requires a `tracks` prop (WCAG 1.2.2); `[]` is the
	// explicit "no spoken audio" opt-out.
	const captionTracks: readonly MediaTrack[] = [
		{ src: '', kind: 'captions', srclang: 'en', label: 'English', default: true },
	];

	const { Story } = defineMeta({
		title: 'media/Player',
		component: Player,
		tags: ['autodocs'],
		argTypes: {
			viewType: { control: 'inline-radio', options: ['video', 'audio'] },
			autoplay: { control: 'boolean' },
			src: { control: 'text' },
			title: { control: 'text' },
			poster: { control: 'text' },
		},
		args: {
			src: SAMPLE_VIDEO,
			title: 'Sample video',
			viewType: 'video',
			tracks: captionTracks,
			poster: SAMPLE_POSTER,
		},
	});
</script>

<!-- Video shell over a native `<video>`: poster + captions track, no vidstack peer. -->
<Story
	name="Video"
	args={{
		src: SAMPLE_VIDEO,
		title: 'Big Buck Bunny',
		viewType: 'video',
		tracks: captionTracks,
		poster: SAMPLE_POSTER,
	}}
/>

<!-- An MP4 source the browser can play directly without an HLS engine. -->
<Story
	name="Video (MP4)"
	args={{
		src: SAMPLE_VIDEO_MP4,
		title: 'Big Buck Bunny (MP4)',
		viewType: 'video',
		tracks: captionTracks,
		poster: SAMPLE_POSTER,
	}}
/>

<!-- Audio-only shell (`<audio>`); captions are not required for audio. -->
<Story
	name="Audio"
	args={{ src: SAMPLE_AUDIO, title: 'Sample audio track', viewType: 'audio' }}
/>

<!-- Captions opt-out: a video with no spoken audio passes `tracks={[]}`. -->
<Story
	name="No captions (opt-out)"
	args={{
		src: SAMPLE_VIDEO_MP4,
		title: 'Silent clip',
		viewType: 'video',
		tracks: [],
		poster: SAMPLE_POSTER,
	}}
/>
