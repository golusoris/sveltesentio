# Media player — Vidstack `@next` + `hls.js`

`@sveltesentio/media/player` is a thin runes wrapper over Vidstack per
[ADR-0042](../adr/0042-vidstack-next-hls.md). Ships: a11y-defaulted
`<MediaPlayer>` with captions / keyboard controls / HLS auto-load.

**Critical gotcha.** npm `vidstack@latest` points to the **legacy 0.6.x
line** (pre-Svelte-5). The Svelte 5-compatible build is under the
`@next` dist-tag — currently `1.12.13`. Installing `vidstack` without
the specifier ships the legacy build and blocks runes. ADR-0042 makes
this explicit.

## Install

```bash
pnpm add vidstack@next hls.js
```

Or pin the range explicitly:

```json
{
  "dependencies": {
    "vidstack": ">=1.12 <2",
    "hls.js": "^1.6.16"
  }
}
```

`@sveltesentio/media/player` re-exports Vidstack with the pin applied.
Consumers who use the wrapper don't touch the dist-tag directly.

Safari has native HLS — `hls.js` is dynamically imported only on
non-Safari, so the 60 KB gzipped cost is off Safari bundles.

## Minimal usage

```svelte
<script lang="ts">
  import { MediaPlayer } from '@sveltesentio/media/player';
</script>

<MediaPlayer
  src="https://cdn.example.com/video.m3u8"
  poster="https://cdn.example.com/poster.jpg"
  title="How sveltesentio handles media"
  viewType="video"
/>
```

The wrapper accepts `src` as:

- HLS manifest (`.m3u8`) — Vidstack auto-detects and loads `hls.js`.
- DASH manifest (`.mpd`) — requires `dash.js` (separate opt-in; not
  bundled).
- Progressive MP4 — no extra dep.
- Source array for multi-bitrate / codec fallback.

## Multi-source + codec fallback

```svelte
<MediaPlayer
  src={[
    { src: 'video.av1.mp4', type: 'video/mp4; codecs=av01.0.05M.08' },
    { src: 'video.h265.mp4', type: 'video/mp4; codecs=hvc1.1.6.L93.B0' },
    { src: 'video.h264.mp4', type: 'video/mp4; codecs=avc1.64001F' },
  ]}
  title="Demo reel"
/>
```

Browser picks the first playable. HEVC (`hvc1`) is opt-in — don't
default to it; ~30% of browsers fail.

## Accessibility defaults

The wrapper wires (from Vidstack, not re-implemented):

| Feature | How |
|---|---|
| Captions / subtitles | `<track kind="captions" src="…" srclang="en" label="English">` — default on if present |
| Keyboard controls | Space/K play-pause, ← → seek, ↑ ↓ volume, F fullscreen, M mute |
| Focus ring | Vidstack's focus styling bound to sveltesentio tokens via CSS var bridge |
| SR announcements | `aria-label` on every control; live region for buffering |
| Reduced motion | Vidstack respects `prefers-reduced-motion` for chrome animations |

Required props for WCAG 1.2.x:

- `title` — always.
- Captions track — required for prerecorded speech (1.2.2 AA).
- `aria-describedby` to a description transcript — required for
  prerecorded media alternative (1.2.3 AA).

```svelte
<MediaPlayer src="video.m3u8" title="Q1 all-hands" aria-describedby="transcript">
  <track kind="captions" src="q1.vtt" srclang="en" label="English" default />
  <track kind="descriptions" src="q1.ad.vtt" srclang="en" label="Audio description" />
</MediaPlayer>
<div id="transcript" class="sr-only">[full transcript…]</div>
```

## Token bridging

Vidstack ships CSS custom properties (`--media-focus-ring`,
`--media-controls-color`, etc). Bridge to sveltesentio oklch tokens in
`@sveltesentio/media/player/player.css`:

```css
media-player {
  --media-focus-ring: oklch(var(--color-ring));
  --media-controls-color: oklch(var(--color-fg));
  --media-controls-bg: oklch(var(--color-bg) / 0.85);
  --media-slider-track-fill: oklch(var(--color-accent));
}
```

Never hex-code — theming stays consistent across preset switches
(see [theming.md](theming.md)).

## Layouts

Vidstack ships two layouts: `default` (video) and `audio`. The
wrapper maps to `viewType`:

```svelte
<MediaPlayer viewType="video" …/>  <!-- chrome: play, scrubber, vol, fullscreen, captions -->
<MediaPlayer viewType="audio" …/>  <!-- chrome: play, scrubber, vol, time -->
```

For custom chrome, drop to Vidstack primitives directly:

```svelte
<script lang="ts">
  import { MediaPlayer, MediaProvider, MediaPlayButton } from 'vidstack';
</script>

<MediaPlayer src="…">
  <MediaProvider />
  <div class="custom-chrome">
    <MediaPlayButton aria-label="Play" />
    <!-- … -->
  </div>
</MediaPlayer>
```

At that point you've opted out of the wrapper — the wrapper re-
implements defaults so you don't have to. Keep custom chrome minimal.

## Live streaming

HLS live streams are supported; Vidstack exposes `isLive` via the
store:

