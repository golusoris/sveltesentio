# Changelog

## [0.7.0](https://github.com/golusoris/sveltesentio/compare/auth-v0.6.0...auth-v0.7.0) (2026-10-12)

### ⚠ BREAKING CHANGES

- **licence:** licence MIT -> EUPL-1.2. Releases from the next minor of each package on are EUPL-1.2, a copyleft licence; releases already published stay MIT.

### Features

- **governance:** declare HISS-20 enforcement evidence, backed by fixtures ([e803ea4](https://github.com/golusoris/sveltesentio/commit/e803ea401055b15ea7e9df5eeb0a4c37cf714963))

### Bug Fixes

- **auth,core:** derive the hook type so the packages type-check on sveltekit 3 ([#287](https://github.com/golusoris/sveltesentio/issues/287)) ([169e54b](https://github.com/golusoris/sveltesentio/commit/169e54bfe3c783509a4f3a2954d1e9a30f78b9c1))
- **deps:** repair regressions introduced by the Praetor dependency pass ([f14552b](https://github.com/golusoris/sveltesentio/commit/f14552be15d1fe0c9e94ce4caecae098a8789106))
- **packages:** name the source repository and the licensor in every published package ([#299](https://github.com/golusoris/sveltesentio/issues/299)) ([830318a](https://github.com/golusoris/sveltesentio/commit/830318abf9f7339da63b4c7d357a0565b097b746))
- **security:** remove three polynomial-backtracking regexes ([#266](https://github.com/golusoris/sveltesentio/issues/266)) ([345c16e](https://github.com/golusoris/sveltesentio/commit/345c16ec5b8436f9e397b1382ae83ccd1140f6b2))
- **types:** put test code under a TypeScript project, and fix the 32 errors ([1138831](https://github.com/golusoris/sveltesentio/commit/11388316e60e6f3fb738255750b2e5606a52d848))

### Chores

- **licence:** relicense the project from mit to eupl-1.2 ([#286](https://github.com/golusoris/sveltesentio/issues/286)) ([c07c2ac](https://github.com/golusoris/sveltesentio/commit/c07c2aca14173e2d5bce783a531f47988dc307b0))

## [0.6.0](https://github.com/golusoris/sveltesentio/compare/auth-v0.5.0...auth-v0.6.0) (2026-06-15)

### Features

- **auth:** handleSession hook — cookie→locals session resolution (ADR-0034) ([74febcc](https://github.com/golusoris/sveltesentio/commit/74febccc1dad867da53b73cf63c2ebeba2303e42))

## [0.5.0](https://github.com/golusoris/sveltesentio/compare/auth-v0.4.0...auth-v0.5.0) (2026-06-15)

### Features

- **auth:** MfaChallenge + MfaEnroll components + mfa-view helper ([11df63a](https://github.com/golusoris/sveltesentio/commit/11df63aaa3bf3611f31759000f214fb45a0abd54))
- **auth:** OIDC orchestration, handleCsrf hook, passkey wrappers, typed auth errors ([bf20222](https://github.com/golusoris/sveltesentio/commit/bf2022286e9bfef9f137e1f3e55cc8e01dc83414))
- **auth:** usePermissions() rune over createPermissions ([f8dba03](https://github.com/golusoris/sveltesentio/commit/f8dba03bba28d7a187cea20a3a01d490644d47bb))

## [0.1.0](https://github.com/golusoris/sveltesentio/compare/auth-v0.0.1...auth-v0.1.0) (2026-06-14)

### Features

- land foundation packages and repair CI gate ([#41](https://github.com/golusoris/sveltesentio/issues/41)) ([7557620](https://github.com/golusoris/sveltesentio/commit/75576200e324cd4c55f48571a6532540c1f6eb16))
