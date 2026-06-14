# `video-streaming.md` — adaptive video streaming recipe for sveltesentio

When [media-player.md](media-player.md) (vidstack + hls.js for
single-file playback) outgrows its envelope — long-form content,
live streams, paid-content protection, multi-bitrate delivery,
thumbnail scrub previews, captions across multiple languages — you
graduate to a **streaming** architecture: HLS or DASH manifests,
adaptive bitrate (ABR), optional DRM (Widevine / FairPlay /
PlayReady), CDN-delivered segments, and signed-URL access control,
per [ADR-0042](../adr/0042-media-player.md) +
[ADR-0023](../adr/0023-compliance-observability.md).

This recipe **does not encode video itself** — it consumes
manifests + segments produced by your encoding pipeline (ffmpeg /
AWS MediaConvert / Mux / Cloudflare Stream / Bitmovin). The
encoder is a separate concern; this recipe owns the **delivery
contract** (signed URLs, manifest variants, captions, thumbnails),
the **player wiring** (vidstack + hls.js + DRM EME hooks), and the
**observability** (QoE metrics: rebuffer ratio, startup time, ABR
switches, error rate).

## Related

- [media-player.md](media-player.md) — single-file vidstack baseline
  (this recipe extends it for multi-bitrate / DRM / live)
- [uploads.md](uploads.md) — content ingestion (videos uploaded for
  encoding)
- [caching.md](caching.md) — segment cache headers (immutable +
  long TTL)
- [observability.md](observability.md) — QoE metric emission
- [rate-limiting.md](rate-limiting.md) — signed-URL endpoint
  protection
- [audit-log.md](audit-log.md) — playback-session events for paid
  content
- [billing-usage-metering.md](billing-usage-metering.md) — minutes-
  streamed metering
- [content-moderation.md](content-moderation.md) — uploaded video
  classifier triage
- [ADR-0042](../adr/0042-media-player.md)
- [ADR-0023](../adr/0023-compliance-observability.md)

## When to use what — decision tree

```text
Single MP4, short clip                        → media-player.md (skip this)
Multi-bitrate VOD                              → this recipe (HLS or DASH)
Live stream                                    → this recipe + LL-HLS or WebRTC SFU
Paid content (no rip protection needed)        → this recipe + signed URLs
Studio-content (Hollywood / mandated DRM)      → this recipe + Widevine + FairPlay + PlayReady
Sports / concerts (lowest latency)             → WebRTC SFU (LiveKit / Mediasoup) — out of scope here
Thumbnails on scrubber                          → this recipe (WebVTT thumbnail track)
360° / VR video                                → this recipe + WebXR (out of scope here)
```

## Architecture — the delivery path

```text
encoder (Mux / MediaConvert / ffmpeg)
   │ produces:
   │  - master.m3u8 / manifest.mpd
   │  - <bitrate>/<segment>.ts or .m4s
   │  - thumbnails.vtt + sprite.jpg
   │  - subtitles/<lang>.vtt
   │  - drm-key (KMS-stored)
   ▼
S3 / R2 (segments) + CDN (CloudFront / Cloudflare)
   │ Cache-Control: public, max-age=31536000, immutable on segments
   │ Cache-Control: public, max-age=10 on manifests
   ▼
SvelteKit /api/stream/{id}/manifest.m3u8
   │ - authz check (subscription / rental / public)
   │ - signed URL generation (CDN signed cookie or per-segment query)
   │ - manifest variant filter (geo, bitrate cap, accessibility)
   ▼
client (vidstack + hls.js + EME for DRM)
   │ QoE metrics → /api/qoe (sampled)
```

The SvelteKit endpoint is the **policy gate** — it never proxies
bytes (CDN does that). It only decides "may this user load this
manifest?" and "how do they prove themselves to the CDN?" via
signed cookies or signed URLs.

## Shape — bounded Zod contracts

