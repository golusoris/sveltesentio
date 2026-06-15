import { describe, it, expect } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import {
	createDemoClient,
	fetchItem,
	prefetchItemPage,
	sentioApiClientThrowsProblem,
} from '../src/server-prefetch.js';
import type { Item } from '../src/server-prefetch.js';

/** A fetch stub returning a JSON item for `/items/{id}`. */
function okFetch(item: Item): typeof globalThis.fetch {
	return (() =>
		Promise.resolve(
			new Response(JSON.stringify(item), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		));
}

/** A fetch stub returning an RFC 9457 problem document. */
function problemFetch(): typeof globalThis.fetch {
	return (() =>
		Promise.resolve(
			new Response(
				JSON.stringify({ type: 'https://err/not-found', title: 'No such item', status: 404 }),
				{ status: 404, headers: { 'content-type': 'application/problem+json' } },
			),
		));
}

describe('api + query SSR prefetch composition', () => {
	it('the typed api client resolves data through fetchItem', async () => {
		const item: Item = { id: '42', title: 'Widget' };
		const client = createDemoClient('https://api.test', okFetch(item));
		await expect(fetchItem(client, '42')).resolves.toEqual(item);
	});

	it('the api client throws core ProblemError on application/problem+json', async () => {
		const client = createDemoClient('https://api.test', problemFetch());
		await expect(fetchItem(client, 'missing')).rejects.toBeInstanceOf(ProblemError);
	});

	it('serverPrefetch dehydrates the prefetched item for hydration', async () => {
		const item: Item = { id: '7', title: 'Gadget' };
		const client = createDemoClient('https://api.test', okFetch(item));
		const { dehydratedState } = await prefetchItemPage(client, '7');
		expect(dehydratedState.queries).toHaveLength(1);
		const [query] = dehydratedState.queries;
		expect(query?.queryKey).toEqual(['items', '7']);
		expect(query?.state.data).toEqual(item);
	});

	it('does NOT dehydrate a failed (problem) prefetch — TanStack default', async () => {
		// Integration finding: `serverPrefetch` swallows the rejection (prefetchQuery
		// never throws) and TanStack's default `shouldDehydrateQuery` excludes
		// errored queries, so a problem prefetch yields an EMPTY dehydrated state.
		// The client refetches on mount rather than hydrating the error.
		const client = createDemoClient('https://api.test', problemFetch());
		const { dehydratedState } = await prefetchItemPage(client, 'missing');
		expect(dehydratedState.queries).toHaveLength(0);
	});

	it('the @sveltesentio/api createClient export throws ProblemError on problem+json', async () => {
		const api = sentioApiClientThrowsProblem(problemFetch());
		await expect(api.GET('/ping')).rejects.toBeInstanceOf(ProblemError);
	});
});
