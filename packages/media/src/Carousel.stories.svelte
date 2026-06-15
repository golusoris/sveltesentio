<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Carousel from './Carousel.svelte';

	// `embla-carousel-svelte` is an OPTIONAL peer and is NOT installed in this
	// Storybook workspace, so `emblaAction` is intentionally omitted: the shell
	// degrades to a native CSS scroll-snap region that still renders, keyboards,
	// and passes axe. `children` is a required Snippet, so each Story renders the
	// component with a slides snippet wired in (see the ui VirtualList harness).
	const slides = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed'];

	const { Story } = defineMeta({
		title: 'media/Carousel',
		component: Carousel,
		tags: ['autodocs'],
		argTypes: {
			preset: { control: 'inline-radio', options: ['desktop', 'handheld', 'tv'] },
			loop: { control: 'boolean' },
			align: { control: 'inline-radio', options: ['start', 'center', 'end'] },
			orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] },
			dragFree: { control: 'boolean' },
		},
		args: {
			label: 'Featured items',
			preset: 'desktop',
		},
	});
</script>

{#snippet sampleSlides()}
	{#each slides as color, i (color)}
		<div
			style:flex="0 0 80%"
			style:scroll-snap-align="start"
			style:min-width="0"
			style:height="180px"
			style:display="flex"
			style:align-items="center"
			style:justify-content="center"
			style:border-radius="0.5rem"
			style:background={color}
			style:color="#fff"
			style:font-size="1.5rem"
		>
			<a href="#slide-{i + 1}" style:color="#fff">Slide {i + 1}</a>
		</div>
	{/each}
{/snippet}

<!-- Default desktop preset; native scroll-snap fallback (no embla peer). -->
<Story name="Default">
	<div style:max-width="480px">
		<Carousel label="Featured items">
			{@render sampleSlides()}
		</Carousel>
	</div>
</Story>

<!-- Handheld preset upgrades nav buttons to a 44px WCAG 2.5.8 target. -->
<Story name="Handheld preset">
	<div style:max-width="480px">
		<Carousel label="Featured items (handheld)" preset="handheld">
			{@render sampleSlides()}
		</Carousel>
	</div>
</Story>

<!-- TV / 10-foot preset; also 44px targets for reach + remote navigation. -->
<Story name="TV preset">
	<div style:max-width="480px">
		<Carousel label="Featured items (tv)" preset="tv" loop align="center">
			{@render sampleSlides()}
		</Carousel>
	</div>
</Story>
