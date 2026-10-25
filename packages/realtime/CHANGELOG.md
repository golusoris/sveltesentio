# Changelog

## [0.7.1](https://github.com/golusoris/sveltesentio/compare/realtime-v0.7.0...realtime-v0.7.1) (2026-10-25)


### Bug Fixes

* **realtime:** keep stream status attach typing on the TypeScript floor ([#432](https://github.com/golusoris/sveltesentio/issues/432)) ([1d38253](https://github.com/golusoris/sveltesentio/commit/1d3825367eff63be4717309ee647bc0c3fcaee61))


### Code Refactoring

* **realtime:** share stream status between useSSE and useConnectStream ([#427](https://github.com/golusoris/sveltesentio/issues/427)) ([ce91fdc](https://github.com/golusoris/sveltesentio/commit/ce91fdc6f5a979f5906c34be7f9fe8f9c0ee1306))
* **test:** share one node Vitest config across ten packages ([#435](https://github.com/golusoris/sveltesentio/issues/435)) ([dafbf95](https://github.com/golusoris/sveltesentio/commit/dafbf95b0007e93cae98cf02d2a01337df033590))
* use svelte's shipped rune types and share the Anthropic request ([#431](https://github.com/golusoris/sveltesentio/issues/431)) ([8f47b77](https://github.com/golusoris/sveltesentio/commit/8f47b777488d665a867454a13d612a8c950a56d6))

## [0.7.0](https://github.com/golusoris/sveltesentio/compare/realtime-v0.6.0...realtime-v0.7.0) (2026-10-17)

### Features

- **realtime:** deliver named server-sent events ([#378](https://github.com/golusoris/sveltesentio/issues/378)) ([a50bc22](https://github.com/golusoris/sveltesentio/commit/a50bc221e489795e8746cb484052d3f5a2ba9c12)), closes [#377](https://github.com/golusoris/sveltesentio/issues/377)

## [0.6.0](https://github.com/golusoris/sveltesentio/compare/realtime-v0.5.1...realtime-v0.6.0) (2026-10-14)

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

## [0.5.1](https://github.com/golusoris/sveltesentio/compare/realtime-v0.5.0...realtime-v0.5.1) (2026-10-13)

### Bug Fixes

- **deps:** update test tooling (major) ([#263](https://github.com/golusoris/sveltesentio/issues/263)) ([9b9faaa](https://github.com/golusoris/sveltesentio/commit/9b9faaae1e94a3fb2e0d1bb4e53a34edea926847))
- type-check every .svelte file under packages/ with svelte-check ([#316](https://github.com/golusoris/sveltesentio/issues/316)) ([0c394b7](https://github.com/golusoris/sveltesentio/commit/0c394b7bddd23bc47bceb0c7438963a48e17fd19))

## [0.5.0](https://github.com/golusoris/sveltesentio/compare/realtime-v0.4.0...realtime-v0.5.0) (2026-10-12)

### ⚠ BREAKING CHANGES

- **licence:** licence MIT -> EUPL-1.2. Releases from the next minor of each package on are EUPL-1.2, a copyleft licence; releases already published stay MIT.

### Features

- **governance:** declare HISS-20 enforcement evidence, backed by fixtures ([e803ea4](https://github.com/golusoris/sveltesentio/commit/e803ea401055b15ea7e9df5eeb0a4c37cf714963))
- **hiss-04:** enforce the function-length cap, with one recorded exception ([#273](https://github.com/golusoris/sveltesentio/issues/273)) ([30ecd8f](https://github.com/golusoris/sveltesentio/commit/30ecd8f4b071c79ebb7482ee456b76fab401d3c9))

### Bug Fixes

- **deps:** repair regressions introduced by the Praetor dependency pass ([f14552b](https://github.com/golusoris/sveltesentio/commit/f14552be15d1fe0c9e94ce4caecae098a8789106))
- **packages:** name the source repository and the licensor in every published package ([#299](https://github.com/golusoris/sveltesentio/issues/299)) ([830318a](https://github.com/golusoris/sveltesentio/commit/830318abf9f7339da63b4c7d357a0565b097b746))
- **types:** put test code under a TypeScript project, and fix the 32 errors ([1138831](https://github.com/golusoris/sveltesentio/commit/11388316e60e6f3fb738255750b2e5606a52d848))

### Code Refactoring

- clear two more length violations and dedupe the history trim ([20a0b36](https://github.com/golusoris/sveltesentio/commit/20a0b36ad33ad25b43969ae09b0249f6c85f6f6c))
- **realtime:** extract the two things both transports were doing twice ([#269](https://github.com/golusoris/sveltesentio/issues/269)) ([5202779](https://github.com/golusoris/sveltesentio/commit/52027798c220c6d6a822f0064d235ccfc60308d0))

### Chores

- **licence:** relicense the project from mit to eupl-1.2 ([#286](https://github.com/golusoris/sveltesentio/issues/286)) ([c07c2ac](https://github.com/golusoris/sveltesentio/commit/c07c2aca14173e2d5bce783a531f47988dc307b0))

## [0.4.0](https://github.com/golusoris/sveltesentio/compare/realtime-v0.3.0...realtime-v0.4.0) (2026-06-15)

### Features

- **realtime:** add ./rpc — ConnectRPC client + bound useConnectStream (ADR-0038) ([279f96e](https://github.com/golusoris/sveltesentio/commit/279f96e982b1800a38263c567bb4b8d6f7991688))

## [0.3.0](https://github.com/golusoris/sveltesentio/compare/realtime-v0.2.0...realtime-v0.3.0) (2026-06-15)

### Features

- **realtime:** useConnectStream + createConnectStream (ConnectRPC server-streaming) ([55d5619](https://github.com/golusoris/sveltesentio/commit/55d56199e7a06e0e643fad1aa8412d5103c1f7c2))

## [0.1.0](https://github.com/golusoris/sveltesentio/compare/realtime-v0.0.2...realtime-v0.1.0) (2026-06-14)

### Features

- land foundation packages and repair CI gate ([#41](https://github.com/golusoris/sveltesentio/issues/41)) ([7557620](https://github.com/golusoris/sveltesentio/commit/75576200e324cd4c55f48571a6532540c1f6eb16))
- **realtime:** add useSSE() rune wrapper over SseClient ([a51ab29](https://github.com/golusoris/sveltesentio/commit/a51ab29e75959e2548a0904e86ee858a2c6baf33))
