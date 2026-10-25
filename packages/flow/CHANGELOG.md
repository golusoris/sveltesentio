# Changelog

## [0.7.1](https://github.com/golusoris/sveltesentio/compare/flow-v0.7.0...flow-v0.7.1) (2026-10-25)

### Code Refactoring

- **test:** share one axe helper and fold ai test setup ([#437](https://github.com/golusoris/sveltesentio/issues/437)) ([64455d3](https://github.com/golusoris/sveltesentio/commit/64455d375441d7ae10a2af94098925c2afa52b6e))

## [0.7.0](https://github.com/golusoris/sveltesentio/compare/flow-v0.6.0...flow-v0.7.0) (2026-10-14)

### ⚠ BREAKING CHANGES

- every @sveltesentio/* package that declares a svelte peer requires svelte 5.56.4 or later, and every package that declares a kit peer requires @sveltejs/kit 2.53.0 or later. Package managers that enforce peers refuse or warn on installs below these versions.
- every @sveltesentio/* package declares the peer dependency typescript ">=5.5 <7". Package managers that enforce peers refuse or warn on installs with TypeScript below 5.5 or at 7 and above.
- every @sveltesentio/* package declares engines.node >=24. Package managers that enforce engines refuse installs on Node 22.

### Bug Fixes

- declare the measured svelte and SvelteKit peer floors ([#351](https://github.com/golusoris/sveltesentio/issues/351)) ([608a52b](https://github.com/golusoris/sveltesentio/commit/608a52bddd73388eed279f723ddf4bf77b3bb476))
- declare the Node 24 floor in every published package ([#348](https://github.com/golusoris/sveltesentio/issues/348)) ([6b02d54](https://github.com/golusoris/sveltesentio/commit/6b02d54cc07cf8d190084a154f611a9b17ec99d1))
- declare the TypeScript peer range in every published package ([#350](https://github.com/golusoris/sveltesentio/issues/350)) ([a416a1c](https://github.com/golusoris/sveltesentio/commit/a416a1c68671f0304799d7f4c32a014bbfa901e6))

## [0.6.0](https://github.com/golusoris/sveltesentio/compare/flow-v0.5.0...flow-v0.6.0) (2026-10-13)

### Notes

- No API change in @sveltesentio/flow. The breaking-change note that release tooling copied here from #315 applies to @sveltesentio/mcp only. In this package, the `./canvas` export lists its `types` condition first; it resolves to the same files as before.

### Bug Fixes

- **deps:** update test tooling (major) ([#263](https://github.com/golusoris/sveltesentio/issues/263)) ([9b9faaa](https://github.com/golusoris/sveltesentio/commit/9b9faaae1e94a3fb2e0d1bb4e53a34edea926847))
- remove the mcp bin that pointed at no file and run publint --strict in CI ([#315](https://github.com/golusoris/sveltesentio/issues/315)) ([09e57f5](https://github.com/golusoris/sveltesentio/commit/09e57f5eaea2fa56f60304fe4ac13827f964c47f))
- type-check every .svelte file under packages/ with svelte-check ([#316](https://github.com/golusoris/sveltesentio/issues/316)) ([0c394b7](https://github.com/golusoris/sveltesentio/commit/0c394b7bddd23bc47bceb0c7438963a48e17fd19))

## [0.5.0](https://github.com/golusoris/sveltesentio/compare/flow-v0.4.0...flow-v0.5.0) (2026-10-12)

### ⚠ BREAKING CHANGES

- **licence:** licence MIT -> EUPL-1.2. Releases from the next minor of each package on are EUPL-1.2, a copyleft licence; releases already published stay MIT.

### Features

- **governance:** declare HISS-20 enforcement evidence, backed by fixtures ([e803ea4](https://github.com/golusoris/sveltesentio/commit/e803ea401055b15ea7e9df5eeb0a4c37cf714963))
- **hiss-01:** forbid recursion, and fix the one place that used it ([#267](https://github.com/golusoris/sveltesentio/issues/267)) ([a811b6d](https://github.com/golusoris/sveltesentio/commit/a811b6dd3ea9dd7953d007621354ba81b33d115f))

### Bug Fixes

- **deps:** repair regressions introduced by the Praetor dependency pass ([f14552b](https://github.com/golusoris/sveltesentio/commit/f14552be15d1fe0c9e94ce4caecae098a8789106))
- **hiss-04:** enforce the complexity bound and clear the 13 functions over it ([a4f37c0](https://github.com/golusoris/sveltesentio/commit/a4f37c085b657df92bac451ed04a08b84bfe89c3))
- **hiss-07,hiss-08:** close the gaps the coverage catalog named ([231ccea](https://github.com/golusoris/sveltesentio/commit/231cceaacaa6d9597adb3dfd11a5644c1de6fe21))
- make every story pass axe in a browser and gate stories and end-to-end tests in ci ([#290](https://github.com/golusoris/sveltesentio/issues/290)) ([88c98d3](https://github.com/golusoris/sveltesentio/commit/88c98d394a59b14c4c44ce18ade88a82bfe44c2e))
- **packages:** name the source repository and the licensor in every published package ([#299](https://github.com/golusoris/sveltesentio/issues/299)) ([830318a](https://github.com/golusoris/sveltesentio/commit/830318abf9f7339da63b4c7d357a0565b097b746))
- **types:** put test code under a TypeScript project, and fix the 32 errors ([1138831](https://github.com/golusoris/sveltesentio/commit/11388316e60e6f3fb738255750b2e5606a52d848))

### Chores

- **licence:** relicense the project from mit to eupl-1.2 ([#286](https://github.com/golusoris/sveltesentio/issues/286)) ([c07c2ac](https://github.com/golusoris/sveltesentio/commit/c07c2aca14173e2d5bce783a531f47988dc307b0))

## [0.4.0](https://github.com/golusoris/sveltesentio/compare/flow-v0.3.0...flow-v0.4.0) (2026-06-19)

### Features

- **flow:** ./layout-worker — createLayoutWorker (elkjs in a Web Worker + SSR/main-thread fallback) ([4f29b12](https://github.com/golusoris/sveltesentio/commit/4f29b12246e1c20dfc33c3ea0eff5afd3b2cec7d))

## [0.3.0](https://github.com/golusoris/sveltesentio/compare/flow-v0.2.0...flow-v0.3.0) (2026-06-15)

### Features

- **flow:** &lt;FlowCanvas&gt; + node components over @xyflow/svelte ([76ac597](https://github.com/golusoris/sveltesentio/commit/76ac597db370d124e23aa6fb9f5c71253ea824a6))

## [0.1.0](https://github.com/golusoris/sveltesentio/compare/flow-v0.0.1...flow-v0.1.0) (2026-06-14)

### Features

- land foundation packages and repair CI gate ([#41](https://github.com/golusoris/sveltesentio/issues/41)) ([7557620](https://github.com/golusoris/sveltesentio/commit/75576200e324cd4c55f48571a6532540c1f6eb16))
