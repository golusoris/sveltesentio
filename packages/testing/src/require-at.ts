/**
 * Index into a query result, failing loudly when the element is absent.
 *
 * Testing Library's `getAllBy*` helpers return `T[]`, and under
 * `noUncheckedIndexedAccess` every read is `T | undefined`. Optional chaining
 * compiles, but it lets a missing element flow into an assertion as `undefined`,
 * which reports "expected undefined to have attribute…" rather than the fact
 * that the query returned fewer elements than the test assumed.
 *
 * This fails at the point the element was expected, naming the index asked for
 * and the number actually found, so the diagnosis is in the message.
 */
export function requireAt<T>(items: readonly T[], index: number, what = 'element'): T {
	const item = items[index];
	if (item === undefined) {
		throw new Error(
			`expected ${what} at index ${index}, but the query returned ${items.length}`,
		);
	}
	return item;
}
