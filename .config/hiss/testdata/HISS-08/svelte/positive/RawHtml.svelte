<!-- `{@html}` is the Svelte innerHTML boundary: unsanitised markup from a prop
     reaches the DOM. Reported by svelte/no-at-html-tags, confirmed on. -->
<script lang="ts">
	let { markup = '' }: { markup?: string } = $props();
</script>

{@html markup}
