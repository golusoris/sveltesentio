# @sveltesentio/media

> Headless media-player logic + responsive-image builders for media-server UIs

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

v0.2.0 — headless core landed. The pure logic for HLS rendition selection,
OS media-session metadata, a play/pause/quality state machine, a
bring-your-own-`hls.js` attachment seam, and responsive-image `srcset` / `sizes`
builders all ship and are unit-tested. The full `<Player>` UI shell
(`vidstack`) and the `./carousel` re-export are tracked as follow-throughs (see
[AGENTS.md](AGENTS.md)) and are **not** in this release.

## Install

```bash
pnpm add @sveltesentio/media
# optional, only if you drive adaptive HLS yourself:
pnpm add hls.js
```

`hls.js` is an **optional** peer — nothing in this package imports it. You
inject its constructor at the `createHlsAttachment` seam.

## `@sveltesentio/media/player`

```ts
import {
  pickRendition,
  buildMediaSessionMetadata,
  playbackReducer,
  initialPlaybackState,
  createHlsAttachment,
} from '@sveltesentio/media/player';

// Separate-rendition (un-muxed) quality switching: prefer HEVC, cap at 1080p.
const best = pickRendition(renditions, { maxHeight: 1080, preferCodec: 'hvc1' });

// OS lock-screen / media-keys metadata (pass to `new MediaMetadata(...)`).
const meta = buildMediaSessionMetadata({ title, artist, artwork });

// Pure play/pause/quality machine — invalid transitions are no-ops.
let state = playbackReducer(initialPlaybackState, { type: 'load' });

// Bring-your-own hls.js — no dynamic import, no bundled engine.
import Hls from 'hls.js';
const handle = createHlsAttachment(Hls).attach(videoEl, manifestUrl);
// handle.destroy();
```

## `@sveltesentio/media/image`

```ts
import { buildResponsiveImage } from '@sveltesentio/media/image';

const attrs = buildResponsiveImage('/images/poster/{path}', [320, 640, 1280], {
  template: '/images/poster/w{w}/abc.avif',
  sizes: [{ condition: '(min-width: 768px)', size: '33vw' }],
});
// → { src, srcset, sizes } — spread onto <img>.
```

See the [monorepo README](../../README.md) and [`docs/`](../../docs/) for design
principles.

## License

MIT © lusoris
