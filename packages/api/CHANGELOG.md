# Changelog

## [0.6.1](https://github.com/golusoris/sveltesentio/compare/api-v0.6.0...api-v0.6.1) (2026-10-25)


### Code Refactoring

* **test:** share one node Vitest config across ten packages ([#435](https://github.com/golusoris/sveltesentio/issues/435)) ([dafbf95](https://github.com/golusoris/sveltesentio/commit/dafbf95b0007e93cae98cf02d2a01337df033590))

## [0.6.0](https://github.com/golusoris/sveltesentio/compare/api-v0.5.0...api-v0.6.0) (2026-10-14)

### ⚠ BREAKING CHANGES

- every @sveltesentio/* package declares the peer dependency typescript ">=5.5 <7". Package managers that enforce peers refuse or warn on installs with TypeScript below 5.5 or at 7 and above.
- every @sveltesentio/* package declares engines.node >=24. Package managers that enforce engines refuse installs on Node 22.

### Bug Fixes

- declare the Node 24 floor in every published package ([#348](https://github.com/golusoris/sveltesentio/issues/348)) ([6b02d54](https://github.com/golusoris/sveltesentio/commit/6b02d54cc07cf8d190084a154f611a9b17ec99d1))
- declare the TypeScript peer range in every published package ([#350](https://github.com/golusoris/sveltesentio/issues/350)) ([a416a1c](https://github.com/golusoris/sveltesentio/commit/a416a1c68671f0304799d7f4c32a014bbfa901e6))

## [0.5.0](https://github.com/golusoris/sveltesentio/compare/api-v0.4.1...api-v0.5.0) (2026-10-14)

### ⚠ BREAKING CHANGES

- **api:** @sveltesentio/api no longer installs the sveltesentio-codegen command.

### Bug Fixes

- **api:** remove the sveltesentio-codegen bin ([#335](https://github.com/golusoris/sveltesentio/issues/335)) ([9ddb698](https://github.com/golusoris/sveltesentio/commit/9ddb69896596f141caaee8956aaf3b92cda2bb80))

## [0.4.1](https://github.com/golusoris/sveltesentio/compare/api-v0.4.0...api-v0.4.1) (2026-10-13)

### Bug Fixes

- **deps:** update test tooling (major) ([#263](https://github.com/golusoris/sveltesentio/issues/263)) ([9b9faaa](https://github.com/golusoris/sveltesentio/commit/9b9faaae1e94a3fb2e0d1bb4e53a34edea926847))

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
