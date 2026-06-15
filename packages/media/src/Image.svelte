<!--
@component
Image — a responsive, blur-up (LQIP) image wrapper. No heavy dependency: it
composes the pure `./image` `srcset` / `sizes` builders and the `./lqip` style
helpers. A tiny blurred placeholder (or solid colour) fills the box to reserve
layout space (CLS < 0.1); when the full image finishes loading the placeholder
fades out. Above-the-fold heroes pass `priority="high"` for eager
`fetchpriority="high"` loading (LCP < 2.5 s).

`alt` is required (WCAG 1.1.1) — decorative images pass `alt=""` explicitly.
The tested logic lives in `./image` + `./lqip`; this file is a thin view.
-->
<script lang="ts">
	import {
		buildResponsiveImage,
		type SizesRule,
		type SrcWidthTemplate,
	} from './image.js';
	import {
		buildPlaceholderStyle,
		resolveAspectRatio,
		imageLoadingAttrs,
		type LqipPlaceholder,
		type ImageLoadingPriority,
	} from './lqip.js';

	interface Props {
		/** Base image URL. */
		src: string;
		/** Required text alternative (`""` for decorative). */
		alt: string;
		/** Candidate widths for the `srcset`. */
		widths?: readonly number[];
		/** `src`-from-width template (function or `{w}` string). */
		template?: SrcWidthTemplate | string;
		/** `sizes` rules; falls back to `100vw`. */
		sizes?: readonly SizesRule[];
		/** Intrinsic width (px) for the reserved aspect ratio. */
		width?: number;
		/** Intrinsic height (px) for the reserved aspect ratio. */
		height?: number;
		/** Blur-up / colour placeholder. */
		placeholder?: LqipPlaceholder;
		/** `high` for above-the-fold LCP heroes. Default `auto`. */
		priority?: ImageLoadingPriority;
		/** Class on the wrapper element. */
		class?: string;
	}

	const {
		src,
		alt,
		widths = [],
		template,
		sizes,
		width,
		height,
		placeholder,
		priority = 'auto',
		class: className,
	}: Props = $props();

	const attrs = $derived(
		buildResponsiveImage(src, widths, {
			...(template === undefined ? {} : { template }),
			...(sizes === undefined ? {} : { sizes }),
		}),
	);
	const loadingAttrs = $derived(imageLoadingAttrs(priority));
	const placeholderStyle = $derived(buildPlaceholderStyle(placeholder));
	const ratio = $derived(resolveAspectRatio(width, height));

	let loaded = $state(false);
</script>

<div
	class={['ssentio-image', className]}
	style:aspect-ratio={ratio}
>
	{#if placeholderStyle && !loaded}
		<span class="ssentio-image__lqip" style={placeholderStyle} aria-hidden="true"></span>
	{/if}
	<img
		class="ssentio-image__img"
		class:ssentio-image__img--loaded={loaded}
		src={attrs.src}
		srcset={attrs.srcset || undefined}
		sizes={attrs.srcset ? attrs.sizes : undefined}
		{alt}
		{width}
		{height}
		loading={loadingAttrs.loading}
		fetchpriority={loadingAttrs.fetchpriority}
		decoding={loadingAttrs.decoding}
		onload={() => (loaded = true)}
	/>
</div>

<style>
	.ssentio-image {
		position: relative;
		display: block;
		overflow: hidden;
	}

	.ssentio-image__lqip {
		position: absolute;
		inset: 0;
		filter: blur(12px);
		transform: scale(1.05);
	}

	.ssentio-image__img {
		display: block;
		width: 100%;
		height: auto;
		opacity: 0;
		transition: opacity 0.3s ease;
	}

	.ssentio-image__img--loaded {
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.ssentio-image__img {
			transition: none;
		}
	}
</style>
