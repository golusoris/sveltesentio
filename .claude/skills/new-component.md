# Skill: new-component

Create a new Svelte 5 component with Histoire story and a11y compliance.

## When to use

When the user asks to create a new reusable UI component in a `@sveltesentio/*` package.

## Steps

1. **Determine the package** — which `packages/<pkg>/src/components/` does this belong in?

2. **Write the component** at `packages/<pkg>/src/components/<Name>.svelte`:

```svelte
<script lang="ts">
  interface Props {
    // Define all props with explicit types
    // Use ? for optional props with defaults
    class?: string;
  }

  const { class: className = '', ...props }: Props = $props();
</script>

<!-- Semantic HTML, aria attributes, design tokens for all styling -->
<div class="sentio-<name> {className}" {...props}>
  <slot />
</div>

<style>
  .sentio-<name> {
    /* Use CSS custom properties from the preset tokens */
    /* Never hardcode colors — use var(--color-primary) etc. */
  }

  .sentio-<name>:focus-visible {
    outline: var(--focus-ring-width, 2px) solid var(--focus-ring-color, currentColor);
    outline-offset: var(--focus-ring-offset, 2px);
  }
</style>
```

3. **Export from package index** — add to `packages/<pkg>/src/index.ts`:

```typescript
export { default as ComponentName } from './components/ComponentName.svelte';
```

4. **Write Histoire story** at `packages/<pkg>/stories/<Name>.story.svelte`:

```svelte
<script lang="ts">
  import { Story, Variant } from 'histoire';
  import ComponentName from '../src/components/ComponentName.svelte';
</script>

<Story title="pkg/ComponentName" group="pkg">
  <Variant title="Default">
    <ComponentName />
  </Variant>
  <!-- Add variants for all meaningful states -->
</Story>
```

5. **Check a11y** — run `pnpm --filter @sveltesentio/<pkg> test` and verify:
   - All interactive elements have accessible names
   - Focus styles are visible (never `outline: none` without replacement)
   - Color is never the only way to convey information

## Rules

- No `any` types
- No hardcoded colors — only CSS custom properties from tokens
- All props typed via `interface Props`
- `class` prop always forwarded to root element
- `$props()` destructuring in `<script lang="ts">`
- No `on:click` — use `onclick` (Svelte 5 event syntax)