```ts
// packages/streaming/src/schema.ts
import { z } from 'zod';

export const StreamProtocol = z.enum(['hls', 'dash']);
export type StreamProtocol = z.infer<typeof StreamProtocol>;

export const DrmSystem = z.enum(['widevine', 'fairplay', 'playready', 'clearkey', 'none']);
export type DrmSystem = z.infer<typeof DrmSystem>;

export const VideoAsset = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  title: z.string().min(1).max(300),
  durationMs: z.number().int().nonnegative(),
  protocol: StreamProtocol,
  drm: DrmSystem.default('none'),
  // Available variants — bandwidth-sorted for ABR ladder
  variants: z.array(z.object({
    bandwidth_bps: z.number().int().min(50_000).max(50_000_000),
    width: z.number().int().min(144).max(7680),
    height: z.number().int().min(144).max(4320),
    codec: z.string().min(1).max(50),
  })).min(1).max(15),
  hasCaptions: z.boolean(),
  captionLangs: z.array(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/)).max(50),
  thumbnailsUrl: z.string().url().nullable(),
  visibility: z.enum(['public', 'authenticated', 'paid', 'unlisted']),
});
export type VideoAsset = z.infer<typeof VideoAsset>;

export const PlaybackToken = z.object({
  assetId: z.string().uuid(),
  userId: z.string().uuid().nullable(), // null for anonymous public playback
  expiresAt: z.string().datetime(),
  // Restrictions baked into the token
  geo: z.array(z.string().regex(/^[A-Z]{2}$/)).optional(),
  maxBitrate: z.number().int().positive().optional(),
});
export type PlaybackToken = z.infer<typeof PlaybackToken>;

export const QoeEvent = z.object({
  sessionId: z.string().uuid(),
  assetId: z.string().uuid(),
  ts: z.string().datetime(),
  kind: z.enum([
    'session_start',
    'first_frame',
    'rebuffer_start',
    'rebuffer_end',
    'bitrate_change',
    'error',
    'session_end',
  ]),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type QoeEvent = z.infer<typeof QoeEvent>;
```

## Reference — manifest endpoint with signed CDN cookies

```ts
// src/routes/api/stream/[assetId]/manifest.m3u8/+server.ts
import { error } from '@sveltejs/kit';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { videoRepo } from '$lib/server/repos';
import { permissions } from '$lib/server/permissions';
import { signCdnCookie } from '$lib/server/cdn';
import { auditLog } from '$lib/server/audit';

const Params = z.object({ assetId: z.string().uuid() });

export const GET = async ({ params, locals, getClientAddress, request }) => {
  const { assetId } = Params.parse(params);
  const asset = await videoRepo.findById(assetId);
  if (!asset) throw error(404, { type: 'not_found' });

  // Authorization gate
  switch (asset.visibility) {
    case 'public':
      break;
    case 'authenticated':
      if (!locals.user) throw error(401, { type: 'auth_required' });
      break;
    case 'paid':
      if (!locals.user) throw error(401, { type: 'auth_required' });
      const access = await permissions(locals.user).hasAccessTo(assetId);
      if (!access) throw error(402, { type: 'payment_required' });
      break;
    case 'unlisted':
      // Tokenized URL only — caller must have a valid view token
      const token = request.headers.get('x-view-token');
      if (!token || !(await videoRepo.validateUnlistedToken(assetId, token))) {
        throw error(403, { type: 'forbidden' });
      }
      break;
  }

  // Geo restriction
  const country = request.headers.get('cf-ipcountry') ?? request.headers.get('x-country');
  if (asset.geoRestrict && country && asset.blockedCountries?.includes(country)) {
    throw error(451, { type: 'unavailable_for_legal_reasons' });
  }

  // Sign CDN cookie scoped to this asset's segment URLs
  const cookies = signCdnCookie({
    resource: `https://cdn.example.com/streams/${assetId}/*`,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h
    ip: getClientAddress(),
  });

  await auditLog('video.manifest.served', {
    assetId,
    userId: locals.user?.id ?? null,
    ip: getClientAddress(),
    country,
    sessionId: uuidv7(),
  });

  // Fetch the manifest from origin (S3) once, then return it.
  // Manifest itself is small (~KB); CDN caches it briefly.
  const manifest = await fetch(`https://origin.example.com/streams/${assetId}/master.m3u8`).then((r) => r.text());

  return new Response(manifest, {
    headers: {
      'content-type': 'application/vnd.apple.mpegurl',
      'cache-control': 'private, max-age=10',
      'set-cookie': cookies.join(', '),
      // Vary on auth so anonymous and authenticated responses don't mix in caches
      'vary': 'cookie, x-view-token',
    },
  });
};
```

`Cache-Control: private, max-age=10` on manifests — short enough to
pick up new variants, long enough to absorb thundering-herd reloads.
**Segments** (the underlying `.ts` / `.m4s` files) carry
`Cache-Control: public, max-age=31536000, immutable` because they're
content-addressed (filename includes a hash); they cache forever at
the CDN.

## Reference — vidstack player with HLS + DRM

```svelte
<!-- src/lib/components/StreamPlayer.svelte -->
<script lang="ts">
  import 'vidstack/styles/defaults.css';
  import { MediaPlayer, MediaProvider, useMediaStore } from '@vidstack/svelte';
  import type { VideoAsset, QoeEvent } from '@sveltesentio/streaming/schema';

  type Props = { asset: VideoAsset };
  const { asset }: Props = $props();

  const manifestUrl = $derived(`/api/stream/${asset.id}/manifest.${asset.protocol === 'hls' ? 'm3u8' : 'mpd'}`);
  let player: any = $state(null);
  const sessionId = crypto.randomUUID();

  function emitQoe(kind: QoeEvent['kind'], details?: QoeEvent['details']) {
    const event: QoeEvent = {
      sessionId,
      assetId: asset.id,
      ts: new Date().toISOString(),
      kind,
      details,
    };
    // Use sendBeacon so unload events don't get dropped
    if (kind === 'session_end' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/qoe', new Blob([JSON.stringify(event)], { type: 'application/json' }));
    } else {
      void fetch('/api/qoe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
        keepalive: true,
      }).catch(() => {});
    }
  }

  function onPlayerReady(p: any) {
    player = p;
    emitQoe('session_start');

    p.addEventListener('can-play', () => emitQoe('first_frame'));
    p.addEventListener('waiting', () => emitQoe('rebuffer_start'));
    p.addEventListener('playing', () => emitQoe('rebuffer_end'));
    p.addEventListener('quality-change', (e: CustomEvent<{ height: number; bandwidth: number }>) =>
      emitQoe('bitrate_change', { height: e.detail.height, bandwidth: e.detail.bandwidth }),
    );
    p.addEventListener('error', (e: ErrorEvent) =>
      emitQoe('error', { message: e.message ?? 'unknown' }),
    );
  }

  $effect(() => {
    return () => emitQoe('session_end');
  });

  // DRM key system selection (browser support varies)
  const drmConfig = $derived(asset.drm === 'none' ? undefined : {
    keySystems: {
      'com.widevine.alpha': { serverURL: `/api/drm/widevine/${asset.id}` },
      'com.apple.fps.1_0':  { serverURL: `/api/drm/fairplay/${asset.id}` },
      'com.microsoft.playready': { serverURL: `/api/drm/playready/${asset.id}` },
    },
  });
