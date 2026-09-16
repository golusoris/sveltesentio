// An HTML sink reached through bracket notation. `@sveltesentio/no-unsanitised-html`
// used to skip every computed member, so rewriting `host.innerHTML` as
// `host['innerHTML']` silently disabled the XSS guard without a disable comment.
// A string-literal key is exactly as statically known as a dot access, so it is
// now resolved and reported.
export function render(host: HTMLElement, raw: string): void {
	host['innerHTML'] = raw;
}
