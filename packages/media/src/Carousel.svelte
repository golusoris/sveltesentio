<!--
@component
Carousel — a preset-aware a11y envelope over `embla-carousel-svelte` (ADR-0012).
embla v8 ships no built-in a11y, and shadcn's generated wrapper leaves three
obligations to the caller; this shell bakes them in: the `./carousel`
`buildCarouselOptions` reduced-motion breakpoint, WCAG 2.5.8 nav-button
target-size per interface preset, and the `role="region"` /
`aria-roledescription="carousel"` + keyboard envelope.

`embla-carousel-svelte` is an OPTIONAL peer: pass its `emblaAction` (the
package default export `use:emblaCarousel`) to enable dragging/snapping. Absent
it, the component degrades to a native scroll-snap region that still renders,
keyboards, and passes axe — so it tests without the heavy peer.

The tested logic lives in `./carousel`; this file is a thin, a11y-correct view.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Action } from 'svelte/action';
	import {
		buildCarouselOptions,
		navButtonTargetPx,
		type CarouselOptionsInput,
		type CarouselPreset,
		type EmblaOptionsLike,
	} from './carousel.js';

	interface Props extends CarouselOptionsInput {
		/** Accessible name for the carousel region — required. */
		label: string;
		/** Slides. Each item should render its own focusable content. */
		children: Snippet;
		/** Interface preset governing nav-button target size. Default `desktop`. */
		preset?: CarouselPreset;
		/**
		 * The `embla-carousel-svelte` action (its default export). When omitted the
		 * region degrades to native CSS scroll-snap.
		 */
		emblaAction?: Action<HTMLElement, EmblaOptionsLike>;
	}

	const {
		label,
		children,
		preset = 'desktop',
		emblaAction,
		...optionsInput
	}: Props = $props();

	const options = $derived(buildCarouselOptions(optionsInput as CarouselOptionsInput));
	const targetPx = $derived(navButtonTargetPx(preset));
	let viewport = $state<HTMLDivElement | null>(null);

	function scrollByPage(direction: -1 | 1): void {
		const el = viewport;
		if (!el) return;
		el.scrollBy({ left: direction * el.clientWidth, behavior: options.duration === 0 ? 'auto' : 'smooth' });
	}
</script>

<!-- A named <section> is an implicit landmark `region`; aria-roledescription
	relabels it as a carousel per the WAI-ARIA carousel pattern. -->
<section
	class="ssentio-carousel"
	aria-roledescription="carousel"
	aria-label={label}
>
	{#if emblaAction}
		<div class="ssentio-carousel__viewport" bind:this={viewport} use:emblaAction={options}>
			<div class="ssentio-carousel__container">{@render children()}</div>
		</div>
	{:else}
		<div class="ssentio-carousel__viewport ssentio-carousel__viewport--native" bind:this={viewport}>
			<div class="ssentio-carousel__container">{@render children()}</div>
		</div>
	{/if}

	<div class="ssentio-carousel__nav">
		<button
			type="button"
			class="ssentio-carousel__btn"
			style="min-width:{targetPx}px;min-height:{targetPx}px"
			aria-label="Previous slide"
			onclick={() => scrollByPage(-1)}
		>‹</button>
		<button
			type="button"
			class="ssentio-carousel__btn"
			style="min-width:{targetPx}px;min-height:{targetPx}px"
			aria-label="Next slide"
			onclick={() => scrollByPage(1)}
		>›</button>
	</div>
</section>

<style>
	.ssentio-carousel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.ssentio-carousel__viewport {
		overflow: hidden;
	}

	.ssentio-carousel__viewport--native {
		overflow-x: auto;
		scroll-snap-type: x mandatory;
	}

	.ssentio-carousel__container {
		display: flex;
		gap: 0.5rem;
	}

	.ssentio-carousel__nav {
		display: flex;
		gap: 0.5rem;
	}

	.ssentio-carousel__btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
</style>
