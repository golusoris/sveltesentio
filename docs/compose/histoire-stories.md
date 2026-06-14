# Histoire stories — component authoring + a11y + visual-regression anchor

Histoire is the story authoring tool for sveltesentio components. Stories
live **next to the component** (`Button.svelte` → `Button.story.svelte`)
and serve three roles simultaneously:

1. **Design surface** — every variant rendered at once for review.
2. **A11y anchor** — axe-core runs on every story per
   [ADR-0031](../adr/0031-a11y-testing-lane.md).
3. **Visual-regression anchor** — Playwright / Lost-Pixel snapshots
   target story URLs (see [playwright-visual.md](playwright-visual.md)).

The `add-histoire` Claude skill scaffolds the base template; this recipe
codifies the conventions the skill can't enforce.

## Related

- [playwright-visual.md](playwright-visual.md) — visual-regression
  contract that anchors on Histoire story URLs.
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — axe-core triage
  workflow; stories are the axe entry point for the component lane.
- [theming.md](theming.md) — dark / light mode parity; Histoire's
  theme switcher must visibly drive `data-theme` on `<html>`.
- [primitives-shadcn.md](primitives-shadcn.md) — shadcn components ship
  one story per family; token-bound variants covered here.
- [primitives-direct.md](primitives-direct.md) — bits-ui wrappers ship
  stories at the same conventions as shadcn primitives.
- [ADR-0031](../adr/0031-a11y-testing-lane.md) — a11y testing lane.

## Install

```bash
pnpm add -D histoire @histoire/plugin-svelte @histoire/plugin-screenshot
```

`histoire.config.ts` at each `packages/*` that ships components:

```ts
// packages/ui/histoire.config.ts
import { defineConfig } from 'histoire';
import { HstSvelte } from '@histoire/plugin-svelte';
import { HstScreenshot } from '@histoire/plugin-screenshot';

export default defineConfig({
  plugins: [
    HstSvelte({ sveltePlugin: { extensions: ['.svelte'] } }),
    HstScreenshot({ ignoreAllFrameEvents: true }),
  ],
  setupFile: './histoire.setup.ts',
  tree: {
    groups: [
      { id: 'top', title: '' },
      { id: 'primitives', title: 'Primitives' },
      { id: 'compositions', title: 'Compositions' },
    ],
  },
  theme: { title: '@sveltesentio/ui', logo: { square: './logo.svg' } },
  vite: { build: { sourcemap: true } },
});
```

`histoire.setup.ts` imports global styles + sets up the theme bridge:

```ts
// packages/ui/histoire.setup.ts
import './src/styles/app.css';
import { defineSetupVue3 } from '@histoire/plugin-svelte';

export const setupHistoire = () => {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  document.documentElement.setAttribute(
    'data-theme',
    mq.matches ? 'dark' : 'light',
  );
};
```

`package.json` scripts:

```json
{
  "scripts": {
    "histoire:dev": "histoire dev",
    "histoire:build": "histoire build",
    "histoire:preview": "histoire preview"
  }
}
```

Run:

```bash
pnpm --filter @sveltesentio/ui histoire:dev   # localhost:6006
pnpm --filter @sveltesentio/ui histoire:build # dist-histoire/ static site
```

## Story file conventions

One `.story.svelte` per component, colocated:

```text
packages/ui/src/
  button/
    Button.svelte
    Button.story.svelte
    button.tv.ts
    index.ts
```

Minimum variants: `default`, `all sizes`, `all states` (hover / focus /
disabled / loading / error), `dark mode parity`, `RTL parity` where text
direction matters.

```svelte
<!-- packages/ui/src/button/Button.story.svelte -->
<script lang="ts">
  import { Story, Variant } from 'histoire/svelte';
  import Button from './Button.svelte';
  import { Check, Loader2 } from 'lucide-svelte';
</script>

<Story title="Primitives/Button" icon="lucide:square">
  <Variant title="Variants">
    <div class="flex flex-wrap gap-4 p-4">
      <Button>Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
  </Variant>

  <Variant title="Sizes">
    <div class="flex flex-wrap items-center gap-4 p-4">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Confirm"><Check /></Button>
    </div>
  </Variant>

  <Variant title="States">
    <div class="flex flex-wrap gap-4 p-4">
      <Button>Idle</Button>
      <Button disabled>Disabled</Button>
      <Button aria-busy="true"><Loader2 class="animate-spin" /> Loading</Button>
    </div>
  </Variant>

  <Variant title="RTL">
    <div dir="rtl" class="flex flex-wrap gap-4 p-4">
      <Button>نشر</Button>
      <Button variant="destructive">حذف</Button>
    </div>
  </Variant>
</Story>
```

Rules:

- **Title path** groups stories: `Primitives/Button` / `Compositions/DataTable`.
- **One Story root** per file — multiple Variants inside.
- **Icon** is a lucide key for the sidebar.
- **`size="icon"` variants always carry `aria-label`** — axe-core catches
  missing accessible names.

## Preset parity

Components that vary per interface-type preset (desktop / handheld /
10-foot per [ADR-0047](../adr/0047-per-interface-presets.md)) get a
variant per preset:

