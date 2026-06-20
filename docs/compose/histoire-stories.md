# Storybook stories — component authoring + a11y + visual-regression anchor

Storybook 10 is the story authoring tool for sveltesentio components. Stories
live **next to the component** (`Button.svelte` → `Button.stories.svelte`)
and serve three roles simultaneously:

1. **Design surface** — every variant rendered at once for review.
2. **A11y anchor** — `@storybook/addon-a11y` runs axe-core on every story per
   [ADR-0031](../adr/0031-a11y-testing-lane.md).
3. **Visual-regression anchor** — Playwright / Lost-Pixel snapshots
   target story URLs (see [playwright-visual.md](playwright-visual.md)).

> Histoire is unusable on Svelte 5 — its runtime imports `svelte/internal`
> (forbidden in Svelte 5) and its peers cap at Svelte 4 / Vite 7. Storybook 10
> (`@storybook/svelte-vite` + `@storybook/addon-svelte-csf`) replaced it.

The `add-storybook` Claude skill scaffolds a story; this recipe
codifies the conventions the skill can't enforce.

## Related

- [playwright-visual.md](playwright-visual.md) — visual-regression
  contract that anchors on Storybook story URLs.
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — axe-core triage
  workflow; stories are the axe entry point for the component lane.
- [theming.md](theming.md) — dark / light mode parity; the theme
  toggle must visibly drive `data-theme` on `<html>`.
- [primitives-shadcn.md](primitives-shadcn.md) — shadcn components ship
  one story per family; token-bound variants covered here.
- [primitives-direct.md](primitives-direct.md) — bits-ui wrappers ship
  stories at the same conventions as shadcn primitives.
- [ADR-0031](../adr/0031-a11y-testing-lane.md) — a11y testing lane.

## Install

Storybook is set up once in `apps/storybook/`; component packages only add
the Svelte CSF addon to author stories:

```bash
pnpm --filter @sveltesentio/ui add -D @storybook/addon-svelte-csf
```

The Storybook app (`apps/storybook/.storybook/main.ts`) globs every package's
stories — there is **no per-package Storybook config**:

```ts
// apps/storybook/.storybook/main.ts
import type { StorybookConfig } from '@storybook/svelte-vite';

const config: StorybookConfig = {
  stories: ['../../../packages/*/src/**/*.stories.@(svelte|ts)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-svelte-csf'],
  framework: { name: '@storybook/svelte-vite', options: { docgen: false } },
  core: { disableTelemetry: true },
};

export default config;
```

Framework is `@storybook/svelte-vite` (not `sveltekit`) — the packages are
plain Svelte 5 libraries. The repo's own `@sveltejs/vite-plugin-svelte` is
injected in `viteFinal` so runes components compile exactly as in the package
builds.

Stories are **excluded from the published tarball** in each package's
`package.json`:

```json
{
  "files": ["src", "CHANGELOG.md", "!src/**/*.stories.svelte"]
}
```

Run:

```bash
pnpm --filter @sveltesentio/storybook storybook        # localhost:6006
pnpm --filter @sveltesentio/storybook build-storybook  # storybook-static/
```

## Story file conventions

One `.stories.svelte` per component, colocated:

```text
packages/ui/src/
  button/
    Button.svelte
    Button.stories.svelte
    button.tv.ts
    index.ts
```

Minimum variants: `default`, `all sizes`, `all states` (hover / focus /
disabled / loading / error), `dark mode parity`, `RTL parity` where text
direction matters.

Stories use Svelte CSF — a `<script module>` `defineMeta` block plus one
`<Story>` per variant:

