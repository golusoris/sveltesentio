# ADR-0056: Every Storybook story is a browser test with axe as a failing check

- **Status**: Accepted
- **Date**: 2026-10-11
- **Deciders**: @lusoris (user)
- **Amends**: [ADR-0031](0031-a11y-testing-lane.md) (adds a third lane; the rule set stays the one ADR-0031 defines)

## Context

`AGENTS.md` and `docs/compliance/wcag-2.2-aa.md` stated that axe-core is clean on every Storybook story and that Playwright end-to-end tests run in CI. Measured on 2026-10-11, neither ran:

- `ci.yml` had the jobs `pr-title`, `detect-changes`, `lint`, `typecheck`, `test`, `build`, `audit`, `docs-drift` and `ci-gate`. No job rendered a story, and no job ran Playwright.
- `@storybook/addon-a11y` was installed, which shows findings in the Storybook panel to whoever opens a story. Nothing failed on a finding.
- `auth`, `media` and `shell` each had a `test:e2e` script that only ran on a developer's machine.

ADR-0031 already gives the repository a component lane (axe-core in the Vitest component tests) and a page lane (`@axe-core/playwright` in the shell end-to-end test). The component lane runs in jsdom and covers the packages that call it; the stories are the one place where every component is rendered in a real browser with its real styles.

The first run of every story under axe found what the claims had hidden: 9 failing stories, 2 story files that did not load in a browser at all, and 7 render errors (recorded in the pull request that introduces this record).

## Decision

1. **Stories are tests.** `@storybook/addon-vitest` turns every `*.stories.svelte` file into a Vitest browser test (Chromium through Playwright). A story that throws while rendering fails.
2. **axe fails the test.** `parameters.a11y.test` is `'error'` in `apps/storybook/.storybook/preview.ts`, so a violation fails the story's test instead of colouring a panel.
3. **One rule set.** The story run passes `WCAG_22_AA_TAGS` from `@sveltesentio/testing/a11y` as axe's `runOnly` tags, the same list the component lane and the page lane use.
4. **Two CI jobs, both required by `CI Gate`.** `Stories (axe)` runs `pnpm test:stories`; it is not narrowed to affected packages, because the stories come from every package. `End-to-end` runs `test:e2e` for the affected ones of `auth`, `media` and `shell`.

Two differences from the other lanes are deliberate and stated here so that nobody has to rediscover them:

- The story run fails on a violation of **any** impact. The component and page lanes fail on `serious` and `critical` only (`DEFAULT_IMPACT_FAIL_LEVELS`). `@storybook/addon-a11y` 10.6.0 has no impact filter, and the stricter rule costs nothing while the stories are clean.
- `@storybook/addon-a11y` disables axe's `region` rule, because a component rendered alone has no page landmarks. The page lane keeps the rule.

## Alternatives considered

- **`@storybook/test-runner`.** It needs a running or built Storybook and brings Jest next to the Vitest the repository already uses. Its own documentation says it "has been superseded by the Vitest addon" and recommends the Vitest addon for Vite-powered frameworks, which `@storybook/svelte-vite` is. Rejected.
- **An own Playwright spec over the static Storybook build with `@axe-core/playwright`.** No new dependency, since both are already installed, and it reuses `@sveltesentio/testing/playwright-axe`. It costs a Storybook build per run and an own story index walker, and a story that fails to render shows up only as an empty page. Kept as the fallback if the addon stops working with Svelte CSF stories.
- **Extend the component lane (axe-core in jsdom) to every component.** axe-core's own README states limited support for jsdom and names `color-contrast` as a rule that does not work there. The lane also would not have found the two story files that fail to load in a browser. Rejected as the only lane; it stays for what it covers.

Compatibility of the chosen addon with Svelte CSF stories was measured before the decision was applied: with `a11y.test: 'todo'`, 20 of 23 story files loaded and 70 tests passed. Two of the three files that did not load failed on defects of this repository; the third failed once on a module fetch during the first run on an empty dependency cache (see the cold-cache note under Consequences). After the defects were fixed in the same pull request, all 23 story files load and 80 tests pass with `a11y.test: 'error'`.

## Consequences

**Positive**:

- The two statements in `AGENTS.md` are true, and a regression fails a pull request.
- A story that cannot render in a browser is found by CI, which the jsdom tests cannot do.
- One rule set for three lanes: a change to `WCAG_22_AA_TAGS` reaches all of them.

**Negative / trade-offs**:

- New development dependencies of the Storybook app: `@storybook/addon-vitest`, `@vitest/browser`, `@vitest/browser-playwright`, `playwright`, `vitest`, `@types/node`. All are development-only; `vitest` and `playwright` were already in the lockfile at the same versions.
- Two more CI jobs, each with a Chromium download.
- The stories render the default theme only. Dark-mode contrast is not covered by this gate.
- The token-pair contrast test that ADR-0031 lists is still not built; `docs/compliance/wcag-2.2-aa.md` says so.
- **Cold cache.** On the tree with the defects, one story file failed once with a failed module fetch during the first run on an empty Vite dependency cache. On the fixed tree, six consecutive runs that each started from an empty cache passed without it, so no `optimizeDeps` setting was added. If the failure returns, the first thing to try is `optimizeDeps.include` in `apps/storybook/vitest.config.ts`; a retry of the job is not a fix.
- A story that renders its component itself needs `asChild` on `<Story>`. Without it `@storybook/addon-svelte-csf` forwards the children into the component of the meta and the component is rendered twice, nested. Seven of the first findings came from that.

## Evidence

- Operator decision of 2026-10-11 on the accessibility gate and on the story runner (ledger entries `sveltesentio-a11y-gate-gap` and `sveltesentio-a11y-story-runner`, paraphrased): build the gate with axe on every story and an end-to-end job, correct the claims in the same pull request, use the Vitest addon with `a11y.test: 'error'` after a compatibility check, with the own Playwright spec as the fallback.
- `.github/workflows/ci.yml`: jobs `stories` and `e2e`.
- `apps/storybook/.storybook/preview.ts`, `apps/storybook/vitest.config.ts`.
- Storybook documentation, test runner: <https://storybook.js.org/docs/writing-tests/integrations/test-runner> (read 2026-10-11).
- Storybook documentation, accessibility tests: <https://storybook.js.org/docs/writing-tests/accessibility-testing> (read 2026-10-11).
