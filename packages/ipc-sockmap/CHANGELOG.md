# Changelog

## [0.2.1](https://github.com/golusoris/sveltesentio/compare/ipc-sockmap-v0.2.0...ipc-sockmap-v0.2.1) (2026-09-16)


### Bug Fixes

* **deps:** repair regressions introduced by the Praetor dependency pass ([f14552b](https://github.com/golusoris/sveltesentio/commit/f14552be15d1fe0c9e94ce4caecae098a8789106))
* **hiss-04:** enforce the complexity bound and clear the 13 functions over it ([a4f37c0](https://github.com/golusoris/sveltesentio/commit/a4f37c085b657df92bac451ed04a08b84bfe89c3))
* **types,lint:** align the two stragglers, and correct a comment that was wrong ([#268](https://github.com/golusoris/sveltesentio/issues/268)) ([7cd9814](https://github.com/golusoris/sveltesentio/commit/7cd98141eaf85b9ca8e2ed10a4123959c661b1e1))


### Code Refactoring

* **ipc-sockmap:** give the in-flight request queue its own module ([#270](https://github.com/golusoris/sveltesentio/issues/270)) ([588887d](https://github.com/golusoris/sveltesentio/commit/588887d280bcc573663aa8a4d87cb4ff93a4200c))
* **realtime:** extract the two things both transports were doing twice ([#269](https://github.com/golusoris/sveltesentio/issues/269)) ([5202779](https://github.com/golusoris/sveltesentio/commit/52027798c220c6d6a822f0064d235ccfc60308d0))

## [0.2.0](https://github.com/golusoris/sveltesentio/compare/ipc-sockmap-v0.1.0...ipc-sockmap-v0.2.0) (2026-06-20)

### Features

- **ipc-sockmap:** Tier-3 eBPF sockmap observe/handoff client ([29c25a4](https://github.com/golusoris/sveltesentio/commit/29c25a444cad5b0d1dbe0305859861b257756557))

## Changelog
