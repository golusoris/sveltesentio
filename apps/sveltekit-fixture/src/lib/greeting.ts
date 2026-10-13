/**
 * The greeting the fixture page renders. A blank or whitespace-only name falls
 * back to "world".
 * @param name - The name to greet.
 * @returns The greeting text.
 */
export function greeting(name: string): string {
	const trimmed = name.trim();
	return `Hello, ${trimmed === '' ? 'world' : trimmed}!`;
}
