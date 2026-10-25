import { render, fireEvent } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import Player from '../src/Player.svelte';
import { expectNoAxeViolations } from './axe-helper.js';
import type { MediaTrack } from '../src/player-controls.js';

const captions: MediaTrack[] = [
	{ src: '/en.vtt', kind: 'captions', srclang: 'en', label: 'English', default: true },
];

const playStub = vi.fn().mockResolvedValue(undefined);
const pauseStub = vi.fn();

beforeAll(() => {
	// jsdom HTMLMediaElement has no real playback; stub the methods the keyboard
	// handler calls so dispatch can run without throwing.
	Object.defineProperty(HTMLMediaElement.prototype, 'play', {
		configurable: true,
		value: playStub,
	});
	Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
		configurable: true,
		value: pauseStub,
	});
});

describe('Player', () => {
	it('renders a <video> with the supplied src and caption track', () => {
		const { container } = render(Player, {
			src: '/clip.mp4',
			title: 'Demo reel',
			tracks: captions,
		});

		const video = container.querySelector('video');
		expect(video).toBeInTheDocument();
		expect(video).toHaveAttribute('src', '/clip.mp4');

		const track = container.querySelector('track');
		expect(track).toHaveAttribute('kind', 'captions');
		expect(track).toHaveAttribute('srclang', 'en');
	});

	it('names the player region via aria-label and a media-player roledescription', () => {
		const { getByRole } = render(Player, {
			src: '/clip.mp4',
			title: 'Demo reel',
			tracks: [],
		});

		const group = getByRole('group', { name: 'Demo reel' });
		expect(group).toHaveAttribute('aria-roledescription', 'media player');
	});

	it('renders an <audio> element (no caption requirement) for viewType="audio"', () => {
		const { container } = render(Player, {
			src: '/song.mp3',
			title: 'Track',
			viewType: 'audio',
		});

		expect(container.querySelector('audio')).toBeInTheDocument();
		expect(container.querySelector('video')).toBeNull();
	});

	it('throws a ProblemError when a video omits the tracks prop (captions contract)', () => {
		expect(() => render(Player, { src: '/clip.mp4', title: 'No captions' })).toThrow(ProblemError);
	});

	it('accepts an explicit empty tracks opt-out for video', () => {
		const { container } = render(Player, {
			src: '/clip.mp4',
			title: 'Silent clip',
			tracks: [],
		});
		expect(container.querySelector('video')).toBeInTheDocument();
		expect(container.querySelector('track')).toBeNull();
	});

	it('toggles play/pause on Space and k via the keyboard handler', async () => {
		playStub.mockClear();
		const { container } = render(Player, {
			src: '/clip.mp4',
			title: 'Demo reel',
			tracks: captions,
		});
		const video = container.querySelector('video') as HTMLVideoElement;

		// jsdom reports paused === true by default → Space should call play().
		await fireEvent.keyDown(video, { key: ' ' });
		expect(playStub).toHaveBeenCalledTimes(1);
		await fireEvent.keyDown(video, { key: 'k' });
		expect(playStub).toHaveBeenCalledTimes(2);
	});

	it('seeks backward/forward on arrow keys', async () => {
		const { container } = render(Player, {
			src: '/clip.mp4',
			title: 'Demo reel',
			tracks: captions,
		});
		const video = container.querySelector('video') as HTMLVideoElement;
		video.currentTime = 30;

		await fireEvent.keyDown(video, { key: 'ArrowLeft' });
		expect(video.currentTime).toBe(25);
		await fireEvent.keyDown(video, { key: 'ArrowRight' });
		expect(video.currentTime).toBe(30);
	});

	it('requests fullscreen on F', async () => {
		const { container } = render(Player, {
			src: '/clip.mp4',
			title: 'Demo reel',
			tracks: captions,
		});
		const video = container.querySelector('video') as HTMLVideoElement;
		const request = vi.fn().mockResolvedValue(undefined);
		video.requestFullscreen = request;

		await fireEvent.keyDown(video, { key: 'f' });
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('reports a refused fullscreen request instead of swallowing it', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const { container } = render(Player, {
			src: '/clip.mp4',
			title: 'Demo reel',
			tracks: captions,
		});
		const video = container.querySelector('video') as HTMLVideoElement;
		const refusal = new TypeError('Permissions check failed');
		video.requestFullscreen = vi.fn().mockRejectedValue(refusal);

		await fireEvent.keyDown(video, { key: 'f' });
		await vi.waitFor(() => {
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('fullscreen'), refusal);
		});
		warn.mockRestore();
	});

	it('handles F without throwing where the element has no fullscreen API', async () => {
		const { container } = render(Player, {
			src: '/clip.mp4',
			title: 'Demo reel',
			tracks: captions,
		});
		const video = container.querySelector('video') as HTMLVideoElement;
		Object.defineProperty(video, 'requestFullscreen', { configurable: true, value: undefined });

		// `false` = the key was consumed (default prevented); nothing was called or thrown.
		expect(await fireEvent.keyDown(video, { key: 'f' })).toBe(false);
	});

	it('forces muted when autoplay is enabled', () => {
		const { container } = render(Player, {
			src: '/clip.mp4',
			title: 'Auto clip',
			tracks: [],
			autoplay: true,
		});
		const video = container.querySelector('video') as HTMLVideoElement;
		expect(video.muted).toBe(true);
	});

	it('is axe-clean (WCAG 2.2 AA) for a captioned video', async () => {
		const { container } = render(Player, {
			src: '/clip.mp4',
			title: 'Demo reel',
			tracks: captions,
		});
		await expectNoAxeViolations(container);
	});

	it('is axe-clean for an audio player', async () => {
		const { container } = render(Player, {
			src: '/song.mp3',
			title: 'Track',
			viewType: 'audio',
		});
		await expectNoAxeViolations(container);
	});
});
