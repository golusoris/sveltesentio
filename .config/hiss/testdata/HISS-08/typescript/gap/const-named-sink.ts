// An HTML sink named through a `const`, and a value sanitised a line earlier.
//
// Both used to sit on the wrong side of the rule: `host[prop]` with a const key
// went unreported, and a value from `sanitizeHtml` arriving as a plain
// identifier was reported as though it were raw. A `const` assigned once is as
// statically known as the expression itself, so the rule resolves one hop.
//
// The assignment below is reported; the sanitised one on the next function is
// not.
//
// Filed under gap/ although a gate refuses it: the coverage catalog allows one
// decider per rule and language, the engine scanner is that decider since it
// reads TypeScript, and the scanner stays silent here (cordanaLLM/praetor#1241).
export function unsafe(host: HTMLElement, raw: string): void {
	const prop = 'innerHTML';
	host[prop] = raw;
}

export function safe(host: HTMLElement, raw: string): void {
	const clean = sanitizeHtml(raw);
	host.innerHTML = clean;
}

declare function sanitizeHtml(value: string): string;
