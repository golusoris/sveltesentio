<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Image from './Image.svelte';
	import type { LqipPlaceholder } from './lqip.js';

	// No heavy peer here: <Image> composes the pure srcset/sizes + LQIP helpers.
	// Stories supply a sample `src` plus intrinsic `width`/`height` so the box
	// reserves layout space (CLS < 0.1) and exercise the blur-up placeholder.
	const SAMPLE_SRC =
		'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg';

	// A 1x1 blurred data-URI LQIP; the blur-up layer fades out on full-image load.
	const blurPlaceholder: LqipPlaceholder = {
		src: 'data:image/gif;base64,R0lGODlhAQABAIAAAMLDxwAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
		color: '#1f2937',
	};
	const colorPlaceholder: LqipPlaceholder = { color: '#334155' };

	const { Story } = defineMeta({
		title: 'media/Image',
		component: Image,
		tags: ['autodocs'],
		argTypes: {
			priority: { control: 'inline-radio', options: ['auto', 'high'] },
			width: { control: { type: 'number', min: 16, max: 4096, step: 16 } },
			height: { control: { type: 'number', min: 16, max: 4096, step: 16 } },
			alt: { control: 'text' },
			src: { control: 'text' },
		},
		args: {
			src: SAMPLE_SRC,
			alt: 'Big Buck Bunny still frame',
			width: 1280,
			height: 720,
		},
	});
</script>

<!-- Basic responsive image with a reserved 16:9 aspect ratio (no placeholder). -->
<Story
	name="Default"
	args={{ src: SAMPLE_SRC, alt: 'Big Buck Bunny still frame', width: 1280, height: 720 }}
/>

<!-- Blur-up LQIP: the data-URI placeholder fades out once the full image loads. -->
<Story
	name="Blur-up LQIP"
	args={{
		src: SAMPLE_SRC,
		alt: 'Big Buck Bunny still frame',
		width: 1280,
		height: 720,
		placeholder: blurPlaceholder,
	}}
/>

<!-- Colour-only placeholder fills the reserved box before the image decodes. -->
<Story
	name="Colour placeholder"
	args={{
		src: SAMPLE_SRC,
		alt: 'Big Buck Bunny still frame',
		width: 1280,
		height: 720,
		placeholder: colorPlaceholder,
	}}
/>

<!-- Above-the-fold hero: priority="high" eager-loads with fetchpriority="high". -->
<Story
	name="Priority hero"
	args={{
		src: SAMPLE_SRC,
		alt: 'Hero banner',
		width: 1280,
		height: 720,
		priority: 'high',
		widths: [640, 960, 1280],
		template: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg?w={w}',
	}}
/>
