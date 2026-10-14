export class Counter {
	count = $state(0);
	readonly double = $derived(this.count * 2);
}
