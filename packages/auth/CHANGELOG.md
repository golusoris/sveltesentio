# Changelog

## [0.9.1](https://github.com/golusoris/sveltesentio/compare/auth-v0.9.0...auth-v0.9.1) (2026-10-24)

### Code Refactoring

- **test:** share one axe helper and fold ai test setup ([#437](https://github.com/golusoris/sveltesentio/issues/437)) ([64455d3](https://github.com/golusoris/sveltesentio/commit/64455d375441d7ae10a2af94098925c2afa52b6e))
- use svelte's shipped rune types and share the Anthropic request ([#431](https://github.com/golusoris/sveltesentio/issues/431)) ([8f47b77](https://github.com/golusoris/sveltesentio/commit/8f47b777488d665a867454a13d612a8c950a56d6))

## [0.9.0](https://github.com/golusoris/sveltesentio/compare/auth-v0.8.0...auth-v0.9.0) (2026-10-19)

### ⚠ BREAKING CHANGES

- **auth:** a plain-http tokenEndpoint is refused without a request, and a redirect from the token endpoint is no longer followed (oauth4webapi sends with redirect: manual), so it surfaces as a ProblemError.
- **auth:** a token response that carries an id_token is rejected unless issuer and jwksUri are passed, plus nonce for the authorization_code grant. Pass them from the authorization request and the provider metadata.

### Features

- **auth:** validate the OIDC id_token with oauth4webapi ([#384](https://github.com/golusoris/sveltesentio/issues/384)) ([86b991a](https://github.com/golusoris/sveltesentio/commit/86b991aed6a5cff6840f80687bd470ed444ba93c))

### Code Refactoring

- **auth:** send the token request with oauth4webapi ([#391](https://github.com/golusoris/sveltesentio/issues/391)) ([dcd4c7c](https://github.com/golusoris/sveltesentio/commit/dcd4c7c0bab9141e046a27bcdc225ca2a122f45b))

## [0.8.0](https://github.com/golusoris/sveltesentio/compare/auth-v0.7.1...auth-v0.8.0) (2026-10-14)

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

## [0.7.1](https://github.com/golusoris/sveltesentio/compare/auth-v0.7.0...auth-v0.7.1) (2026-10-13)

### Bug Fixes

- **deps:** update test tooling (major) ([#263](https://github.com/golusoris/sveltesentio/issues/263)) ([9b9faaa](https://github.com/golusoris/sveltesentio/commit/9b9faaae1e94a3fb2e0d1bb4e53a34edea926847))
- type-check every .svelte file under packages/ with svelte-check ([#316](https://github.com/golusoris/sveltesentio/issues/316)) ([0c394b7](https://github.com/golusoris/sveltesentio/commit/0c394b7bddd23bc47bceb0c7438963a48e17fd19))

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
