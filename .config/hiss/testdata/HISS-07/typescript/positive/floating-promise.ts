// A promise neither awaited nor handled. Reported by
// @typescript-eslint/no-floating-promises, which print-config confirms is on.
export function save(write: () => Promise<void>): void {
	write();
}
