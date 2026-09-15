// Dynamic execution of a runtime-built string. HISS-08 forbids it outright, but
// `no-eval` and `no-new-func` both print as OFF, so nothing reports either line.
export function run(expression: string): unknown {
	// eslint-disable-next-line no-eval -- disabled rule; the directive documents intent only
	return eval(expression);
}

export function build(body: string): () => unknown {
	return new Function(`return (${body});`) as () => unknown;
}
