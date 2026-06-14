---
pinned-version: 5.55.4
canonical-url: https://svelte.dev/docs/svelte/what-are-runes
last-verified: 2026-04-18
---

# Svelte 5 runes — v5.55.4 snapshot

Pinned: **^5.55.4** (root + every package `peerDependency`)
Canonical: https://svelte.dev/docs/svelte/what-are-runes

Runes are compiler-recognised symbols (no import). Use them in `.svelte` and `.svelte.ts`/`.svelte.js` files.

## `$state` — reactive state

```svelte
<script lang="ts">
  let count = $state(0);                 // primitive
  let user  = $state({ name: 'Ada' });   // deeply reactive object
  user.name = 'Grace';                   // triggers update

  let raw = $state.raw({ huge: blob });  // shallow — only assignment is reactive
  let snap = $state.snapshot(user);      // plain JS clone, severs reactivity
</script>
```

Class fields:

```ts
class Counter {
  count = $state(0);
  increment() { this.count++; }
}
```

## `$derived` — computed values

```svelte
<script lang="ts">
  let count = $state(0);
  let doubled = $derived(count * 2);                       // expression form
  let label = $derived.by(() => count > 10 ? 'big' : 'small'); // function form for blocks
</script>
```

## `$effect` — side effects

```svelte
<script lang="ts">
  let count = $state(0);

  $effect(() => {
    document.title = `count: ${count}`;
    return () => {/* cleanup on rerun + unmount */};
  });

  $effect.pre(() => { /* before DOM update */ });
  const isMounted = $effect.tracking();   // true inside reactive context
  $effect.root(() => { /* manual root, returns dispose() */ });
</script>
```

## `$props` — component inputs

```svelte
<script lang="ts">
  type Props = { name: string; onClick?: (e: MouseEvent) => void; children?: import('svelte').Snippet };
  let { name, onClick, children, ...rest }: Props = $props();

  let bindable = $bindable(0);   // declare prop as 2-way bindable
  // <Child bind:value={parentValue} />
</script>
```

## `$inspect` — dev-only logging

```svelte
<script>
  let count = $state(0);
  $inspect(count);                         // logs on every change in dev
  $inspect(count).with((type, val) => {}); // custom logger
</script>
```

## `$host` — custom-element host

Available only in components compiled as custom elements. Use to dispatch `CustomEvent`s on the host.

## `sveltesentio` usage

- All packages declare `svelte: ">=5.0.0"` as a peer; runes are the **only** reactivity model in new code.
- Legacy stores (`writable`/`readable`) are forbidden for server state — use `@sveltesentio/query` (see [docs/upstream/tanstack-query/](../tanstack-query/)).
- `$:` reactive statements are forbidden — use `$derived` / `$effect`. Enforced by [docs/principles.md](../../principles.md) §2.4.

## Gotchas (commonly hallucinated)

- `$state(obj)` is a **deep proxy**; mutate properties directly. Do not call `$state.raw()` unless you need shallow.
- `$derived(expr)` takes an **expression**, not an arrow. Use `$derived.by(() => …)` for multi-statement bodies.
- `$effect` runs **after** DOM updates. Use `$effect.pre` for layout-affecting work.
- `$props()` is called **once**; destructure all props in one call. There is no second `$props()` call per component.
- Snippets (`{#snippet name()}…{/snippet}`) replace slots. The `children` prop typed as `Snippet` receives default-slot content.

## Links

- Migration guide (Svelte 4 → 5): https://svelte.dev/docs/svelte/v5-migration-guide
- Runes deep-dive: https://svelte.dev/docs/svelte/$state
