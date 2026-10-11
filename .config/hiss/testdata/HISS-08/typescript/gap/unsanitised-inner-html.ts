// The other half of HISS-08 in TypeScript: unsanitised markup reaching the DOM.
// The invariant requires DOMPurify at every innerHTML boundary, and
// `@sveltesentio/no-unsanitised-html` reports this assignment.
//
// Filed under gap/ although a gate refuses it: the coverage catalog allows one
// decider per rule and language, the engine scanner is that decider since it
// reads TypeScript, and the scanner stays silent here (cordanaLLM/praetor#1241).
export function render(host: HTMLElement, markup: string): void {
	host.innerHTML = markup;
}
