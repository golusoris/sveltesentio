# A11y audit runbook — axe-core triage workflow

Sveltesentio ships a two-lane a11y testing preset per
[ADR-0031](../adr/0031-a11y-testing-lane.md): `vitest-axe` for
component-level scans and `@axe-core/playwright` for page-level scans,
plus a token-pair contrast test. This recipe is the **runbook**: how to
read a violation, narrow it to a rule, fix the root cause, and prevent
regression.

Related: [theming.md](theming.md) (token contrast), every compose
recipe that touches UI has its own a11y notes — this is the triage
meta-doc.

## The two-lane preset

```text
┌────────────────────────────────────────────────────────────┐
│ vitest-axe            per component render    <5 s / suite │
│ @axe-core/playwright  per page visit           10–30 s     │
│ token-pair contrast   per palette change       <1 s        │
└────────────────────────────────────────────────────────────┘
```

All three run on CI; fail any → PR gate closes. Locally:

```bash
pnpm test:a11y          # vitest-axe
pnpm test:e2e -- axe    # playwright axe fixture
pnpm test:contrast      # token-pair test
```

## Reading a violation

`axe-core` output shape:

```json
{
  "id": "color-contrast",
  "impact": "serious",
  "description": "Ensures the contrast between foreground and background colors meets WCAG 2 AA contrast ratio thresholds",
  "helpUrl": "https://dequeuniversity.com/rules/axe/4.10/color-contrast",
  "nodes": [
    {
      "html": "<button class=\"ghost\">Cancel</button>",
      "target": [".dialog > button.ghost"],
      "failureSummary": "Fix any of the following:\n  Element has insufficient color contrast of 3.2 (foreground color: #6b7280, background color: #ffffff, font size: 14.0pt, font weight: normal). Expected contrast ratio of 4.5:1"
    }
  ]
}
```

Four fields matter for triage:

| Field | Use |
|---|---|
| `id` | Look up rule semantics + fix strategies |
| `impact` | `critical` > `serious` > `moderate` > `minor` — fix order |
| `target` | CSS selector; paste into devtools to find the element |
| `failureSummary` | The "why"; often tells you the exact delta (e.g. 3.2 vs 4.5) |

## Impact → priority

- **critical**: blocks submission flows, locks users out. Fix before
  merge, no exceptions.
- **serious**: makes a feature unusable with AT. Fix before merge; a
  waiver requires a signed issue with remediation ETA.
- **moderate**: degrades UX but workarounds exist. Fix in the same
  PR when possible; otherwise open a linked issue.
- **minor**: cosmetic / best-practice. Batch into a sweep; never
  block a PR solo.

`@sveltesentio/testing/axe` gates on `critical` + `serious` by
default. Override in `playwright.config.ts`:

```ts
import { axeConfig } from '@sveltesentio/testing/playwright-axe';
export default defineConfig({
  use: {
    ...axeConfig({ impactsFail: ['critical', 'serious', 'moderate'] }),
  },
});
```

## Common violations + fixes

### `color-contrast` (and `color-contrast-enhanced`)

Root cause: token pair below 4.5:1 (text) or 3:1 (large text / UI).

Fix order:

1. Re-run the token-pair test to confirm the regression is
   token-level, not style-level. If it is, fix in
   [theming.md](theming.md).
2. If style-level (e.g. opacity chain), raise the underlying color's
   L channel or lower the bg's.
3. Never "fix" by hard-coding a hex. Tokens are the contract.

```ts
// scripts/check-contrast.ts
import { computeContrast } from '@sveltesentio/ui/contrast';
import { tokens } from '@sveltesentio/ui/tokens';

for (const [fg, bg] of [
  ['fg', 'bg'],
  ['muted-fg', 'bg'],
  ['accent-fg', 'accent'],
  ['danger-fg', 'danger'],
]) {
  const ratio = computeContrast(tokens[fg], tokens[bg]);
  if (ratio < 4.5) throw new Error(`${fg} on ${bg}: ${ratio.toFixed(2)}`);
}
```

