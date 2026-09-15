// The remaining half of HISS-08 in TypeScript: unsanitised markup reaching the
// DOM. The invariant requires DOMPurify at every innerHTML boundary, and no rule
// checks it in a .ts file — svelte/no-at-html-tags covers only `{@html}` inside
// a component.
export function render(host: HTMLElement, markup: string): void {
	host.innerHTML = markup;
}
