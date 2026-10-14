# Changelog

## [0.5.1](https://github.com/golusoris/sveltesentio/compare/media-v0.5.0...media-v0.5.1) (2026-10-13)

### Bug Fixes

- **deps:** update test tooling (major) ([#263](https://github.com/golusoris/sveltesentio/issues/263)) ([9b9faaa](https://github.com/golusoris/sveltesentio/commit/9b9faaae1e94a3fb2e0d1bb4e53a34edea926847))
- type-check every .svelte file under packages/ with svelte-check ([#316](https://github.com/golusoris/sveltesentio/issues/316)) ([0c394b7](https://github.com/golusoris/sveltesentio/commit/0c394b7bddd23bc47bceb0c7438963a48e17fd19))

## [0.5.0](https://github.com/golusoris/sveltesentio/compare/media-v0.4.1...media-v0.5.0) (2026-10-12)

### ⚠ BREAKING CHANGES

- **licence:** licence MIT -> EUPL-1.2. Releases from the next minor of each package on are EUPL-1.2, a copyleft licence; releases already published stay MIT.

### Features

- **governance:** declare HISS-20 enforcement evidence, backed by fixtures ([e803ea4](https://github.com/golusoris/sveltesentio/commit/e803ea401055b15ea7e9df5eeb0a4c37cf714963))

### Bug Fixes

- **deps:** repair regressions introduced by the Praetor dependency pass ([f14552b](https://github.com/golusoris/sveltesentio/commit/f14552be15d1fe0c9e94ce4caecae098a8789106))
- **hiss-04:** enforce the complexity bound and clear the 13 functions over it ([a4f37c0](https://github.com/golusoris/sveltesentio/commit/a4f37c085b657df92bac451ed04a08b84bfe89c3))
- make every story pass axe in a browser and gate stories and end-to-end tests in ci ([#290](https://github.com/golusoris/sveltesentio/issues/290)) ([88c98d3](https://github.com/golusoris/sveltesentio/commit/88c98d394a59b14c4c44ce18ade88a82bfe44c2e))
- **packages:** name the source repository and the licensor in every published package ([#299](https://github.com/golusoris/sveltesentio/issues/299)) ([830318a](https://github.com/golusoris/sveltesentio/commit/830318abf9f7339da63b4c7d357a0565b097b746))
- **types:** put test code under a TypeScript project, and fix the 32 errors ([1138831](https://github.com/golusoris/sveltesentio/commit/11388316e60e6f3fb738255750b2e5606a52d848))

### Chores

- **licence:** relicense the project from mit to eupl-1.2 ([#286](https://github.com/golusoris/sveltesentio/issues/286)) ([c07c2ac](https://github.com/golusoris/sveltesentio/commit/c07c2aca14173e2d5bce783a531f47988dc307b0))

## [0.4.1](https://github.com/golusoris/sveltesentio/compare/media-v0.4.0...media-v0.4.1) (2026-06-20)

### Bug Fixes

- **media:** keep server-only core out of &lt;Player&gt; client bundles ([308d2ec](https://github.com/golusoris/sveltesentio/commit/308d2ec55aedd4e008283d025a36d0b4c1847c19))

## [0.4.0](https://github.com/golusoris/sveltesentio/compare/media-v0.3.0...media-v0.4.0) (2026-06-15)

### Features

- land foundation packages and repair CI gate ([#41](https://github.com/golusoris/sveltesentio/issues/41)) ([7557620](https://github.com/golusoris/sveltesentio/commit/75576200e324cd4c55f48571a6532540c1f6eb16))
- **media:** &lt;Player&gt; + &lt;Carousel&gt; + &lt;Image&gt; UI surfaces ([b4a9fa4](https://github.com/golusoris/sveltesentio/commit/b4a9fa499a9c5f2744a11acfb428c7814e7de98a))
- **media:** headless HLS player model + responsive image srcset helpers ([262b2d0](https://github.com/golusoris/sveltesentio/commit/262b2d0af9ee73222229bbc90975c911a740003b))

## [0.3.0](https://github.com/golusoris/sveltesentio/compare/media-v0.2.0...media-v0.3.0) (2026-06-15)

### Features

- **media:** &lt;Player&gt; + &lt;Carousel&gt; + &lt;Image&gt; UI surfaces ([b4a9fa4](https://github.com/golusoris/sveltesentio/commit/b4a9fa499a9c5f2744a11acfb428c7814e7de98a))

## [0.2.0](https://github.com/golusoris/sveltesentio/compare/media-v0.1.0...media-v0.2.0)

### Features

- **player:** headless HLS source model — `pickRendition` (separate-rendition quality switching with `maxHeight` / `preferCodec`), `buildMediaSessionMetadata`, a pure `playbackReducer` play/pause/quality state machine, and a bring-your-own-`hls.js` `createHlsAttachment` seam ([#67](https://github.com/golusoris/sveltesentio/issues/67), [#68](https://github.com/golusoris/sveltesentio/issues/68))
- **image:** pure responsive-image `buildSrcSet` / `buildSizes` / `buildResponsiveImage` builders with template + query-merge URL strategies ([#67](https://github.com/golusoris/sveltesentio/issues/67))
- sub-exports `./player` and `./image`; `hls.js` declared as an optional peer (no runtime media deps)

### Notes

- The `vidstack@next` `<Player>` UI shell and the `./carousel` re-export remain follow-throughs; README and AGENTS status reconciled per [#67](https://github.com/golusoris/sveltesentio/issues/67).

## [0.1.0](https://github.com/golusoris/sveltesentio/compare/media-v0.0.1...media-v0.1.0) (2026-06-14)

### Features

- land foundation packages and repair CI gate ([#41](https://github.com/golusoris/sveltesentio/issues/41)) ([7557620](https://github.com/golusoris/sveltesentio/commit/75576200e324cd4c55f48571a6532540c1f6eb16))
