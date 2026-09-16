// Directly self-recursive: the call graph is not a DAG.
// `@sveltesentio/no-recursion` reports it. The rule resolves the call through
// scope analysis rather than by name, so a shadowing inner binding is not
// mistaken for recursion and an arrow bound to a const is still caught.
export function countdown(n: number): number {
	if (n <= 0) return 0;
	return countdown(n - 1);
}
