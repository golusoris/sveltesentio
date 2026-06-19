// Framework-agnostic playback reducer + MediaSession metadata.
import {
  playbackReducer,
  initialPlaybackState,
  buildMediaSessionMetadata,
  pickRendition,
} from '@sveltesentio/media';

let state = initialPlaybackState;
state = playbackReducer(state, { type: 'play' });
const src = pickRendition(renditions, { maxWidth: window.innerWidth });
navigator.mediaSession.metadata = buildMediaSessionMetadata({ title: 'Ep. 1', artwork });
