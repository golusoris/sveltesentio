# Changelog

## [0.8.3](https://github.com/golusoris/sveltesentio/compare/ui-v0.8.2...ui-v0.8.3) (2026-10-25)

### Bug Fixes

- **lint:** lint the package tests with type information ([#463](https://github.com/golusoris/sveltesentio/issues/463)) ([4e654bb](https://github.com/golusoris/sveltesentio/commit/4e654bbe0a64b7e7127422d3c899d1532ca6a4fa))

## [0.8.2](https://github.com/golusoris/sveltesentio/compare/ui-v0.8.1...ui-v0.8.2) (2026-10-25)

### Bug Fixes

- **ci:** stop the macOS portability tests from crossing the 5 s timeout ([#429](https://github.com/golusoris/sveltesentio/issues/429)) ([a71ae3a](https://github.com/golusoris/sveltesentio/commit/a71ae3a77a0233e39996abcbe375700434bc6914))
- **ui:** drop an empty URI attribute in renderMarkdown ([#459](https://github.com/golusoris/sveltesentio/issues/459)) ([5d3452b](https://github.com/golusoris/sveltesentio/commit/5d3452bdf5824d2e88c66130c9dfd0e15e78fe54))

### Code Refactoring

- **test:** share one axe helper and fold ai test setup ([#437](https://github.com/golusoris/sveltesentio/issues/437)) ([64455d3](https://github.com/golusoris/sveltesentio/commit/64455d375441d7ae10a2af94098925c2afa52b6e))
- use svelte's shipped rune types and share the Anthropic request ([#431](https://github.com/golusoris/sveltesentio/issues/431)) ([8f47b77](https://github.com/golusoris/sveltesentio/commit/8f47b777488d665a867454a13d612a8c950a56d6))

## [0.8.1](https://github.com/golusoris/sveltesentio/compare/ui-v0.8.0...ui-v0.8.1) (2026-10-19)

### Bug Fixes

- **ui:** report a failed icon loader and deprecate the dynamic loader ([#415](https://github.com/golusoris/sveltesentio/issues/415)) ([99a38c3](https://github.com/golusoris/sveltesentio/commit/99a38c3bb076984b0fc66fbc550c7e0c2271cdd2))

## [0.8.0](https://github.com/golusoris/sveltesentio/compare/ui-v0.7.0...ui-v0.8.0) (2026-10-19)

### Features

- **ui:** add the presetSnatchArr colour palette with a contrast check ([#412](https://github.com/golusoris/sveltesentio/issues/412)) ([f265396](https://github.com/golusoris/sveltesentio/commit/f265396f298c4b48f51455b2e4dc33e23254e8fc))

## [0.7.0](https://github.com/golusoris/sveltesentio/compare/ui-v0.6.1...ui-v0.7.0) (2026-10-14)

### ⚠ BREAKING CHANGES

- every @sveltesentio/* package that declares a svelte peer requires svelte 5.56.4 or later, and every package that declares a kit peer requires @sveltejs/kit 2.53.0 or later. Package managers that enforce peers refuse or warn on installs below these versions.
- every @sveltesentio/* package declares the peer dependency typescript ">=5.5 <7". Package managers that enforce peers refuse or warn on installs with TypeScript below 5.5 or at 7 and above.
- every @sveltesentio/* package declares engines.node >=24. Package managers that enforce engines refuse installs on Node 22.

### Bug Fixes

- declare the measured svelte and SvelteKit peer floors ([#351](https://github.com/golusoris/sveltesentio/issues/351)) ([608a52b](https://github.com/golusoris/sveltesentio/commit/608a52bddd73388eed279f723ddf4bf77b3bb476))
- declare the Node 24 floor in every published package ([#348](https://github.com/golusoris/sveltesentio/issues/348)) ([6b02d54](https://github.com/golusoris/sveltesentio/commit/6b02d54cc07cf8d190084a154f611a9b17ec99d1))
- declare the TypeScript peer range in every published package ([#350](https://github.com/golusoris/sveltesentio/issues/350)) ([a416a1c](https://github.com/golusoris/sveltesentio/commit/a416a1c68671f0304799d7f4c32a014bbfa901e6))

## [0.6.1](https://github.com/golusoris/sveltesentio/compare/ui-v0.6.0...ui-v0.6.1) (2026-10-13)

### Bug Fixes

- **deps:** update test tooling (major) ([#263](https://github.com/golusoris/sveltesentio/issues/263)) ([9b9faaa](https://github.com/golusoris/sveltesentio/commit/9b9faaae1e94a3fb2e0d1bb4e53a34edea926847))
- type-check every .svelte file under packages/ with svelte-check ([#316](https://github.com/golusoris/sveltesentio/issues/316)) ([0c394b7](https://github.com/golusoris/sveltesentio/commit/0c394b7bddd23bc47bceb0c7438963a48e17fd19))

## [0.6.0](https://github.com/golusoris/sveltesentio/compare/ui-v0.5.0...ui-v0.6.0) (2026-10-12)

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
- **ui:** split capital runs in icon names in linear time ([#284](https://github.com/golusoris/sveltesentio/issues/284)) ([4607a0d](https://github.com/golusoris/sveltesentio/commit/4607a0d5b1ddfa2c833383bd037d8d6a8fe0c657))

### Chores

- **licence:** relicense the project from mit to eupl-1.2 ([#286](https://github.com/golusoris/sveltesentio/issues/286)) ([c07c2ac](https://github.com/golusoris/sveltesentio/commit/c07c2aca14173e2d5bce783a531f47988dc307b0))

## [0.5.0](https://github.com/golusoris/sveltesentio/compare/ui-v0.4.0...ui-v0.5.0) (2026-06-19)

### Features

- **ui:** base components (Button/Input/Dialog) + theming (ThemeToggle/Customizer/font-preset) ([8bae1a4](https://github.com/golusoris/sveltesentio/commit/8bae1a4dc2820d524777fcde475694e9c3ef8a74))

## [0.4.0](https://github.com/golusoris/sveltesentio/compare/ui-v0.3.0...ui-v0.4.0) (2026-06-15)

### Features

- **ui:** add ./markdown (DOMPurify XSS sink) + ./icons (pluggable) — ADR-0026, ADR-0002 ([088e360](https://github.com/golusoris/sveltesentio/commit/088e3608131c79a20fcc12566549194578001cfa))

## [0.3.0](https://github.com/golusoris/sveltesentio/compare/ui-v0.2.0...ui-v0.3.0) (2026-06-15)

### Features

- **ui:** toast preset + headless DataTable/virtual + command registry wrappers ([42a7a3f](https://github.com/golusoris/sveltesentio/commit/42a7a3faab5c8568c6bd62d7f3676edfa9b8f06c))

## [0.1.0](https://github.com/golusoris/sveltesentio/compare/ui-v0.0.2...ui-v0.1.0) (2026-06-14)

### Features

- land foundation packages and repair CI gate ([#41](https://github.com/golusoris/sveltesentio/issues/41)) ([7557620](https://github.com/golusoris/sveltesentio/commit/75576200e324cd4c55f48571a6532540c1f6eb16))

### Bug Fixes

- **ui,ai:** resolve export maps — land ui oklch tokens + presets, drop ai ./edge ([d51d81e](https://github.com/golusoris/sveltesentio/commit/d51d81ef07f5b8afe952e7d9e85fb27be51dfe5c))
