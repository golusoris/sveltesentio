# Changelog

## [0.6.0](https://github.com/golusoris/sveltesentio/compare/forms-v0.5.1...forms-v0.6.0) (2026-10-25)


### ⚠ BREAKING CHANGES

* the @sveltejs/kit peer range of ai, auth, core, forms, i18n, query, realtime and shell is now ^3.0.0; SvelteKit 2 is no longer supported. Migration: change "@sveltejs/kit": "^2.70.2" to "@sveltejs/kit": "^3.0.0" in package.json, run `npx sv migrate sveltekit-3`, then follow the upstream guide <https://svelte.dev/docs/kit/migrating-to-sveltekit-3> for the steps the tool does not automate. sveltesentio hook exports need no code change. See docs/migrations/kit-2-to-3.md and ADR-0058.

### Features

* require SvelteKit 3 in the @sveltejs/kit peer range ([8ec6ab5](https://github.com/golusoris/sveltesentio/commit/8ec6ab56812c2f63d4148cc34b154ef92d0e3408))


### Bug Fixes

* **lint:** lint the package tests with type information ([#463](https://github.com/golusoris/sveltesentio/issues/463)) ([4e654bb](https://github.com/golusoris/sveltesentio/commit/4e654bbe0a64b7e7127422d3c899d1532ca6a4fa))

## [0.5.1](https://github.com/golusoris/sveltesentio/compare/forms-v0.5.0...forms-v0.5.1) (2026-10-25)

### Code Refactoring

- use svelte's shipped rune types and share the Anthropic request ([#431](https://github.com/golusoris/sveltesentio/issues/431)) ([8f47b77](https://github.com/golusoris/sveltesentio/commit/8f47b777488d665a867454a13d612a8c950a56d6))

## [0.5.0](https://github.com/golusoris/sveltesentio/compare/forms-v0.4.1...forms-v0.5.0) (2026-10-14)

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

## [0.4.1](https://github.com/golusoris/sveltesentio/compare/forms-v0.4.0...forms-v0.4.1) (2026-10-13)

### Bug Fixes

- **deps:** update test tooling (major) ([#263](https://github.com/golusoris/sveltesentio/issues/263)) ([9b9faaa](https://github.com/golusoris/sveltesentio/commit/9b9faaae1e94a3fb2e0d1bb4e53a34edea926847))
- type-check every .svelte file under packages/ with svelte-check ([#316](https://github.com/golusoris/sveltesentio/issues/316)) ([0c394b7](https://github.com/golusoris/sveltesentio/commit/0c394b7bddd23bc47bceb0c7438963a48e17fd19))

## [0.4.0](https://github.com/golusoris/sveltesentio/compare/forms-v0.3.0...forms-v0.4.0) (2026-10-12)

### ⚠ BREAKING CHANGES

- **licence:** licence MIT -> EUPL-1.2. Releases from the next minor of each package on are EUPL-1.2, a copyleft licence; releases already published stay MIT.

### Features

- **governance:** declare HISS-20 enforcement evidence, backed by fixtures ([e803ea4](https://github.com/golusoris/sveltesentio/commit/e803ea401055b15ea7e9df5eeb0a4c37cf714963))

### Bug Fixes

- **deps:** repair regressions introduced by the Praetor dependency pass ([f14552b](https://github.com/golusoris/sveltesentio/commit/f14552be15d1fe0c9e94ce4caecae098a8789106))
- **packages:** name the source repository and the licensor in every published package ([#299](https://github.com/golusoris/sveltesentio/issues/299)) ([830318a](https://github.com/golusoris/sveltesentio/commit/830318abf9f7339da63b4c7d357a0565b097b746))
- **types:** put test code under a TypeScript project, and fix the 32 errors ([1138831](https://github.com/golusoris/sveltesentio/commit/11388316e60e6f3fb738255750b2e5606a52d848))

### Code Refactoring

- **forms:** mirror a store into a rune once, not nine times ([#272](https://github.com/golusoris/sveltesentio/issues/272)) ([1d80b2b](https://github.com/golusoris/sveltesentio/commit/1d80b2b9937784d3956d154b93160f1e03c2e893))
- **uploads,forms:** lift two helpers out of oversized factories ([6d940da](https://github.com/golusoris/sveltesentio/commit/6d940daccd375b21bebc44ec4291c4626cf3564d))

### Chores

- **licence:** relicense the project from mit to eupl-1.2 ([#286](https://github.com/golusoris/sveltesentio/issues/286)) ([c07c2ac](https://github.com/golusoris/sveltesentio/commit/c07c2aca14173e2d5bce783a531f47988dc307b0))

## [0.3.0](https://github.com/golusoris/sveltesentio/compare/forms-v0.2.0...forms-v0.3.0) (2026-06-19)

### Features

- **forms:** ./use-form — runes-native sugar over superForm (ADR-0003) ([5c05293](https://github.com/golusoris/sveltesentio/commit/5c05293b25b7412acd224375c3f933039b618db5))

## [0.1.0](https://github.com/golusoris/sveltesentio/compare/forms-v0.0.1...forms-v0.1.0) (2026-06-14)

### Features

- land foundation packages and repair CI gate ([#41](https://github.com/golusoris/sveltesentio/issues/41)) ([7557620](https://github.com/golusoris/sveltesentio/commit/75576200e324cd4c55f48571a6532540c1f6eb16))
