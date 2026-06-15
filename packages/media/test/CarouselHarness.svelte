<!--
Test-only harness: Carousel requires a `children` snippet for its slides, which
cannot be constructed in plain `.ts`. This wrapper forwards every prop through
and supplies three deterministic, focusable slides the tests assert against.
-->
<script lang="ts">
	import Carousel from '../src/Carousel.svelte';
	import type { CarouselPreset } from '../src/carousel.js';

	interface Props {
		label: string;
		preset?: CarouselPreset;
		loop?: boolean;
	}

	const { label, preset, loop }: Props = $props();
</script>

<Carousel {label} {preset} {loop}>
	{#each [1, 2, 3] as n (n)}
		<a class="slide" href="#slide-{n}" data-testid="slide-{n}">Slide {n}</a>
	{/each}
</Carousel>
