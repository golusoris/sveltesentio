# Changelog

## [0.4.0](https://github.com/golusoris/sveltesentio/compare/core-v0.3.0...core-v0.4.0) (2026-09-16)


### Features

* **governance:** declare HISS-20 enforcement evidence, backed by fixtures ([e803ea4](https://github.com/golusoris/sveltesentio/commit/e803ea401055b15ea7e9df5eeb0a4c37cf714963))
* **hiss-01:** forbid recursion, and fix the one place that used it ([#267](https://github.com/golusoris/sveltesentio/issues/267)) ([a811b6d](https://github.com/golusoris/sveltesentio/commit/a811b6dd3ea9dd7953d007621354ba81b33d115f))


### Bug Fixes

* **deps:** repair regressions introduced by the Praetor dependency pass ([f14552b](https://github.com/golusoris/sveltesentio/commit/f14552be15d1fe0c9e94ce4caecae098a8789106))
* **hiss-07,hiss-08:** close the gaps the coverage catalog named ([231ccea](https://github.com/golusoris/sveltesentio/commit/231cceaacaa6d9597adb3dfd11a5644c1de6fe21))
* **hiss-08:** resolve one hop through a const, closing the gap both ways ([#274](https://github.com/golusoris/sveltesentio/issues/274)) ([a259c30](https://github.com/golusoris/sveltesentio/commit/a259c30534dd9a640b93b3c1bb04e194ffff90c4))
* **hiss:** close two enforcement gaps — dynamic-import cycles and bracket-notation HTML sinks ([#264](https://github.com/golusoris/sveltesentio/issues/264)) ([0f40bae](https://github.com/golusoris/sveltesentio/commit/0f40baecfd67135a0553b445cab30206d3b0ddc1))
* **types:** put test code under a TypeScript project, and fix the 32 errors ([1138831](https://github.com/golusoris/sveltesentio/commit/11388316e60e6f3fb738255750b2e5606a52d848))


### Code Refactoring

* clear two more length violations and dedupe the history trim ([20a0b36](https://github.com/golusoris/sveltesentio/commit/20a0b36ad33ad25b43969ae09b0249f6c85f6f6c))

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
