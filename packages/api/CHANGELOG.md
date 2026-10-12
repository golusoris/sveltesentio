# Changelog

## [0.4.0](https://github.com/golusoris/sveltesentio/compare/api-v0.3.0...api-v0.4.0) (2026-10-12)

### ⚠ BREAKING CHANGES

- **licence:** licence MIT -> EUPL-1.2. Releases from the next minor of each package on are EUPL-1.2, a copyleft licence; releases already published stay MIT.

### Features

- **governance:** declare HISS-20 enforcement evidence, backed by fixtures ([e803ea4](https://github.com/golusoris/sveltesentio/commit/e803ea401055b15ea7e9df5eeb0a4c37cf714963))

### Bug Fixes

- **deps:** repair regressions introduced by the Praetor dependency pass ([f14552b](https://github.com/golusoris/sveltesentio/commit/f14552be15d1fe0c9e94ce4caecae098a8789106))
- **packages:** name the source repository and the licensor in every published package ([#299](https://github.com/golusoris/sveltesentio/issues/299)) ([830318a](https://github.com/golusoris/sveltesentio/commit/830318abf9f7339da63b4c7d357a0565b097b746))
- **types:** put test code under a TypeScript project, and fix the 32 errors ([1138831](https://github.com/golusoris/sveltesentio/commit/11388316e60e6f3fb738255750b2e5606a52d848))

### Chores

- **licence:** relicense the project from mit to eupl-1.2 ([#286](https://github.com/golusoris/sveltesentio/issues/286)) ([c07c2ac](https://github.com/golusoris/sveltesentio/commit/c07c2aca14173e2d5bce783a531f47988dc307b0))

## [0.3.0](https://github.com/golusoris/sveltesentio/compare/api-v0.2.0...api-v0.3.0) (2026-06-19)

### Features

- **api:** ./codegen (openapi-typescript wrapper) + ./auth-middleware (bearer + refresh-on-401) ([4d0cdee](https://github.com/golusoris/sveltesentio/commit/4d0cdee398144d717721e39e1f425529a2c561d4))

## [0.2.0](https://github.com/golusoris/sveltesentio/compare/api-v0.1.1...api-v0.2.0) (2026-06-15)

### Features

- **api:** typed openapi-fetch client with RFC 9457 problemMiddleware ([3100cc2](https://github.com/golusoris/sveltesentio/commit/3100cc2e199d85ba8e26d60791e953dd0abb0691))

### Bug Fixes

- **api:** match openapi-fetch Paths constraint so generated paths typecheck ([341fbc4](https://github.com/golusoris/sveltesentio/commit/341fbc4e9192487024776cbf8a16bd77490f67e3))