```svelte
<script lang="ts">
  import { MediaPlayer, useMediaStore } from '@sveltesentio/media/player';

  let playerRef: MediaPlayer;
  const store = $derived(playerRef ? useMediaStore(playerRef) : null);
</script>

<MediaPlayer bind:this={playerRef} src="live.m3u8" streamType="live" />

{#if store?.isLive}
  <span role="status" aria-live="polite" class="text-danger">● LIVE</span>
{/if}
```

`streamType="live"` disables DVR seeking; `streamType="ll-live"` for
low-latency HLS (requires compatible origin).

## Quality / bitrate UX

Vidstack's default quality menu reads from HLS variants. For adaptive
bitrate (default), leave the menu on. For manual pin:

```svelte
<MediaPlayer
  src="video.m3u8"
  onqualitychange={(e) => console.warn('quality', e.detail.height)}
/>
```

Never hide the quality menu — accessibility guidance (1.4.8: user
control of presentation). Respect `prefers-reduced-data` by
defaulting to the lowest ladder:

```ts
if (matchMedia('(prefers-reduced-data: reduce)').matches) {
  player.qualities.selected = player.qualities.at(0);
}
```

## Fullscreen + Picture-in-Picture

Both are user-gesture-gated by the browser. Wrapper wires the buttons;
consumers don't need to handle permissions.

iOS Safari restrictions:

- Inline playback requires `playsinline` — wrapper sets this by
  default.
- Fullscreen on iOS uses native `webkit-playsinline` instead of
  Fullscreen API — Vidstack handles both paths.

## PWA / service worker caching

Don't SW-cache full videos — storage hostile on mobile. Cache the
poster + manifest + first segment (for warm-start); let the CDN
handle the rest.

```ts
// sw.ts
registerRoute(
  ({ url }) => /\.(m3u8|vtt|jpg|png|webp)$/.test(url.pathname),
  new CacheFirst({ cacheName: 'media-meta', plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 })] }),
);
```

Segment files (`.ts` / `.m4s`) cache-control is on the origin. See
ADR-0028 (vite-pwa) for SW setup.

## Analytics

Vidstack exposes play / pause / ended / progress events. Wire once,
not per-player:

```svelte
<script lang="ts">
  import { track } from '$lib/telemetry';

  function onplay(e: Event) {
    track('media.play', { src: (e.target as any).src });
  }
</script>

<MediaPlayer src="…" {onplay} />
```

Respect Do Not Track:

```ts
if (navigator.doNotTrack === '1') return;
```

## Testing

```ts
import { render } from '@testing-library/svelte';
import { axe } from '@sveltesentio/testing/axe';
import { MediaPlayer } from '@sveltesentio/media/player';

test('MediaPlayer is axe-clean', async () => {
  const { container } = render(MediaPlayer, {
    props: { src: 'test.mp4', title: 'Test' },
  });
  expect(await axe(container)).toHaveNoViolations();
});

test('keyboard Space toggles play', async () => {
  const { container, getByLabelText } = render(MediaPlayer, { props: { src: 'test.mp4', title: 'T' } });
  const player = container.querySelector('media-player')!;
  player.focus();
  await userEvent.keyboard(' ');
  expect(getByLabelText(/pause/i)).toBeInTheDocument();
});
```

Playwright: use a short local fixture clip (≤1 s WebM) to keep runs
fast. Don't hit live CDNs in tests.

## Bundle footprint

| Piece | gzipped |
|---|---|
| Vidstack core + default layout | ~45 KB |
| `hls.js` (dyn-imported non-Safari) | ~60 KB |
| `@sveltesentio/media/player` wrapper | <2 KB |

Lazy-load for pages that don't always play media:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  let MediaPlayer = $state<any>(null);
  onMount(async () => {
    ({ MediaPlayer } = await import('@sveltesentio/media/player'));
  });
</script>

{#if MediaPlayer}<MediaPlayer src="…" title="…" />{/if}
```

## Anti-patterns

- **`pnpm add vidstack`** — installs legacy 0.6.x. Always `@next` or
  pin `>=1.12 <2`.
- **Hex-coded player colors.** Breaks theming. Bridge via oklch
  tokens.
- **No captions track on prerecorded speech.** WCAG 1.2.2 AA fail.
- **Hiding the quality menu.** User-control-of-presentation fail.
- **Full video SW caching.** Storage hostile on mobile; CDN
  responsibility.
- **HEVC default.** ~30% failure rate. Keep as last-ladder fallback.
- **Tracking without DNT check.** Privacy + likely GDPR violation.
- **Running HLS manifests through `fetch` before playback.** Vidstack
  handles CORS + byte-range. Don't pre-fetch.

## References

- ADR-0042 — Vidstack `@next` pin + `hls.js@^1.6`.
- [theming.md](theming.md) — oklch token bridge.
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — manual pass for
  WCAG 1.2.x captions / audio description.
- Vidstack docs: <https://vidstack.io/docs>.
- hls.js: <https://github.com/video-dev/hls.js>.
- WCAG 1.2 (time-based media):
  <https://www.w3.org/WAI/WCAG22/Understanding/time-based-media>.
