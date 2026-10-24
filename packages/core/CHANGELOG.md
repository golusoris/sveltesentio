# Changelog

## [0.6.1](https://github.com/golusoris/sveltesentio/compare/core-v0.6.0...core-v0.6.1) (2026-10-24)


### Code Refactoring

* **core:** fold repeated setup in the clock and vite tests ([#436](https://github.com/golusoris/sveltesentio/issues/436)) ([01f706d](https://github.com/golusoris/sveltesentio/commit/01f706daa6cc43079430844d7c4a7e2b49faa579))
* **test:** share one node Vitest config across ten packages ([#435](https://github.com/golusoris/sveltesentio/issues/435)) ([dafbf95](https://github.com/golusoris/sveltesentio/commit/dafbf95b0007e93cae98cf02d2a01337df033590))

## [0.6.0](https://github.com/golusoris/sveltesentio/compare/core-v0.5.0...core-v0.6.0) (2026-10-19)

### Features

- **scripts:** check that each package declares its imports ([#390](https://github.com/golusoris/sveltesentio/issues/390)) ([f3a607f](https://github.com/golusoris/sveltesentio/commit/f3a607f3eec555e70388efcfd1f90690c19dc9b0))

## [0.5.0](https://github.com/golusoris/sveltesentio/compare/core-v0.4.1...core-v0.5.0) (2026-10-14)

### ⚠ BREAKING CHANGES

- every @sveltesentio/* package that declares a kit peer requires @sveltejs/kit 2.70.2 or later, and @sveltesentio/core requires vite 8.0.16 or later. Package managers that enforce peers refuse or warn on installs below these versions.
- every @sveltesentio/* package that declares a svelte peer requires svelte 5.56.4 or later, and every package that declares a kit peer requires @sveltejs/kit 2.53.0 or later. Package managers that enforce peers refuse or warn on installs below these versions.
- every @sveltesentio/* package declares the peer dependency typescript ">=5.5 <7". Package managers that enforce peers refuse or warn on installs with TypeScript below 5.5 or at 7 and above.
- every @sveltesentio/* package declares engines.node >=24. Package managers that enforce engines refuse installs on Node 22.

### Bug Fixes

- declare the measured svelte and SvelteKit peer floors ([#351](https://github.com/golusoris/sveltesentio/issues/351)) ([608a52b](https://github.com/golusoris/sveltesentio/commit/608a52bddd73388eed279f723ddf4bf77b3bb476))
- declare the Node 24 floor in every published package ([#348](https://github.com/golusoris/sveltesentio/issues/348)) ([6b02d54](https://github.com/golusoris/sveltesentio/commit/6b02d54cc07cf8d190084a154f611a9b17ec99d1))
- declare the TypeScript peer range in every published package ([#350](https://github.com/golusoris/sveltesentio/issues/350)) ([a416a1c](https://github.com/golusoris/sveltesentio/commit/a416a1c68671f0304799d7f4c32a014bbfa901e6))
- raise the SvelteKit and vite peer floors past their advisories ([#353](https://github.com/golusoris/sveltesentio/issues/353)) ([fe2bbec](https://github.com/golusoris/sveltesentio/commit/fe2bbecda51f686df16a2f26ebcd4429c16a1310))

## [0.4.1](https://github.com/golusoris/sveltesentio/compare/core-v0.4.0...core-v0.4.1) (2026-10-13)

### Bug Fixes

- **deps:** update test tooling (major) ([#263](https://github.com/golusoris/sveltesentio/issues/263)) ([9b9faaa](https://github.com/golusoris/sveltesentio/commit/9b9faaae1e94a3fb2e0d1bb4e53a34edea926847))

## [0.4.0](https://github.com/golusoris/sveltesentio/compare/core-v0.3.0...core-v0.4.0) (2026-10-12)

### ⚠ BREAKING CHANGES

- **licence:** licence MIT -> EUPL-1.2. Releases from the next minor of each package on are EUPL-1.2, a copyleft licence; releases already published stay MIT.

### Features

- **governance:** declare HISS-20 enforcement evidence, backed by fixtures ([e803ea4](https://github.com/golusoris/sveltesentio/commit/e803ea401055b15ea7e9df5eeb0a4c37cf714963))
- **hiss-01:** forbid recursion, and fix the one place that used it ([#267](https://github.com/golusoris/sveltesentio/issues/267)) ([a811b6d](https://github.com/golusoris/sveltesentio/commit/a811b6dd3ea9dd7953d007621354ba81b33d115f))

### Bug Fixes

- **auth,core:** derive the hook type so the packages type-check on sveltekit 3 ([#287](https://github.com/golusoris/sveltesentio/issues/287)) ([169e54b](https://github.com/golusoris/sveltesentio/commit/169e54bfe3c783509a4f3a2954d1e9a30f78b9c1))
- **deps:** repair regressions introduced by the Praetor dependency pass ([f14552b](https://github.com/golusoris/sveltesentio/commit/f14552be15d1fe0c9e94ce4caecae098a8789106))
- **hiss-07,hiss-08:** close the gaps the coverage catalog named ([231ccea](https://github.com/golusoris/sveltesentio/commit/231cceaacaa6d9597adb3dfd11a5644c1de6fe21))
- **hiss-08:** resolve one hop through a const, closing the gap both ways ([#274](https://github.com/golusoris/sveltesentio/issues/274)) ([a259c30](https://github.com/golusoris/sveltesentio/commit/a259c30534dd9a640b93b3c1bb04e194ffff90c4))
- **hiss:** close two enforcement gaps — dynamic-import cycles and bracket-notation HTML sinks ([#264](https://github.com/golusoris/sveltesentio/issues/264)) ([0f40bae](https://github.com/golusoris/sveltesentio/commit/0f40baecfd67135a0553b445cab30206d3b0ddc1))
- make every story pass axe in a browser and gate stories and end-to-end tests in ci ([#290](https://github.com/golusoris/sveltesentio/issues/290)) ([88c98d3](https://github.com/golusoris/sveltesentio/commit/88c98d394a59b14c4c44ce18ade88a82bfe44c2e))
- **packages:** name the source repository and the licensor in every published package ([#299](https://github.com/golusoris/sveltesentio/issues/299)) ([830318a](https://github.com/golusoris/sveltesentio/commit/830318abf9f7339da63b4c7d357a0565b097b746))
- **types:** put test code under a TypeScript project, and fix the 32 errors ([1138831](https://github.com/golusoris/sveltesentio/commit/11388316e60e6f3fb738255750b2e5606a52d848))

### Code Refactoring

- clear two more length violations and dedupe the history trim ([20a0b36](https://github.com/golusoris/sveltesentio/commit/20a0b36ad33ad25b43969ae09b0249f6c85f6f6c))

### Chores

- **licence:** relicense the project from mit to eupl-1.2 ([#286](https://github.com/golusoris/sveltesentio/issues/286)) ([c07c2ac](https://github.com/golusoris/sveltesentio/commit/c07c2aca14173e2d5bce783a531f47988dc307b0))

## [0.3.0](https://github.com/golusoris/sveltesentio/compare/core-v0.2.1...core-v0.3.0) (2026-06-20)

### Features

- **core:** typed $sentio virtual-module config schema ([75e9f32](https://github.com/golusoris/sveltesentio/commit/75e9f32d378fe0d5457549cb793524317395a134))

## [0.2.1](https://github.com/golusoris/sveltesentio/compare/core-v0.2.0...core-v0.2.1) (2026-06-19)

### Bug Fixes

- **core:** restore eslint.config.ts + chart-a11y rule (prior commit's git add aborted) ([a978cf6](https://github.com/golusoris/sveltesentio/commit/a978cf6f4a362b1fb83eabdc426e6b04276607c3))

## [0.2.0](https://github.com/golusoris/sveltesentio/compare/core-v0.1.0...core-v0.2.0) (2026-06-19)

### Features

- **core:** no-direct-time ESLint rule + bundle-size gate in sentioPlugin ([f3e223b](https://github.com/golusoris/sveltesentio/commit/f3e223b24cafdfae9646315e9ab64ea0899fd297))

## [0.1.0](https://github.com/golusoris/sveltesentio/compare/core-v0.0.1...core-v0.1.0) (2026-06-14)

### Features

- land foundation packages and repair CI gate ([#41](https://github.com/golusoris/sveltesentio/issues/41)) ([7557620](https://github.com/golusoris/sveltesentio/commit/75576200e324cd4c55f48571a6532540c1f6eb16))