```svelte
<Variant title="Preset: Desktop">
  <div data-preset="desktop" class="p-4">
    <Button>Default</Button>
    <Button size="icon" aria-label="Menu"><Menu /></Button>
  </div>
</Variant>

<Variant title="Preset: Handheld">
  <div data-preset="handheld" class="p-4">
    <Button>Default</Button>
    <Button size="icon" aria-label="Menu"><Menu /></Button>
  </div>
</Variant>

<Variant title="Preset: 10-foot">
  <div data-preset="10foot" class="p-4">
    <Button>Default</Button>
    <Button size="icon" aria-label="Menu"><Menu /></Button>
  </div>
</Variant>
```

Touch-target rules from [safe-area.md](safe-area.md) flow through the
preset styles; the variant proves the 44×44 CSS px floor holds without
writing a separate test.

## Dark mode + RTL parity

Histoire's built-in theme switcher toggles `data-theme="dark"` on the
preview `<html>`. Every component must render correctly in both. No
`@media (prefers-color-scheme: dark)` — use `[data-theme="dark"]` so
the switcher drives it.

For RTL, a dedicated variant with `dir="rtl"` on the wrapper
(see Button example above). Logical properties
([i18n-runtime-strategy.md](i18n-runtime-strategy.md)) do the heavy
lifting; the variant is there so reviewers see it.

## A11y lane

axe-core runs on every story via Vitest component tests:

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

`args` + `<Template let:args>` is useful for components with many independent
props (Dialog, DataTable). For components with clear discrete variants
(Button), **pre-rendered variants beat args**: reviewers see all
combinations at once.

```svelte
<!-- Good for multi-axis components -->
<Story title="Compositions/DataTable">
  <Template let:args>
    <DataTable {...args} data={sample} />
  </Template>
  <Variant title="Idle" args={{ loading: false, density: 'comfortable' }} />
  <Variant title="Loading" args={{ loading: true }} />
  <Variant title="Compact" args={{ density: 'compact' }} />
</Story>
```

## Performance — scale the story tree

Histoire rebuilds stories in parallel; 200+ stories compile fast, but
dev-server memory climbs past ~500. Split the Histoire config per
package when a single package grows past that threshold. Prefer one
Histoire per `packages/ui`, one per `packages/forms`, etc. — already
the natural boundary.

## Documentation-in-story

Use Histoire's `<docs slot>` for usage notes that belong next to the
variants, not in a separate README:

```svelte
<Story title="Primitives/Button">
  <div slot="docs" class="prose">

  # Button

  Use `variant="destructive"` only for irreversible actions (delete,
  leave room, revoke access). Pair with a confirmation dialog.

  - `size="icon"` requires `aria-label`.
  - `aria-busy="true"` replaces copy with a spinner but keeps the
    width — prevents layout shift.

  </div>

  <!-- variants… -->
</Story>
```

Docs render in the Histoire sidebar pane alongside the variant preview.

## CI

Histoire build emits a static site in `dist-histoire/`. Deploy to a
preview URL per PR (Vercel / Netlify / Cloudflare Pages) so reviewers
can browse the component matrix before merge:

```yaml
# .github/workflows/histoire.yml (excerpt)
- run: pnpm --filter @sveltesentio/ui histoire:build
- uses: cloudflare/pages-action@v1
  with:
    projectName: sveltesentio-histoire
    directory: packages/ui/dist-histoire
```

The same static site is the target for Lost-Pixel / Playwright visual
regression — see [playwright-visual.md](playwright-visual.md).

## Anti-patterns

- **One `.story.svelte` per variant instead of per component.** Fragments
  the sidebar; reviewers can't see the whole component at once.
- **Stories in a separate `stories/` directory.** Colocation is the rule
  — matches where axe tests live, matches the `add-histoire` skill.
- **No `size="icon"` variant `aria-label`.** Axe-core fails. The rule
  is universal — icon-only controls always get an accessible name.
- **Skipping dark mode parity.** Histoire theme-switcher exists so every
  story is proven in both themes before the reviewer moves on.
- **Skipping RTL parity for text-direction-sensitive components.**
  Logical properties cover most of it; the variant exists to prove it.
- **Using `@media (prefers-color-scheme: dark)` inside the component.**
  Breaks Histoire's theme switcher. Use `[data-theme="dark"]` selectors
  so the switcher drives.
- **Letting stories drift from axe tests.** New variant without a
  corresponding axe test entry is a lint-worthy omission — axe tests
  are the contract.
- **Stories that hit the network / load real data.** Use fixtures.
  Snapshot stability matters for visual regression.
- **Skipping `setupFile` theme bootstrap.** Stories render with no
  tokens and everything looks broken. Setup file wires
  `data-theme` before the story mounts.
- **One Histoire root for the whole monorepo.** Memory climbs past
  ~500 stories; split per package.
- **Storybook instead of Histoire.** Storybook 8 Svelte support lags;
  Histoire is Svelte-5-native. ADR-TBD; don't introduce a second tool.

## References

- [ADR-0031](../adr/0031-a11y-testing-lane.md) — axe-core preset lane.
- [ADR-0047](../adr/0047-per-interface-presets.md) — per-interface
  presets that drive variant axes.
- [playwright-visual.md](playwright-visual.md) — visual-regression
  contract anchoring on story URLs.
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — axe-core triage.
- Histoire docs: <https://histoire.dev>.
- `@histoire/plugin-svelte`: <https://histoire.dev/guide/svelte/>.
- `@histoire/plugin-screenshot`: <https://histoire.dev/plugins/screenshot.html>.
