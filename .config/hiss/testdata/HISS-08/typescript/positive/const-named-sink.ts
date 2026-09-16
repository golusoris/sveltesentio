// An HTML sink named through a `const`, and a value sanitised a line earlier.
//
// Both used to sit on the wrong side of the rule: `host[prop]` with a const key
// went unreported, and a value from `sanitizeHtml` arriving as a plain
// identifier was reported as though it were raw. A `const` assigned once is as
// statically known as the expression itself, so the rule resolves one hop.
//
// The assignment below is reported; the sanitised one on the next function is
// not.
export function unsafe(host: HTMLElement, raw: string): void {
	const prop = 'innerHTML';
	host[prop] = raw;
}

export function safe(host: HTMLElement, raw: string): void {
	const clean = sanitizeHtml(raw);
	host.innerHTML = clean;
}

declare function sanitizeHtml(value: string): string;
