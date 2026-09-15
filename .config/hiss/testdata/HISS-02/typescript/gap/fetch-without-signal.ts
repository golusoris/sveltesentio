// I/O with no timeout: no AbortSignal, so this request can hang indefinitely.
// HISS-02 requires an explicit timeout on all I/O; no rule enforces it.
export async function loadProfile(url: string): Promise<unknown> {
	const response = await fetch(url);
	return response.json();
}
