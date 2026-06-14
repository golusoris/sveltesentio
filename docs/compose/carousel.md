# Carousel — `embla-carousel-svelte` via shadcn-svelte CLI

Default carousel: `embla-carousel-svelte@^8.6` installed via
`pnpm dlx shadcn-svelte@latest add carousel`. **No
`@sveltesentio/ui/carousel` wrapper** — shadcn's generated component
already wraps embla with the correct a11y envelope. This recipe
documents the **three consumer obligations** the shadcn wrapper does
*not* automate.

See [ADR-0012](../adr/0012-embla-carousel-via-shadcn.md) for the
decision. Related: [theming.md](theming.md) (preset-aware sizing),
[ADR-0047](../adr/0047-per-interface-presets.md) (target-size per
preset).

## Why no wrapper

shadcn-svelte's `Carousel` wraps embla verbatim with `role="region"` +
`aria-roledescription="carousel"` + keyboard handlers + sr-only text.
Adding `@sveltesentio/ui/carousel` on top duplicates the wrapper for
zero gain. Streamlining rule: use the CLI output as-is; this recipe
covers the three things that must be remembered per use.

## Install

```bash
pnpm dlx shadcn-svelte@latest add carousel
# Generates src/lib/components/ui/carousel/{index,Carousel,CarouselContent,
#   CarouselItem,CarouselNext,CarouselPrevious}.svelte + installs
#   embla-carousel-svelte@^8.6.
```

Peer range: `embla-carousel-svelte@^8.6`, `svelte@^5`. embla 8.3.0
renamed `onInit` → `onemblaInit` for Svelte 5 compatibility — the
shadcn generator already targets the correct name.

## Basic usage

```svelte
<script lang="ts">
  import * as Carousel from '$lib/components/ui/carousel';
  import type { CarouselAPI } from '$lib/components/ui/carousel';

  let api = $state<CarouselAPI>();
  let current = $state(0);
  let count = $state(0);

  $effect(() => {
    if (!api) return;
    count = api.scrollSnapList().length;
    current = api.selectedScrollSnap() + 1;
    api.on('select', () => { current = api.selectedScrollSnap() + 1; });
  });
</script>

<Carousel.Root bind:api>
  <Carousel.Content>
    {#each items as item (item.id)}
      <Carousel.Item class="md:basis-1/2 lg:basis-1/3">
        <Card {item} />
      </Carousel.Item>
    {/each}
  </Carousel.Content>
  <Carousel.Previous />
  <Carousel.Next />
</Carousel.Root>

<p class="text-muted-fg text-center text-sm">
  Slide {current} of {count}
</p>
```

`bind:api` exposes embla's imperative surface — snap index, scroll
position, event hooks. Use it for "slide N of M" indicators, pagination
dots, or programmatic navigation.

## Consumer obligation 1 — reduced motion

embla 8.x does **not** respect `prefers-reduced-motion` by default.
Users who asked for no animation get full-duration slide transitions
anyway. Fix via embla's `breakpoints` option:

```svelte
<Carousel.Root
  bind:api
  opts={{
    breakpoints: {
      '(prefers-reduced-motion: reduce)': { duration: 0 },
    },
  }}
>
  <!-- … -->
</Carousel.Root>
```

`duration: 0` snaps instantly — no easing, no fade. Never skip this
override; shipping without it fails WCAG 2.3.3.

## Consumer obligation 2 — target size per preset

shadcn's default `CarouselPrevious` / `CarouselNext` use `size="icon-sm"`
(28×28px). That's below WCAG 2.5.8 (AAA "enhanced target size") and
fails WCAG 2.5.5 (AA "target size") on touch/TV surfaces. Override per
preset:

```svelte
<Carousel.Previous size="icon" />      <!-- default 36×36, desktop OK -->
<Carousel.Next size="icon-lg" />       <!-- 48×48, touch/10-foot -->
```

Or scope via the preset attribute:

```css
/* src/app.css — global override */
:root[data-preset='handheld'] [data-carousel-prev],
:root[data-preset='handheld'] [data-carousel-next] {
  min-width: 44px;
  min-height: 44px;
}
:root[data-preset='10foot'] [data-carousel-prev],
:root[data-preset='10foot'] [data-carousel-next] {
  min-width: 64px;
  min-height: 64px;
}
```

The default-icon-only sizing is shadcn's upstream choice; the framework
invariant is that any interactive target scales with the active preset
(see [ADR-0047](../adr/0047-per-interface-presets.md)).

