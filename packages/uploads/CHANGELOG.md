# Changelog

## [0.5.2](https://github.com/golusoris/sveltesentio/compare/uploads-v0.5.1...uploads-v0.5.2) (2026-10-25)

### Bug Fixes

- **lint:** lint the package tests with type information ([#463](https://github.com/golusoris/sveltesentio/issues/463)) ([4e654bb](https://github.com/golusoris/sveltesentio/commit/4e654bbe0a64b7e7127422d3c899d1532ca6a4fa))

## [0.5.1](https://github.com/golusoris/sveltesentio/compare/uploads-v0.5.0...uploads-v0.5.1) (2026-10-25)

### Code Refactoring

- **test:** share one node Vitest config across ten packages ([#435](https://github.com/golusoris/sveltesentio/issues/435)) ([dafbf95](https://github.com/golusoris/sveltesentio/commit/dafbf95b0007e93cae98cf02d2a01337df033590))

## [0.5.0](https://github.com/golusoris/sveltesentio/compare/uploads-v0.4.0...uploads-v0.5.0) (2026-10-19)

### Features

- **uploads:** map tus server responses to RFC 9457 ProblemError ([#389](https://github.com/golusoris/sveltesentio/issues/389)) ([049af0c](https://github.com/golusoris/sveltesentio/commit/049af0c1d25035acb6e70d3b6ebb35be51469194))

## [0.4.0](https://github.com/golusoris/sveltesentio/compare/uploads-v0.3.1...uploads-v0.4.0) (2026-10-14)

### ⚠ BREAKING CHANGES

- every @sveltesentio/* package declares the peer dependency typescript ">=5.5 <7". Package managers that enforce peers refuse or warn on installs with TypeScript below 5.5 or at 7 and above.
- every @sveltesentio/* package declares engines.node >=24. Package managers that enforce engines refuse installs on Node 22.

### Bug Fixes

- declare the Node 24 floor in every published package ([#348](https://github.com/golusoris/sveltesentio/issues/348)) ([6b02d54](https://github.com/golusoris/sveltesentio/commit/6b02d54cc07cf8d190084a154f611a9b17ec99d1))
- declare the TypeScript peer range in every published package ([#350](https://github.com/golusoris/sveltesentio/issues/350)) ([a416a1c](https://github.com/golusoris/sveltesentio/commit/a416a1c68671f0304799d7f4c32a014bbfa901e6))

## [0.3.1](https://github.com/golusoris/sveltesentio/compare/uploads-v0.3.0...uploads-v0.3.1) (2026-10-13)

### Bug Fixes

- **deps:** update test tooling (major) ([#263](https://github.com/golusoris/sveltesentio/issues/263)) ([9b9faaa](https://github.com/golusoris/sveltesentio/commit/9b9faaae1e94a3fb2e0d1bb4e53a34edea926847))

## [0.3.0](https://github.com/golusoris/sveltesentio/compare/uploads-v0.2.0...uploads-v0.3.0) (2026-10-12)

### ⚠ BREAKING CHANGES

- **licence:** licence MIT -> EUPL-1.2. Releases from the next minor of each package on are EUPL-1.2, a copyleft licence; releases already published stay MIT.

### Features

- **governance:** declare HISS-20 enforcement evidence, backed by fixtures ([e803ea4](https://github.com/golusoris/sveltesentio/commit/e803ea401055b15ea7e9df5eeb0a4c37cf714963))
- **hiss-04:** enforce the function-length cap, with one recorded exception ([#273](https://github.com/golusoris/sveltesentio/issues/273)) ([30ecd8f](https://github.com/golusoris/sveltesentio/commit/30ecd8f4b071c79ebb7482ee456b76fab401d3c9))

### Bug Fixes

- **deps:** repair regressions introduced by the Praetor dependency pass ([f14552b](https://github.com/golusoris/sveltesentio/commit/f14552be15d1fe0c9e94ce4caecae098a8789106))
- **packages:** name the source repository and the licensor in every published package ([#299](https://github.com/golusoris/sveltesentio/issues/299)) ([830318a](https://github.com/golusoris/sveltesentio/commit/830318abf9f7339da63b4c7d357a0565b097b746))
- **types:** put test code under a TypeScript project, and fix the 32 errors ([1138831](https://github.com/golusoris/sveltesentio/commit/11388316e60e6f3fb738255750b2e5606a52d848))

### Code Refactoring

- **uploads,forms:** lift two helpers out of oversized factories ([6d940da](https://github.com/golusoris/sveltesentio/commit/6d940daccd375b21bebc44ec4291c4626cf3564d))
- **uploads:** separate how the tus upload is obtained from what it does ([#271](https://github.com/golusoris/sveltesentio/issues/271)) ([97c53a0](https://github.com/golusoris/sveltesentio/commit/97c53a0a1ad382300bb604a773c37eda5e8e63b0))

### Chores

- **licence:** relicense the project from mit to eupl-1.2 ([#286](https://github.com/golusoris/sveltesentio/issues/286)) ([c07c2ac](https://github.com/golusoris/sveltesentio/commit/c07c2aca14173e2d5bce783a531f47988dc307b0))

## [0.2.0](https://github.com/golusoris/sveltesentio/compare/uploads-v0.1.0...uploads-v0.2.0) (2026-06-15)

### Features

- **uploads:** createResumableUpload — tus-js-client wrapper (ADR-0041) ([c8b3ae0](https://github.com/golusoris/sveltesentio/commit/c8b3ae0039c2817447d77a35b835e2a0b72a2d64))
