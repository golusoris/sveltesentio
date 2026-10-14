# Changelog

## [0.3.0](https://github.com/golusoris/sveltesentio/compare/testing-v0.2.1...testing-v0.3.0) (2026-10-14)

### ⚠ BREAKING CHANGES

- every @sveltesentio/* package declares the peer dependency typescript ">=5.5 <7". Package managers that enforce peers refuse or warn on installs with TypeScript below 5.5 or at 7 and above.
- every @sveltesentio/* package declares engines.node >=24. Package managers that enforce engines refuse installs on Node 22.

### Bug Fixes

- declare the Node 24 floor in every published package ([#348](https://github.com/golusoris/sveltesentio/issues/348)) ([6b02d54](https://github.com/golusoris/sveltesentio/commit/6b02d54cc07cf8d190084a154f611a9b17ec99d1))
- declare the TypeScript peer range in every published package ([#350](https://github.com/golusoris/sveltesentio/issues/350)) ([a416a1c](https://github.com/golusoris/sveltesentio/commit/a416a1c68671f0304799d7f4c32a014bbfa901e6))

## [0.2.1](https://github.com/golusoris/sveltesentio/compare/testing-v0.2.0...testing-v0.2.1) (2026-10-13)

### Bug Fixes

- **ci:** run the packages that read a changed docs file instead of skipping them ([#309](https://github.com/golusoris/sveltesentio/issues/309)) ([27bbf93](https://github.com/golusoris/sveltesentio/commit/27bbf934a04c1c02b595374e8c28e6dfb525838d))
- **deps:** update test tooling (major) ([#263](https://github.com/golusoris/sveltesentio/issues/263)) ([9b9faaa](https://github.com/golusoris/sveltesentio/commit/9b9faaae1e94a3fb2e0d1bb4e53a34edea926847))

## [0.2.0](https://github.com/golusoris/sveltesentio/compare/testing-v0.1.0...testing-v0.2.0) (2026-10-12)

### ⚠ BREAKING CHANGES

- **licence:** licence MIT -> EUPL-1.2. Releases from the next minor of each package on are EUPL-1.2, a copyleft licence; releases already published stay MIT.

### Features

- **ci:** fail a pull request that changes what a package publishes without its README ([#254](https://github.com/golusoris/sveltesentio/issues/254)) ([631b89e](https://github.com/golusoris/sveltesentio/commit/631b89e7b67b9e44f045b114cd8cff227c34d201))
- **governance:** declare HISS-20 enforcement evidence, backed by fixtures ([e803ea4](https://github.com/golusoris/sveltesentio/commit/e803ea401055b15ea7e9df5eeb0a4c37cf714963))

### Bug Fixes

- **ci:** lint scripts/, key the turbo cache on root configs, and stop ci-affected running on import ([#253](https://github.com/golusoris/sveltesentio/issues/253)) ([c03f4d8](https://github.com/golusoris/sveltesentio/commit/c03f4d82639e5e281bf525789e788b2af6489d54))
- **deps:** repair regressions introduced by the Praetor dependency pass ([f14552b](https://github.com/golusoris/sveltesentio/commit/f14552be15d1fe0c9e94ce4caecae098a8789106))
- **hiss-04:** enforce the complexity bound and clear the 13 functions over it ([a4f37c0](https://github.com/golusoris/sveltesentio/commit/a4f37c085b657df92bac451ed04a08b84bfe89c3))
- make every story pass axe in a browser and gate stories and end-to-end tests in ci ([#290](https://github.com/golusoris/sveltesentio/issues/290)) ([88c98d3](https://github.com/golusoris/sveltesentio/commit/88c98d394a59b14c4c44ce18ade88a82bfe44c2e))
- **packages:** name the source repository and the licensor in every published package ([#299](https://github.com/golusoris/sveltesentio/issues/299)) ([830318a](https://github.com/golusoris/sveltesentio/commit/830318abf9f7339da63b4c7d357a0565b097b746))
- **types:** put test code under a TypeScript project, and fix the 32 errors ([1138831](https://github.com/golusoris/sveltesentio/commit/11388316e60e6f3fb738255750b2e5606a52d848))

### Chores

- **licence:** relicense the project from mit to eupl-1.2 ([#286](https://github.com/golusoris/sveltesentio/issues/286)) ([c07c2ac](https://github.com/golusoris/sveltesentio/commit/c07c2aca14173e2d5bce783a531f47988dc307b0))

## 0.1.0

Initial release.
