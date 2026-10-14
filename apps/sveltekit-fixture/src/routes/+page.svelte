<script lang="ts">
	import { greeting } from '#lib/greeting.js';
</script>

<svelte:head>
	<title>SvelteKit fixture</title>
</svelte:head>

<h1>{greeting('sveltesentio')}</h1>
