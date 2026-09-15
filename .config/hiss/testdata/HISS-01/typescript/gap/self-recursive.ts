// Directly self-recursive: the call graph is not a DAG. Nothing in this
// repository reports it — no rule checks recursion, and praetor's HISS scanner
// does not read .ts.
export function countdown(n: number): number {
	if (n <= 0) return 0;
	return countdown(n - 1);
}
