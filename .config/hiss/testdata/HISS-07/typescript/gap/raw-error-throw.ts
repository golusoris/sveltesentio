// The remaining half of HISS-07: the invariant requires every error to flow
// through `@sveltesentio/core/errors` as an RFC 9457 ProblemDetails. Throwing a
// bare Error from package code violates it and nothing reports that — the
// routing is upheld by review, not by a rule.
export function parsePort(raw: string): number {
	const port = Number(raw);
	if (!Number.isInteger(port)) {
		throw new Error(`not a port: ${raw}`);
	}
	return port;
}
