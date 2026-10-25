# Changelog

## [0.5.1](https://github.com/golusoris/sveltesentio/compare/mcp-v0.5.0...mcp-v0.5.1) (2026-10-25)


### Code Refactoring

* **mcp:** fold repeated server setup in the mcp tests ([#438](https://github.com/golusoris/sveltesentio/issues/438)) ([45bd879](https://github.com/golusoris/sveltesentio/commit/45bd87937548958a480b38aa468e75857253162f))
* **test:** share one node Vitest config across ten packages ([#435](https://github.com/golusoris/sveltesentio/issues/435)) ([dafbf95](https://github.com/golusoris/sveltesentio/commit/dafbf95b0007e93cae98cf02d2a01337df033590))

## [0.5.0](https://github.com/golusoris/sveltesentio/compare/mcp-v0.4.0...mcp-v0.5.0) (2026-10-14)

### ⚠ BREAKING CHANGES

- every @sveltesentio/* package declares the peer dependency typescript ">=5.5 <7". Package managers that enforce peers refuse or warn on installs with TypeScript below 5.5 or at 7 and above.
- every @sveltesentio/* package declares engines.node >=24. Package managers that enforce engines refuse installs on Node 22.

### Bug Fixes

- declare the Node 24 floor in every published package ([#348](https://github.com/golusoris/sveltesentio/issues/348)) ([6b02d54](https://github.com/golusoris/sveltesentio/commit/6b02d54cc07cf8d190084a154f611a9b17ec99d1))
- declare the TypeScript peer range in every published package ([#350](https://github.com/golusoris/sveltesentio/issues/350)) ([a416a1c](https://github.com/golusoris/sveltesentio/commit/a416a1c68671f0304799d7f4c32a014bbfa901e6))

## [0.4.0](https://github.com/golusoris/sveltesentio/compare/mcp-v0.3.0...mcp-v0.4.0) (2026-10-13)

### ⚠ BREAKING CHANGES

- @sveltesentio/mcp no longer declares the `sveltesentio-mcp` bin. The command never ran from an install, because its target file did not exist and was not published.

### Bug Fixes

- **deps:** update test tooling (major) ([#263](https://github.com/golusoris/sveltesentio/issues/263)) ([9b9faaa](https://github.com/golusoris/sveltesentio/commit/9b9faaae1e94a3fb2e0d1bb4e53a34edea926847))
- remove the mcp bin that pointed at no file and run publint --strict in CI ([#315](https://github.com/golusoris/sveltesentio/issues/315)) ([09e57f5](https://github.com/golusoris/sveltesentio/commit/09e57f5eaea2fa56f60304fe4ac13827f964c47f))

## [0.3.0](https://github.com/golusoris/sveltesentio/compare/mcp-v0.2.0...mcp-v0.3.0) (2026-10-12)

### ⚠ BREAKING CHANGES

- **licence:** licence MIT -> EUPL-1.2. Releases from the next minor of each package on are EUPL-1.2, a copyleft licence; releases already published stay MIT.

### Bug Fixes

- **deps:** repair regressions introduced by the Praetor dependency pass ([f14552b](https://github.com/golusoris/sveltesentio/commit/f14552be15d1fe0c9e94ce4caecae098a8789106))
- **packages:** name the source repository and the licensor in every published package ([#299](https://github.com/golusoris/sveltesentio/issues/299)) ([830318a](https://github.com/golusoris/sveltesentio/commit/830318abf9f7339da63b4c7d357a0565b097b746))
- **security:** remove three polynomial-backtracking regexes ([#266](https://github.com/golusoris/sveltesentio/issues/266)) ([345c16e](https://github.com/golusoris/sveltesentio/commit/345c16ec5b8436f9e397b1382ae83ccd1140f6b2))
- **types,lint:** align the two stragglers, and correct a comment that was wrong ([#268](https://github.com/golusoris/sveltesentio/issues/268)) ([7cd9814](https://github.com/golusoris/sveltesentio/commit/7cd98141eaf85b9ca8e2ed10a4123959c661b1e1))

### Code Refactoring

- **realtime:** extract the two things both transports were doing twice ([#269](https://github.com/golusoris/sveltesentio/issues/269)) ([5202779](https://github.com/golusoris/sveltesentio/commit/52027798c220c6d6a822f0064d235ccfc60308d0))

### Chores

- **licence:** relicense the project from mit to eupl-1.2 ([#286](https://github.com/golusoris/sveltesentio/issues/286)) ([c07c2ac](https://github.com/golusoris/sveltesentio/commit/c07c2aca14173e2d5bce783a531f47988dc307b0))

## [0.2.0](https://github.com/golusoris/sveltesentio/compare/mcp-v0.1.0...mcp-v0.2.0) (2026-06-19)

### Features

- **mcp:** compose_search + principle_lookup tools + resource subscriptions ([c7d98b6](https://github.com/golusoris/sveltesentio/commit/c7d98b60c2e0b907cdc2535d7851076e3fddab2e))

## 0.1.0

Initial release.
