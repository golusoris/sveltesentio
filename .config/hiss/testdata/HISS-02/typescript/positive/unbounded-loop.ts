// No scalar upper bound: the loop is governed by a runtime condition only.
// HISS-02 requires a compile-time ceiling. The engine scanner reports the
// `while (true)`; no ESLint rule does.
export function drain(queue: string[]): string[] {
	const out: string[] = [];
	while (true) {
		const next = queue.pop();
		if (next === undefined) break;
		out.push(next);
	}
	return out;
}
