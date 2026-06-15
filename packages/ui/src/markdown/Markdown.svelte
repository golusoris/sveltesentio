<!--
@component
Markdown — renders untrusted markdown through the framework's XSS boundary
(ADR-0026). `source` is parsed by `marked` and sanitised by `DOMPurify` with the
hardened allowlist in `renderMarkdown`; the resulting SAFE string is the only
value reaching `{@html}`. There is no unsanitised path: replace any direct
`marked.parse()` + `{@html}` with this component (see
docs/migrations/downstream-antipatterns-v0.1.md — revenge/arca).

Works under SSR (jsdom-backed sanitiser) and in the browser. The tested logic
lives in `./sanitize.ts`; this file is a thin, a11y-correct view.
-->
<script lang="ts">
	import { renderMarkdown, type RenderMarkdownOptions } from './sanitize.js';

	interface Props extends RenderMarkdownOptions {
		/** Untrusted markdown to render. */
		source: string;
		/** Class applied to the wrapper element. */
		class?: string;
		/** Accessible label; when set the region is exposed as a labelled group. */
		'aria-label'?: string;
	}

	let {
		source,
		class: className,
		'aria-label': ariaLabel,
		config,
		window: win,
		gfm,
	}: Props = $props();

	// Sanitised on every render — DOMPurify is fast and correctness beats caching.
	const html = $derived(renderMarkdown(source, { config, window: win, gfm }));
</script>

<!--
	svelte-ignore: `html` is the output of renderMarkdown, which always runs
	DOMPurify.sanitize with the hardened allowlist. This is the single audited
	`{@html}` sink for runtime markdown.
-->
<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<div class={className} aria-label={ariaLabel}>{@html html}</div>