</script>

<MediaPlayer
  src={manifestUrl}
  title={asset.title}
  crossorigin
  storage="player-prefs"
  oncan-play={(e) => onPlayerReady(e.detail.player)}
  bind:player
>
  <MediaProvider />
  <!-- vidstack default UI; swap for custom controls per ux-principles -->
</MediaPlayer>
```

`navigator.sendBeacon` for `session_end` survives page unload (close
tab, navigate away). Other events use `fetch` with `keepalive: true`
which is similarly resilient.

## Thumbnails on scrubber — WebVTT thumbnail track

```text
# thumbnails.vtt — generated by ffmpeg during encoding
WEBVTT

00:00:00.000 --> 00:00:10.000
sprite.jpg#xywh=0,0,160,90

00:00:10.000 --> 00:00:20.000
sprite.jpg#xywh=160,0,160,90
```

vidstack picks this up automatically via `<track kind="thumbnails"
src="…/thumbnails.vtt">` — hovering the scrubber shows the
appropriate sprite slice. Encoder must produce both `thumbnails.vtt`
+ `sprite.jpg` (one tile every 10s is the rule of thumb).

## Captions — multi-language WebVTT tracks

```svelte
{#each asset.captionLangs as lang}
  <track
    kind="subtitles"
    src={`/api/stream/${asset.id}/captions/${lang}.vtt`}
    srclang={lang}
    label={languageNameOf(lang)}
    default={lang === asset.defaultCaptionLang}
  />
{/each}
```

Captions are required for **WCAG 1.2.2 (Captions, prerecorded) AA**.
Even autoplay-disabled videos benefit from captions for SEO + sound-
off contexts (mobile, public spaces).

## Live streaming — LL-HLS variant

For live, the manifest endpoint serves a **rolling** `.m3u8` with
`#EXT-X-PLAYLIST-TYPE:EVENT` (live) and short segments (2-6s for
LL-HLS targeting <5s end-to-end latency). Live introduces:

- **Manifest is mutable** — `Cache-Control: max-age=2` (sub-segment
  duration), CDN must honor short TTLs
- **DVR window** — keep N hours of past segments; older segments
  expire from manifest but stay reachable for catchup
- **Stream key authentication** — encoder pushes via RTMP/SRT to
  ingest endpoint protected by per-broadcaster key; the ingest layer
  is **outside** sveltesentio (use Mux / Cloudflare Stream / nginx-
  rtmp). This recipe consumes only the published HLS manifest.

## QoE collector endpoint

```ts
// src/routes/api/qoe/+server.ts
import { QoeEvent } from '@sveltesentio/streaming/schema';
import { qoeRepo } from '$lib/server/repos';
import { rateLimit } from '$lib/server/rate-limit';

export const POST = async ({ request, getClientAddress }) => {
  await rateLimit({
    key: `qoe:${getClientAddress()}`,
    limit: 100,
    windowMs: 60_000,
  });

  const body = await request.json();
  const parsed = QoeEvent.safeParse(body);
  if (!parsed.success) return new Response('invalid', { status: 400 });

  // Sample 10% of non-error events to control storage; always keep errors.
  if (parsed.data.kind !== 'error' && Math.random() > 0.1) {
    return new Response(null, { status: 204 });
  }

  await qoeRepo.insert(parsed.data);
  return new Response(null, { status: 204 });
};
```

