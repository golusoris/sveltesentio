// `!` discards the undefined case that noUncheckedIndexedAccess introduced.
// HISS-07 bans unchecked errors, but @typescript-eslint/no-non-null-assertion
// prints as OFF, so this is unreported.
export function firstOrThrow(items: readonly string[]): string {
	return items[0]!;
}
