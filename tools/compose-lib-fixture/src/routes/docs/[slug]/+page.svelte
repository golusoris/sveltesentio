<script lang="ts">
	let { data }: { data: { raw: string } } = $props();
</script>

<pre>{data.raw}</pre>
