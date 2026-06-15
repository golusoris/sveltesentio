# Skill: add-storybook

Add a Storybook story for a component.

> Replaces the former `add-histoire` skill: Histoire cannot build Svelte 5
> components (its runtime imports `svelte/internal`, forbidden in Svelte 5; peers
> cap at Svelte 4 / Vite 7). The repo uses **Storybook 10** (`@storybook/svelte-vite`
> + `@storybook/addon-a11y` + `@storybook/addon-svelte-csf`), set up in
> `apps/storybook/`.

## When to use

When the user asks to document a component or create a visual story/preview.

## File naming

Stories co-locate next to the component: `Button.svelte` → `Button.stories.svelte`.
The glob in `apps/storybook/.storybook/main.ts`
(`../../../packages/*/src/**/*.stories.@(svelte|ts)`) picks them up automatically —
no per-package config. Stories are EXCLUDED from the npm tarball via
`"files": ["src", "!src/**/*.stories.svelte"]` in the package's `package.json`.

## Template (Svelte CSF — `@storybook/addon-svelte-csf`)

```svelte
<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Button from './Button.svelte';

	const { Story } = defineMeta({
		title: 'ui/Button',
		component: Button,
		args: { variant: 'default' },
	});
</script>

<Story name="Primary" args={{ variant: 'default' }} />
<Story name="Destructive" args={{ variant: 'destructive' }} />

<!-- For children/snippet props, give the Story a body: -->
<Story name="With label">
	<Button variant="ghost">Ghost</Button>
</Story>
```

## Gotchas

- A `<Story name="...">` whose name starts with a digit/symbol needs an explicit
  `exportName="Pascal"` (the auto-derived export must be a valid JS identifier).
- A component with required **snippet** props needs a `<Story>` body that renders
  it with the snippet wired (see `packages/ui` VirtualList).
- A component depending on an **optional peer** (vidstack, embla, `@xyflow/svelte`)
  must render its fallback path or use a tiny in-story stub — never hard-require
  the peer.
- Add `"@storybook/addon-svelte-csf": "5.1.2"` to the package's `devDependencies`.

## Running Storybook

```bash
pnpm --filter @sveltesentio/storybook storybook        # dev, http://localhost:6006
pnpm --filter @sveltesentio/storybook build-storybook  # static build (CI gate)
```

## Rules

- One `*.stories.svelte` per component; cover the meaningful variants/states.
- `@storybook/addon-a11y` runs axe in each story — keep every story axe-clean
  (the WCAG 2.2 AA bar, §2.3).
- Exclude stories from the published tarball (`!src/**/*.stories.svelte`).