## Consumer obligation 3 — live-region announcements (optional)

embla 8.x does not announce slide changes to screen readers. For most
carousels (decorative hero, product thumbnails) this is fine — the
`role="region"` + Previous/Next buttons are enough. For content
carousels where each slide *is* meaningful (tutorial steps, onboarding),
add an `aria-live="polite"` announcement:

```svelte
<script lang="ts">
  let announcement = $state('');

  $effect(() => {
    if (!api) return;
    api.on('select', () => {
      announcement = `Slide ${api.selectedScrollSnap() + 1} of ${api.scrollSnapList().length}: ${items[api.selectedScrollSnap()].title}`;
    });
  });
</script>

<Carousel.Root bind:api>
  <!-- … -->
</Carousel.Root>

<div class="sr-only" aria-live="polite" aria-atomic="true">
  {announcement}
</div>
```

Or upgrade to embla v9 + the `embla-carousel-accessibility` plugin (v9
is still pre-release as of 2026-04-17; track the release and upgrade
once stable).

## Orientation

Vertical carousel:

```svelte
<Carousel.Root orientation="vertical" opts={{ axis: 'y' }}>
  <Carousel.Content class="h-[400px]">
    {#each items as item}
      <Carousel.Item class="basis-1/3 pt-4">
        <Card {item} />
      </Carousel.Item>
    {/each}
  </Carousel.Content>
  <Carousel.Previous />
  <Carousel.Next />
</Carousel.Root>
```

Note `opts={{ axis: 'y' }}` is required in embla's options (the prop
alone only sets styles).

## Auto-play

embla ships auto-play as a separate plugin:

```bash
pnpm add embla-carousel-autoplay
```

```svelte
<script lang="ts">
  import Autoplay from 'embla-carousel-autoplay';

  const plugins = [Autoplay({ delay: 4000, stopOnInteraction: true })];
</script>

<Carousel.Root {plugins}>
  <!-- … -->
</Carousel.Root>
```

Always set `stopOnInteraction: true` — auto-advance over user
interaction is hostile. For accessibility, pair auto-play with a
visible pause button (WCAG 2.2.2):

```svelte
<button onclick={() => plugins[0].stop()}>Pause</button>
```

## Focus-follow

When a slide contains focusable elements, embla can auto-scroll to
keep them visible:

```svelte
<Carousel.Root opts={{ watchFocus: true }}>
  <!-- focusing an element inside any Item snaps to that Item -->
</Carousel.Root>
```

Useful for keyboard users tabbing through cards.

## Testing

Component test with Testing Library:

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import MyCarousel from './MyCarousel.svelte';

test('next button advances slide', async () => {
  render(MyCarousel);
  const next = screen.getByRole('button', { name: /next slide/i });
  await userEvent.click(next);
  expect(screen.getByText(/slide 2 of/i)).toBeInTheDocument();
});
```

Axe-core against a rendered story to catch the three obligations
(reduced-motion class, target-size, live-region when applicable).

## Anti-patterns

- **Shipping without the `prefers-reduced-motion` breakpoint.** Hostile
  to users with vestibular disorders. Always include the override.
- **Leaving `size="icon-sm"` on Previous/Next in touch/TV surfaces.**
  Under the WCAG 2.5.5 floor. Override per preset.
- **Auto-play without pause.** WCAG 2.2.2 requires a mechanism to stop
  motion. Pair with a pause button and `stopOnInteraction: true`.
- **Carousel for primary navigation.** Research repeatedly shows
  carousels underperform lists for discovery. Use them for peer
  content (related products, featured items) — not the main path.
- **Hand-rolling on `embla-carousel` core only.** Loses shadcn's
  role / keyboard / sr-only defaults. Use the CLI output.
- **Building a `@sveltesentio/ui/carousel` wrapper.** Duplicates
  shadcn's wrapper — violates the streamlining rule.
- **Swiper / @splidejs/svelte-splide / keen-slider.** Swiper dropped
  Svelte v9; splide has no releases; keen-slider has no Svelte 5
  story and zero a11y docs. Hard no (ADR-0012).

## References

- ADR-0012 — embla via shadcn CLI decision + three obligations.
- ADR-0047 — per-interface presets (target-size scaling).
- embla docs: <https://www.embla-carousel.com>.
- shadcn-svelte Carousel: <https://shadcn-svelte.com/docs/components/carousel>.
- WCAG 2.3.3 Animation from Interactions: <https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions>.
- WCAG 2.5.5 / 2.5.8 Target Size: <https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced>.
