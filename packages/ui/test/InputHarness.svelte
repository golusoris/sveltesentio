<!--
Test harness wrapping Input.svelte with an associated <label> so the field has an
accessible name (label association is the caller's responsibility — see the
Input component docs). Forwards `invalid` + bindable `value` for the assertions.
-->
<script lang="ts">
	import Input from '../src/input/Input.svelte';

	interface Props {
		value?: string;
		invalid?: boolean;
		placeholder?: string;
	}

	let { value = $bindable(''), invalid = false, placeholder }: Props = $props();
</script>

<label for="harness-input">Email</label>
<Input id="harness-input" bind:value {invalid} {placeholder} />
