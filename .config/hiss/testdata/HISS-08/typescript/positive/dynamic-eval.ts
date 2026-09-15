// Dynamic execution of a runtime-built string. Reported since this repository
// enabled `no-eval`, `no-new-func` and `no-implied-eval` over packages/*/src,
// which was free: zero violations existed in shipped source.
//
// This file was a gap fixture when the catalog was first written and moved here
// when the rules were turned on — the catalog is updated the day coverage
// changes, in either direction.
export function run(expression: string): unknown {
	return eval(expression);
}

export function build(body: string): () => unknown {
	return new Function(`return (${body});`) as () => unknown;
}

export function deferred(code: string): void {
	setTimeout(code, 0);
}