QoE metrics surface as Prometheus gauges via
[observability.md](observability.md): `video_rebuffer_ratio`,
`video_startup_time_ms_p99`, `video_error_rate_per_session`. Each is
SLO-eligible — alert when degraded.

## Anti-patterns (24)

1. **Proxying segments through SvelteKit** — node serves video bytes
   instead of CDN; bandwidth bill explodes; latency triples. Always
   redirect/sign-cookie to CDN.
2. **Long manifest TTL** — `max-age=3600` on manifest means new
   variants take an hour to surface; live streams broken entirely.
3. **Short segment TTL** — segments are content-addressed, immutable
   forever; missing `immutable` directive causes CDN re-validation
   storms.
4. **Signed URLs without expiry** — link forwarded to scrapers
   becomes permanent free CDN.
5. **Signed URLs without IP binding** — leaked URL works from
   anywhere; mass piracy.
6. **DRM enforced on free content** — adds CDM overhead, blocks
   linux/some-browsers, no benefit. DRM only when contractually
   required.
7. **No fallback for browsers without EME** — Widevine fails on
   Linux Firefox by default; no graceful message → broken playback.
8. **CORS missing on segment URLs** — vidstack/hls.js can't fetch
   bytes; manifest plays for 0.1s then errors.
9. **`Vary` header missing on per-user manifest** — CDN serves
   wrong-user manifests to other users; data leak.
10. **Captions optional / absent** — WCAG 1.2.2 violation; sound-off
    autoplay loses 80% of viewers.
11. **One bitrate ladder for all devices** — 4K iPhone gets the
    same as desktop with gigabit. ABR with per-device caps.
12. **No bandwidth cap for mobile** — autoplay uses cellular data;
    user gets surprise bill. Default to lower bitrate on mobile +
    `Save-Data` header.
13. **No `audio-only` track in low-bandwidth ladder** — video
    stalls on 2G; audio could keep playing. Include audio-only
    rendition.
14. **Hardcoded segment duration** — 10s segments waste bandwidth on
    short jumps; 1s segments overload manifest. 4-6s VOD, 2s LL-HLS.
15. **No QoE telemetry** — you don't know your rebuffer rate;
    silent degradation.
16. **Sampling QoE without keeping errors** — error rate
    underestimated by sampling factor; outages invisible.
17. **`navigator.sendBeacon` not used for session_end** — tab close
    drops the event; session-length metric biased low.
18. **Encoder produces single VBR file, not ladder** — no ABR; users
    on slow connections get stalls instead of lower quality.
19. **Manifest endpoint not rate-limited** — manifest scrapers DOS
    the auth gate.
20. **Geo-restriction in CDN only** — VPN bypass trivially defeats;
    enforce server-side at the manifest gate.
21. **No audit-log on paid-content access** — fraud / charge-back
    investigations have no trail.
22. **No DRM rotation policy** — same content key forever; one leak
    = permanent piracy. Per-asset key + rotation on policy events.
23. **Live DVR window unbounded** — segment storage grows linearly;
    bill grows linearly. Cap window per stream + lifecycle policy.
24. **Player auto-plays with sound on** — Chrome autoplay policy
    blocks; many users react negatively. Default `muted autoplay
    playsinline` on hero, click-to-unmute.

## References

- ADRs: [0042](../adr/0042-media-player.md),
  [0023](../adr/0023-compliance-observability.md),
  [0019](../adr/0019-server-runtime-contract.md)
- Sibling recipes:
  [media-player.md](media-player.md),
  [uploads.md](uploads.md),
  [caching.md](caching.md),
  [observability.md](observability.md),
  [rate-limiting.md](rate-limiting.md),
  [audit-log.md](audit-log.md),
  [billing-usage-metering.md](billing-usage-metering.md),
  [content-moderation.md](content-moderation.md)
- Upstream:
  HLS spec RFC 8216 `datatracker.ietf.org/doc/html/rfc8216`,
  HLS Authoring Spec
  `developer.apple.com/documentation/http-live-streaming`,
  MPEG-DASH ISO/IEC 23009-1 `www.iso.org/standard/79329.html`,
  W3C EME (Encrypted Media Extensions)
  `www.w3.org/TR/encrypted-media/`,
  Widevine `widevine.com`, FairPlay
  `developer.apple.com/streaming/fps/`,
  vidstack `vidstack.io`, hls.js `github.com/video-dev/hls.js`,
  Mux `www.mux.com/docs`, Cloudflare Stream
  `developers.cloudflare.com/stream/`.
