// Framework-agnostic playback reducer + MediaSession metadata.
import {
	playbackReducer,
	initialPlaybackState,
	buildMediaSessionMetadata,
	pickRendition,
} from '@sveltesentio/media';

export const state = playbackReducer(initialPlaybackState, { type: 'play' });
export const src = pickRendition(renditions, { maxWidth: window.innerWidth });
navigator.mediaSession.metadata = buildMediaSessionMetadata({ title: 'Ep. 1', artwork });