```svelte
<!-- packages/ui/src/button/Button.stories.svelte -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Button from './Button.svelte';
  import { Check, Loader2 } from 'lucide-svelte';

  const { Story } = defineMeta({
    title: 'ui/Button',
    component: Button,
    tags: ['autodocs'],
    args: { variant: 'default' },
  });
</script>

<Story name="Default" args={{ variant: 'default' }} />
<Story name="Secondary" args={{ variant: 'secondary' }} />
<Story name="Destructive" args={{ variant: 'destructive' }} />

<Story name="Sizes">
  <div class="flex flex-wrap items-center gap-4 p-4">
    <Button size="sm">Small</Button>
    <Button size="default">Default</Button>
    <Button size="lg">Large</Button>
    <Button size="icon" aria-label="Confirm"><Check /></Button>
  </div>
</Story>

<Story name="States">
  <div class="flex flex-wrap gap-4 p-4">
    <Button>Idle</Button>
    <Button disabled>Disabled</Button>
    <Button aria-busy="true"><Loader2 class="animate-spin" /> Loading</Button>
  </div>
</Story>

<Story name="RTL">
  <div dir="rtl" class="flex flex-wrap gap-4 p-4">
    <Button>نشر</Button>
    <Button variant="destructive">حذف</Button>
  </div>
</Story>
```

Rules:

- **Title path** groups stories: `ui/Button` / `charts/BarChart`.
- **One `defineMeta`** per file — multiple `<Story>` entries inside.
- **`args` for prop-driven variants**; a `<Story>` body for children /
  snippet props.
- **`size="icon"` variants always carry `aria-label`** — addon-a11y catches
  missing accessible names.
- A `<Story name="...">` whose name starts with a digit / symbol needs an
  explicit `exportName="Pascal"` — the derived export must be a valid JS
  identifier.

## Preset parity

Components that vary per interface-type preset (desktop / handheld /
10-foot per [ADR-0047](../adr/0047-per-interface-presets.md)) get a
story per preset:

```svelte
<Story name="Preset: Desktop">
  <div data-preset="desktop" class="p-4">
    <Button>Default</Button>
    <Button size="icon" aria-label="Menu"><Menu /></Button>
  </div>
</Story>

<Story name="Preset: Handheld">
  <div data-preset="handheld" class="p-4">
    <Button>Default</Button>
    <Button size="icon" aria-label="Menu"><Menu /></Button>
  </div>
</Story>

<Story name="Preset: 10-foot" exportName="Preset10Foot">
  <div data-preset="10foot" class="p-4">
    <Button>Default</Button>
    <Button size="icon" aria-label="Menu"><Menu /></Button>
  </div>
</Story>
```

Touch-target rules from [safe-area.md](safe-area.md) flow through the
preset styles; the story proves the 44×44 CSS px floor holds without
writing a separate test.

## Dark mode + RTL parity

The Storybook toolbar theme toggle sets `data-theme="dark"` on the
preview `<html>`. Every component must render correctly in both. No
`@media (prefers-color-scheme: dark)` — use `[data-theme="dark"]` so
the toggle drives it.

For RTL, a dedicated story with `dir="rtl"` on the wrapper
(see Button example above). Logical properties
([i18n-runtime-strategy.md](i18n-runtime-strategy.md)) do the heavy
lifting; the story is there so reviewers see it.

## A11y lane

`@storybook/addon-a11y` runs axe on each story in the Storybook UI; the
component lane mirrors that matrix with Vitest component tests so the
contract holds in CI:

```ts
// packages/ui/src/button/Button.axe.test.ts
import { render } from '@testing-library/svelte';
import { axe, toHaveNoViolations } from 'jest-axe';
import Button from './Button.svelte';

expect.extend({ toHaveNoViolations });

const cases: Array<{ label: string; props: Record<string, unknown> }> = [
  { label: 'default', props: {} },
  { label: 'disabled', props: { disabled: true } },
  { label: 'loading', props: { 'aria-busy': 'true' } },
  { label: 'icon', props: { size: 'icon', 'aria-label': 'Confirm' } },
];

for (const c of cases) {
  test(`Button (${c.label}) is axe-clean`, async () => {
    const { container } = render(Button, { props: c.props });
    expect(await axe(container)).toHaveNoViolations();
  });
}
```

Stories render the matrix; tests assert it. Keep the two in lockstep —
a new variant in the story requires a new entry in `cases`.

## Controls (args) — when to use

`args` on `<Story>` is useful for components with many independent
props (Dialog, DataTable). For components with clear discrete variants
(Button), **separate pre-rendered stories beat one args-driven story**:
reviewers see all combinations at once in the sidebar.

