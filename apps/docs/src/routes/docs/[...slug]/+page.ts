import { error } from '@sveltejs/kit';
import { allSlugs, docBySlug } from '$lib/docs';
import type { EntryGenerator, PageLoad } from './$types';

export const entries: EntryGenerator = () => allSlugs().map((slug) => ({ slug }));

// Typed as PageLoad so `params` is the route's own shape. Without the annotation
// `params` is `any`, which silently removed type-checking from `params.slug`.
export const load: PageLoad = async ({ params }) => {
	const entry = docBySlug(params.slug);
	if (!entry) {
		// SvelteKit 2's `error()` returns `never` and throws internally, so `throw`
		// is the SvelteKit 1 idiom and reads as throwing a non-Error value.
		error(404, `No doc for "${params.slug}"`);
	}
	const mod = await entry.load();
	return {
		title: entry.title,
		component: mod.default,
	};
};
