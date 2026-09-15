<!-- A component script function at complexity 11, reported by the same
     `complexity` entry because it matches packages/*/src/**/*.svelte. -->
<script lang="ts">
	let { n = 0, flags = [] }: { n?: number; flags?: readonly boolean[] } = $props();

	function label(): string {
		if (n < 0) return 'negative';
		if (n === 0) return 'zero';
		if (n < 10) return 'small';
		if (n < 100) return 'medium';
		if (n < 1000) return 'large';
		if (flags[0]) return 'flag0';
		if (flags[1]) return 'flag1';
		if (flags[2]) return 'flag2';
		if (flags[3]) return 'flag3';
		if (flags[4]) return 'flag4';
		return 'other';
	}
</script>

<span>{label()}</span>