### `aria-required-parent` / `aria-required-children`

Root cause: role used in wrong context (e.g. `role="row"` without a
`role="rowgroup"` / `"table"` / `"grid"` ancestor).

Fix: use the wrapper — [data-tables.md](data-tables.md)'s `DataTable`
or `VirtualList` wire the role tree correctly. If rolling your own,
render the full tree, not just the leaf role.

### `button-name` / `link-name`

Root cause: icon-only button without accessible name.

Fix:

```svelte
<button aria-label="Close dialog">
  <X aria-hidden="true" class="size-4" />
</button>
```

Icons with text content don't need `aria-label` — the text is the
name. Adding both is an anti-pattern (SR reads both).

### `label`

Root cause: form field without associated label.

Fix: Formsnap + Superforms wire this automatically — see
[forms.md](forms.md). For ad-hoc inputs:

```svelte
<label for="email">Email</label>
<input id="email" type="email" bind:value={email} />
```

`aria-label` is acceptable for inputs inside a visual context that
already explains the purpose (e.g. search icon + "Search" placeholder
+ `aria-label="Search"`), but prefer visible labels.

### `landmark-unique`

Root cause: multiple `<main>` or multiple `<nav>` without distinct
`aria-label`.

Fix: `<nav aria-label="Primary">` + `<nav aria-label="Footer">`.
SR users navigate by landmark; unique labels make the list coherent.

### `heading-order`

Root cause: skipping heading levels (`h1` → `h3`).

Fix: either lower to `h2` or restructure. For reusable components
that live inside varying contexts, accept a `headingLevel` prop and
render dynamically:

```svelte
<script lang="ts">
  let { headingLevel = 2, title } = $props<{ headingLevel?: 1|2|3|4|5|6; title: string }>();
  const Tag = `h${headingLevel}` as const;
</script>

<svelte:element this={Tag} class="text-lg font-semibold">{title}</svelte:element>
```

### `duplicate-id-aria`

Root cause: ids generated client-side collide with SSR-rendered ones,
or hard-coded ids in a repeated component.

Fix: `crypto.randomUUID()` per component instance; avoid static ids
in component source.

## Playwright fixture pattern

```ts
// tests/axe.spec.ts
import { test, expect } from '@sveltesentio/testing/playwright-axe';

test.describe('routes pass axe', () => {
  for (const route of ['/', '/login', '/flows/demo', '/settings']) {
    test(`${route} is axe-clean`, async ({ page, axeBuilder }) => {
      await page.goto(route);
      const results = await axeBuilder().analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
```

`axeBuilder()` is pre-configured with sveltesentio's rule overrides
(WCAG 2.2 AA tags, excludes shadcn-svelte upstream false-positives).
Extend per-test:

```ts
const results = await axeBuilder()
  .disableRules(['landmark-one-main'])  // intentional: this is a widget page
  .include('.feature-under-test')
  .analyze();
```

Disabling rules requires a comment explaining why — reviewable trail.

## vitest-axe component pattern

```ts
import { render } from '@testing-library/svelte';
import { axe } from '@sveltesentio/testing/axe';
import { toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

test('Dialog is axe-clean in open state', async () => {
  const { container } = render(Dialog, { props: { open: true, title: 'T' } });
  expect(await axe(container)).toHaveNoViolations();
});
```

Test each interactive state — opened, closed, loading, error. A11y
bugs hide in state transitions (focus returns to wrong element, live
regions announce the wrong thing).

## Manual audits (what axe can't catch)

axe covers ~30-40% of WCAG criteria mechanically. The rest is manual:

| Criterion | Manual check |
|---|---|
| 2.4.3 Focus order | Tab through the page; order should mirror visual flow |
| 2.4.7 Focus visible | Every focusable element has a visible ring |
| 3.2.1 On focus | Focusing doesn't trigger unexpected navigation |
| 3.3.1 Error identification | Every form error is announced + visible + describes fix |
| 1.4.10 Reflow | Viewport 320px × 256px: no horizontal scroll, no loss of content |
| 1.4.13 Content on hover/focus | Tooltips dismissible (ESC), hoverable (can move cursor into them), persistent |
| 2.5.5 Target size | Touch targets ≥24×24 CSS px (2.2 AA) or 44×44 (2.5.5 AAA) |

