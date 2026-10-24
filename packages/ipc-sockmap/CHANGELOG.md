# Changelog

## [0.4.1](https://github.com/golusoris/sveltesentio/compare/ipc-sockmap-v0.4.0...ipc-sockmap-v0.4.1) (2026-10-24)

### Code Refactoring

- **test:** share one node Vitest config across ten packages ([#435](https://github.com/golusoris/sveltesentio/issues/435)) ([dafbf95](https://github.com/golusoris/sveltesentio/commit/dafbf95b0007e93cae98cf02d2a01337df033590))

## [0.4.0](https://github.com/golusoris/sveltesentio/compare/ipc-sockmap-v0.3.1...ipc-sockmap-v0.4.0) (2026-10-14)

### ⚠ BREAKING CHANGES

- every @sveltesentio/* package declares the peer dependency typescript ">=5.5 <7". Package managers that enforce peers refuse or warn on installs with TypeScript below 5.5 or at 7 and above.

### Bug Fixes

- declare the TypeScript peer range in every published package ([#350](https://github.com/golusoris/sveltesentio/issues/350)) ([a416a1c](https://github.com/golusoris/sveltesentio/commit/a416a1c68671f0304799d7f4c32a014bbfa901e6))

## [0.3.1](https://github.com/golusoris/sveltesentio/compare/ipc-sockmap-v0.3.0...ipc-sockmap-v0.3.1) (2026-10-13)

### Bug Fixes

- **deps:** update test tooling (major) ([#263](https://github.com/golusoris/sveltesentio/issues/263)) ([9b9faaa](https://github.com/golusoris/sveltesentio/commit/9b9faaae1e94a3fb2e0d1bb4e53a34edea926847))

## [0.3.0](https://github.com/golusoris/sveltesentio/compare/ipc-sockmap-v0.2.0...ipc-sockmap-v0.3.0) (2026-10-12)

### ⚠ BREAKING CHANGES

- **licence:** licence MIT -> EUPL-1.2. Releases from the next minor of each package on are EUPL-1.2, a copyleft licence; releases already published stay MIT.

### Bug Fixes

- **deps:** repair regressions introduced by the Praetor dependency pass ([f14552b](https://github.com/golusoris/sveltesentio/commit/f14552be15d1fe0c9e94ce4caecae098a8789106))
- **hiss-04:** enforce the complexity bound and clear the 13 functions over it ([a4f37c0](https://github.com/golusoris/sveltesentio/commit/a4f37c085b657df92bac451ed04a08b84bfe89c3))
- **packages:** name the source repository and the licensor in every published package ([#299](https://github.com/golusoris/sveltesentio/issues/299)) ([830318a](https://github.com/golusoris/sveltesentio/commit/830318abf9f7339da63b4c7d357a0565b097b746))
- **types,lint:** align the two stragglers, and correct a comment that was wrong ([#268](https://github.com/golusoris/sveltesentio/issues/268)) ([7cd9814](https://github.com/golusoris/sveltesentio/commit/7cd98141eaf85b9ca8e2ed10a4123959c661b1e1))

### Code Refactoring

- **ipc-sockmap:** give the in-flight request queue its own module ([#270](https://github.com/golusoris/sveltesentio/issues/270)) ([588887d](https://github.com/golusoris/sveltesentio/commit/588887d280bcc573663aa8a4d87cb4ff93a4200c))
- **realtime:** extract the two things both transports were doing twice ([#269](https://github.com/golusoris/sveltesentio/issues/269)) ([5202779](https://github.com/golusoris/sveltesentio/commit/52027798c220c6d6a822f0064d235ccfc60308d0))

### Chores

- **licence:** relicense the project from mit to eupl-1.2 ([#286](https://github.com/golusoris/sveltesentio/issues/286)) ([c07c2ac](https://github.com/golusoris/sveltesentio/commit/c07c2aca14173e2d5bce783a531f47988dc307b0))

## [0.2.0](https://github.com/golusoris/sveltesentio/compare/ipc-sockmap-v0.1.0...ipc-sockmap-v0.2.0) (2026-06-20)

### Features

- **ipc-sockmap:** Tier-3 eBPF sockmap observe/handoff client ([29c25a4](https://github.com/golusoris/sveltesentio/commit/29c25a444cad5b0d1dbe0305859861b257756557))

## Changelog
