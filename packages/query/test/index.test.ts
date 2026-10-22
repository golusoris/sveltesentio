import { describe, it, expect } from 'vitest';

const index = (await import('../src/index.js')) as Record<string, unknown>;

describe('@sveltesentio/query index — optional-peer-free surface (issue #175)', () => {
	it('re-exports the client-agnostic wrappers', () => {
		for (const name of [
			'createQueryClient',
			'isRetryableProblem',
			'createSentioQuery',
			'createQueryInvalidator',
			'createInfiniteItems',
			'flattenPages',
			'createSentioMutation',
			'useOptimistic',
			'serverPrefetch',
		]) {
			expect(index).toHaveProperty(name);
		}
	});

	it('does NOT re-export the ConnectRPC bridge — it imports the optional peers', () => {
		// Re-exporting these here drags @connectrpc/connect + @bufbuild/protobuf
		// into every index import and breaks openapi-fetch-only builds. They stay
		// behind the `./connect` subpath so ConnectRPC users opt in explicitly.
		for (const name of [
			'useConnectQuery',
			'createConnectQuery',
			'connectQueryOptions',
			'connectErrorToProblem',
		]) {
			expect(index).not.toHaveProperty(name);
		}
	});
});