Run a **monthly** manual pass on the top 5 user flows. Log findings
against the WCAG checklist in
`docs/compliance/wcag-2.2-aa.md`.

## Token-pair contrast gate

`pnpm test:contrast` reads `@sveltesentio/ui/tokens` and computes
WCAG contrast for every documented pair. Shape:

```ts
// @sveltesentio/testing/contrast
export const pairs: Array<[string, string, number]> = [
  ['fg', 'bg', 7.0],              // body text, AAA aspiration
  ['muted-fg', 'bg', 4.5],
  ['accent-fg', 'accent', 4.5],
  ['danger-fg', 'danger', 4.5],
  ['border', 'bg', 3.0],          // UI element contrast
  ['ring', 'bg', 3.0],            // focus ring
];
```

Threshold column is the target. Regressions break the build with
`fg on bg: 4.2 (need 7.0)`. See [theming.md](theming.md) for the
oklch tuning recipe.

## Triage decision tree

```text
violation reported
  │
  ├── impact = critical/serious?
  │     ├── yes → block merge; fix or waiver-with-issue
  │     └── no  → moderate? fix in same PR preferred
  │
  ├── root cause = token?
  │     ├── yes → fix in tokens; re-run contrast test
  │     └── no  → markup? role tree? focus?
  │
  ├── shadcn-svelte upstream?
  │     ├── yes → check disabledRules; file upstream if novel
  │     └── no  → fix in wrapper / app source
  │
  └── SR-only behavior?
        ├── yes → add manual test note + live-region fix
        └── no  → automated lane catches it; expand fixture
```

## Suppressions (carefully)

Only suppress when:

- The rule mis-fires on sveltesentio's intentional design (e.g.
  `role="grid"` inside a live feed that's actually a log).
- Upstream shadcn-svelte component ships a known issue with an open
  PR.

Suppression format:

```ts
await axeBuilder()
  .disableRules(['aria-required-children']) // intentional: log role, not grid — ADR-0011 note
  .analyze();
```

Include an ADR / issue reference in the comment. Every `disableRules`
invocation is a review surface.

## Reporting

CI publishes axe results to `test-results/axe-{sha}.json`. Keep
30-day retention; compare trends in monthly audits. Sudden spikes
indicate either a regression or a rule-set bump (we pin axe-core
per ADR-0031 to avoid the latter surprising us).

## Anti-patterns

- **Disabling rules without a comment.** Review opacity. Every
  suppression needs a reason + ADR or issue link.
- **Relying on axe alone for compliance.** ~30-40% coverage.
  Manual pass is non-optional.
- **Fixing contrast by hex.** Tokens are the contract. Fix in
  [theming.md](theming.md) flow.
- **Asserting "no violations" on a loading skeleton.** Test the
  loaded + interactive state, not the intermediate.
- **Skipping the token-pair test on palette PRs.** Three-line change
  can break AAA body contrast silently.
- **Ignoring `impact: moderate`.** They compound. A page with 10
  moderates is worse than one with 2 seriouses.
- **Running axe against `document` in Vitest.** `container` scope is
  deliberate — keeps test isolation.

## References

- ADR-0031 — a11y testing lane (vitest-axe + axe-core/playwright +
  token-pair).
- [theming.md](theming.md) — oklch tokens, contrast contract.
- [data-tables.md](data-tables.md) — `role="grid"` tree wiring.
- [forms.md](forms.md) — Formsnap label wiring.
- `docs/compliance/wcag-2.2-aa.md` — per-criterion coverage.
- axe-core rule docs: <https://dequeuniversity.com/rules/axe/>.
- WCAG 2.2 quick reference: <https://www.w3.org/WAI/WCAG22/quickref/>.
