import { describe, it, expect } from 'vitest';
import {
	pickRendition,
	buildMediaSessionMetadata,
	playbackReducer,
	initialPlaybackState,
	createHlsAttachment,
} from '../src/player';
import type {
	HlsRendition,
	HlsLike,
	PlaybackState,
} from '../src/player';

const renditions: HlsRendition[] = [
	{ id: '240', height: 240, bitrate: 400_000, codec: 'avc1.640015' },
	{ id: '480', height: 480, bitrate: 1_200_000, codec: 'avc1.640028' },
	{ id: '1080', height: 1080, bitrate: 5_000_000, codec: 'avc1.640032' },
	{ id: '1080-hevc', height: 1080, bitrate: 3_500_000, codec: 'hvc1.1.6.L120.B0' },
	{ id: 'audio-en', bitrate: 128_000, codec: 'mp4a.40.2', language: 'en' },
];

describe('pickRendition', () => {
	it('picks the highest height when unconstrained', () => {
		const r = pickRendition(renditions);
		expect(r?.height).toBe(1080);
	});

	it('respects maxHeight', () => {
		const r = pickRendition(renditions, { maxHeight: 480 });
		expect(r?.id).toBe('480');
	});

	it('prefers the codec match over a higher-bitrate non-match at equal height', () => {
		const r = pickRendition(renditions, { maxHeight: 1080, preferCodec: 'hvc1' });
		expect(r?.id).toBe('1080-hevc');
	});

	it('codec preference is case-insensitive', () => {
		const r = pickRendition(renditions, { preferCodec: 'HVC1' });
		expect(r?.id).toBe('1080-hevc');
	});

	it('falls back to a non-matching codec when no rendition matches', () => {
		const r = pickRendition(renditions, { preferCodec: 'vp09' });
		// no vp9 present → highest-rank wins regardless of codec
		expect(r?.height).toBe(1080);
	});

	it('never excludes audio-only renditions by height but does not pick them over video', () => {
		const r = pickRendition(
			[{ id: 'audio-en', bitrate: 128_000, language: 'en' }, ...renditions],
			{ maxHeight: 240 },
		);
		expect(r?.id).toBe('240');
	});

	it('returns the only rendition above maxHeight when nothing is eligible', () => {
		const r = pickRendition([{ id: '4k', height: 2160 }], { maxHeight: 720 });
		expect(r?.id).toBe('4k');
	});

	it('returns undefined for an empty list', () => {
		expect(pickRendition([])).toBeUndefined();
	});

	it('breaks height ties by bitrate when no codec preference', () => {
		const r = pickRendition([
			{ id: 'a', height: 720, bitrate: 2_000_000 },
			{ id: 'b', height: 720, bitrate: 3_000_000 },
		]);
		expect(r?.id).toBe('b');
	});
});

describe('buildMediaSessionMetadata', () => {
	it('passes through provided fields', () => {
		const m = buildMediaSessionMetadata({
			title: 'Ep 1',
			artist: 'Show',
			album: 'Season 1',
			artwork: [{ src: '/p.png', sizes: '512x512', type: 'image/png' }],
		});
		expect(m).toEqual({
			title: 'Ep 1',
			artist: 'Show',
			album: 'Season 1',
			artwork: [{ src: '/p.png', sizes: '512x512', type: 'image/png' }],
		});
	});

	it('defaults artist/album to empty string and artwork to empty array', () => {
		const m = buildMediaSessionMetadata({ title: 'Solo' });
		expect(m).toEqual({ title: 'Solo', artist: '', album: '', artwork: [] });
	});
});

describe('playbackReducer', () => {
	it('drives the happy-path lifecycle idle→loading→paused→playing→ended', () => {
		let s: PlaybackState = initialPlaybackState;
		expect(s.status).toBe('idle');
		s = playbackReducer(s, { type: 'load' });
		expect(s.status).toBe('loading');
		s = playbackReducer(s, { type: 'ready' });
		expect(s.status).toBe('paused');
		s = playbackReducer(s, { type: 'play' });
		expect(s.status).toBe('playing');
		s = playbackReducer(s, { type: 'end' });
		expect(s.status).toBe('ended');
	});

	it('replays from ended via play', () => {
		const s = playbackReducer(
			{ status: 'ended', renditionId: null },
			{ type: 'play' },
		);
		expect(s.status).toBe('playing');
	});

	it('ignores invalid transitions as no-ops', () => {
		const idle = initialPlaybackState;
		expect(playbackReducer(idle, { type: 'play' })).toBe(idle);
		expect(playbackReducer(idle, { type: 'pause' })).toBe(idle);
		expect(playbackReducer(idle, { type: 'end' })).toBe(idle);
		const playing: PlaybackState = { status: 'playing', renditionId: null };
		expect(playbackReducer(playing, { type: 'ready' })).toBe(playing);
	});

	it('pauses only from playing', () => {
		const playing: PlaybackState = { status: 'playing', renditionId: null };
		expect(playbackReducer(playing, { type: 'pause' }).status).toBe('paused');
	});

	it('selects quality orthogonally to lifecycle but not while idle', () => {
		const idle = initialPlaybackState;
		expect(
			playbackReducer(idle, { type: 'selectQuality', renditionId: '1080' }),
		).toBe(idle);
		const paused: PlaybackState = { status: 'paused', renditionId: null };
		const next = playbackReducer(paused, {
			type: 'selectQuality',
			renditionId: '1080',
		});
		expect(next).toEqual({ status: 'paused', renditionId: '1080' });
	});

	it('reset returns the initial state', () => {
		const dirty: PlaybackState = { status: 'playing', renditionId: '480' };
		expect(playbackReducer(dirty, { type: 'reset' })).toEqual(
			initialPlaybackState,
		);
	});
});

describe('createHlsAttachment', () => {
	function fakeHls(log: string[]): { ctor: new (config?: unknown) => HlsLike } {
		class FakeHls implements HlsLike {
			currentLevel = -1;
			constructor(config?: unknown) {
				log.push(`new:${JSON.stringify(config ?? null)}`);
			}
			loadSource(url: string): void {
				log.push(`load:${url}`);
			}
			attachMedia(_media: HTMLMediaElement): void {
				log.push('attach');
			}
			destroy(): void {
				log.push('destroy');
			}
		}
		return { ctor: FakeHls };
	}

	const media = {} as HTMLMediaElement;

	it('attaches media then loads the source via the injected constructor', () => {
		const log: string[] = [];
		const { ctor } = fakeHls(log);
		const attachment = createHlsAttachment(ctor);
		const handle = attachment.attach(media, 'https://cdn/x.m3u8');
		expect(log).toEqual(['new:null', 'attach', 'load:https://cdn/x.m3u8']);
		handle.destroy();
		expect(log.at(-1)).toBe('destroy');
	});

	it('forwards constructor config when provided', () => {
		const log: string[] = [];
		const { ctor } = fakeHls(log);
		const attachment = createHlsAttachment(ctor, {
			config: { lowLatencyMode: true },
		});
		attachment.attach(media, 'x.m3u8');
		expect(log[0]).toBe('new:{"lowLatencyMode":true}');
	});
});
