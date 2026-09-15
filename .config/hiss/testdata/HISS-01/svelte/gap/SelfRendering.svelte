<!-- A component that renders itself: the component graph is not a DAG. Nothing
     reports it; svelte/valid-compile covers compiler diagnostics, not the graph. -->
<script lang="ts">
	import Self from './SelfRendering.svelte';
	let { depth = 0 }: { depth?: number } = $props();
</script>

{#if depth > 0}
	<Self depth={depth - 1} />
{/if}
