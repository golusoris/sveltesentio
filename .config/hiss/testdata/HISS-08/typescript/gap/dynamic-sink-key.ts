// What remains after const resolution: a key that is not statically knowable.
//
// `prop` here is a parameter, so nothing can say which property is assigned
// without running the program. The rule leaves it unresolved by design —
// guessing safe would hide an injection, and guessing unsafe would report every
// computed property assignment in the codebase and train people to disable the
// rule. The same applies to a `let` reassigned between its initialiser and the
// sink.
export function render(host: HTMLElement, prop: string, raw: string): void {
	host[prop] = raw;
}
