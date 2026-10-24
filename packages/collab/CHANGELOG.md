# Changelog

## [0.6.1](https://github.com/golusoris/sveltesentio/compare/collab-v0.6.0...collab-v0.6.1) (2026-10-24)

### Code Refactoring

- **test:** share one node Vitest config across ten packages ([#435](https://github.com/golusoris/sveltesentio/issues/435)) ([dafbf95](https://github.com/golusoris/sveltesentio/commit/dafbf95b0007e93cae98cf02d2a01337df033590))
- use svelte's shipped rune types and share the Anthropic request ([#431](https://github.com/golusoris/sveltesentio/issues/431)) ([8f47b77](https://github.com/golusoris/sveltesentio/commit/8f47b777488d665a867454a13d612a8c950a56d6))

## [0.6.0](https://github.com/golusoris/sveltesentio/compare/collab-v0.5.1...collab-v0.6.0) (2026-10-14)

### ⚠ BREAKING CHANGES

- every @sveltesentio/* package that declares a svelte peer requires svelte 5.56.4 or later, and every package that declares a kit peer requires @sveltejs/kit 2.53.0 or later. Package managers that enforce peers refuse or warn on installs below these versions.
- every @sveltesentio/* package declares the peer dependency typescript ">=5.5 <7". Package managers that enforce peers refuse or warn on installs with TypeScript below 5.5 or at 7 and above.
- every @sveltesentio/* package declares engines.node >=24. Package managers that enforce engines refuse installs on Node 22.

### Bug Fixes

- declare the measured svelte and SvelteKit peer floors ([#351](https://github.com/golusoris/sveltesentio/issues/351)) ([608a52b](https://github.com/golusoris/sveltesentio/commit/608a52bddd73388eed279f723ddf4bf77b3bb476))
- declare the Node 24 floor in every published package ([#348](https://github.com/golusoris/sveltesentio/issues/348)) ([6b02d54](https://github.com/golusoris/sveltesentio/commit/6b02d54cc07cf8d190084a154f611a9b17ec99d1))
- declare the TypeScript peer range in every published package ([#350](https://github.com/golusoris/sveltesentio/issues/350)) ([a416a1c](https://github.com/golusoris/sveltesentio/commit/a416a1c68671f0304799d7f4c32a014bbfa901e6))

## [0.5.1](https://github.com/golusoris/sveltesentio/compare/collab-v0.5.0...collab-v0.5.1) (2026-10-13)

### Bug Fixes

- **deps:** update test tooling (major) ([#263](https://github.com/golusoris/sveltesentio/issues/263)) ([9b9faaa](https://github.com/golusoris/sveltesentio/commit/9b9faaae1e94a3fb2e0d1bb4e53a34edea926847))
- type-check every .svelte file under packages/ with svelte-check ([#316](https://github.com/golusoris/sveltesentio/issues/316)) ([0c394b7](https://github.com/golusoris/sveltesentio/commit/0c394b7bddd23bc47bceb0c7438963a48e17fd19))

## [0.5.0](https://github.com/golusoris/sveltesentio/compare/collab-v0.4.0...collab-v0.5.0) (2026-10-12)

### ⚠ BREAKING CHANGES

- **licence:** licence MIT -> EUPL-1.2. Releases from the next minor of each package on are EUPL-1.2, a copyleft licence; releases already published stay MIT.

### Features

- **governance:** declare HISS-20 enforcement evidence, backed by fixtures ([e803ea4](https://github.com/golusoris/sveltesentio/commit/e803ea401055b15ea7e9df5eeb0a4c37cf714963))

### Bug Fixes

- **deps:** repair regressions introduced by the Praetor dependency pass ([f14552b](https://github.com/golusoris/sveltesentio/commit/f14552be15d1fe0c9e94ce4caecae098a8789106))
- **hiss-04:** enforce the complexity bound and clear the 13 functions over it ([a4f37c0](https://github.com/golusoris/sveltesentio/commit/a4f37c085b657df92bac451ed04a08b84bfe89c3))
- **packages:** name the source repository and the licensor in every published package ([#299](https://github.com/golusoris/sveltesentio/issues/299)) ([830318a](https://github.com/golusoris/sveltesentio/commit/830318abf9f7339da63b4c7d357a0565b097b746))
- **types:** put test code under a TypeScript project, and fix the 32 errors ([1138831](https://github.com/golusoris/sveltesentio/commit/11388316e60e6f3fb738255750b2e5606a52d848))

### Chores

- **licence:** relicense the project from mit to eupl-1.2 ([#286](https://github.com/golusoris/sveltesentio/issues/286)) ([c07c2ac](https://github.com/golusoris/sveltesentio/commit/c07c2aca14173e2d5bce783a531f47988dc307b0))

## [0.4.0](https://github.com/golusoris/sveltesentio/compare/collab-v0.3.0...collab-v0.4.0) (2026-06-19)

### Features

- **collab:** provider auth-header binding + two-doc convergence tests (ADR-0039) ([3778bb6](https://github.com/golusoris/sveltesentio/commit/3778bb638c9b2d8cc24bdf917f9471c4d3b41be3))

## [0.3.0](https://github.com/golusoris/sveltesentio/compare/collab-v0.2.0...collab-v0.3.0) (2026-06-15)

### Features

- **collab:** awareness/presence helpers + reactive presence store ([3f80883](https://github.com/golusoris/sveltesentio/commit/3f808834ed4e554fb67757fe7388fb7802a43df8))
