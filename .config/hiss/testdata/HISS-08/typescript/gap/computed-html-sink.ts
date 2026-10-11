// An HTML sink reached through bracket notation. `@sveltesentio/no-unsanitised-html`
// used to skip every computed member, so rewriting `host.innerHTML` as
// `host['innerHTML']` silently disabled the XSS guard without a disable comment.
// A string-literal key is exactly as statically known as a dot access, so it is
// now resolved and reported.
//
// Filed under gap/ although a gate refuses it: the coverage catalog allows one
// decider per rule and language, the engine scanner is that decider since it
// reads TypeScript, and the scanner stays silent here (cordanaLLM/praetor#1241).
export function render(host: HTMLElement, raw: string): void {
	host['innerHTML'] = raw;
}
