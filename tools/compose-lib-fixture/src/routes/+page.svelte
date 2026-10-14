<script lang="ts">
	import { greeting } from '#lib/greeting.js';
	import { greeting as viaIndex } from '#lib';
	import { label } from '#lib/components/ui/button/index.js';
	import { Counter } from '#lib/state/counter.svelte.js';
	import Widget from '#lib/Widget.svelte';

	let { data }: { data: { text: string; secretLength: number } } = $props();
	const counter = new Counter();
	counter.count = 2;
</script>

<p>
	{greeting('page')}
	{viaIndex('index')}
	{label}
	{data.text}
	{counter.double}
	{data.secretLength}
</p>
<Widget text="widget" />