```svelte
<!-- Good for multi-axis components -->
<Story name="Idle" args={{ loading: false, density: 'comfortable' }} />
<Story name="Loading" args={{ loading: true }} />
<Story name="Compact" args={{ density: 'compact' }} />
```

A component with required **snippet** props needs a `<Story>` body that
renders it with the snippet wired. A component depending on an **optional
peer** (vidstack, embla, `@xyflow/svelte`) must render its fallback path or
a tiny in-story stub — never hard-require the peer.

## Performance — scale the story tree

The single glob in `apps/storybook/.storybook/main.ts` picks up every
package identically; adding a package is zero-config. Stories compile
through the package's own `@sveltejs/vite-plugin-svelte`, so build cost
scales with the number of stories, not the number of packages. Keep
stories colocated per package — already the natural boundary.

## Documentation-in-story

Tag a story `autodocs` to generate a docs page from its `args` /
`argTypes`; put usage notes in the meta `parameters.docs.description`:

```svelte
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Button from './Button.svelte';

  const { Story } = defineMeta({
    title: 'ui/Button',
    component: Button,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'Use variant="destructive" only for irreversible actions. ' +
            'size="icon" requires aria-label. aria-busy="true" swaps copy ' +
            'for a spinner but keeps the width — prevents layout shift.',
        },
      },
    },
  });
</script>
```

Docs render on the autodocs page alongside the story previews.

## CI

`build-storybook` emits a static site in `storybook-static/`. Deploy to a
preview URL per PR (Vercel / Netlify / Cloudflare Pages) so reviewers
can browse the component matrix before merge:

```yaml
# .github/workflows/storybook.yml (excerpt)
- run: pnpm --filter @sveltesentio/storybook build-storybook
- uses: cloudflare/pages-action@v1
  with:
    projectName: sveltesentio-storybook
    directory: apps/storybook/storybook-static
```

The same static site is the target for Lost-Pixel / Playwright visual
regression — see [playwright-visual.md](playwright-visual.md).

## Anti-patterns

- **One `.stories.svelte` per variant instead of per component.** Fragments
  the sidebar; reviewers can't see the whole component at once.
- **Stories in a separate `stories/` directory.** Colocation is the rule
  — matches where axe tests live, matches the `add-storybook` skill.
- **No `size="icon"` variant `aria-label`.** addon-a11y fails. The rule
  is universal — icon-only controls always get an accessible name.
- **Skipping dark mode parity.** The theme toggle exists so every
  story is proven in both themes before the reviewer moves on.
- **Skipping RTL parity for text-direction-sensitive components.**
  Logical properties cover most of it; the variant exists to prove it.
- **Using `@media (prefers-color-scheme: dark)` inside the component.**
  Breaks the Storybook theme toggle. Use `[data-theme="dark"]` selectors
  so the toggle drives.
- **Letting stories drift from axe tests.** New variant without a
  corresponding axe test entry is a lint-worthy omission — axe tests
  are the contract.
- **Stories that hit the network / load real data.** Use fixtures.
  Snapshot stability matters for visual regression.
- **Shipping stories in the npm tarball.** Exclude them via
  `"!src/**/*.stories.svelte"` in the package's `files` array.
- **Reintroducing Histoire (or any second story tool).** Histoire imports
  `svelte/internal` and cannot build Svelte 5 components; Storybook 10 is
  the one adopted tool.

## References

- [ADR-0031](../adr/0031-a11y-testing-lane.md) — axe-core preset lane.
- [ADR-0047](../adr/0047-per-interface-presets.md) — per-interface
  presets that drive variant axes.
- [playwright-visual.md](playwright-visual.md) — visual-regression
  contract anchoring on story URLs.
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — axe-core triage.
- Storybook for Svelte + Vite: <https://storybook.js.org/docs/get-started/frameworks/svelte-vite>.
- `@storybook/addon-svelte-csf`: <https://github.com/storybookjs/addon-svelte-csf>.
- `@storybook/addon-a11y`: <https://storybook.js.org/docs/writing-tests/accessibility-testing>.
