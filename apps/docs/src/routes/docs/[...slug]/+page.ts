import { error } from '@sveltejs/kit';
import { allSlugs, docBySlug } from '$lib/docs';
import type { EntryGenerator } from './$types';

export const entries: EntryGenerator = () => allSlugs().map((slug) => ({ slug }));

export async function load({ params }) {
  const entry = docBySlug(params.slug);
  if (!entry) {
    throw error(404, `No doc for "${params.slug}"`);
  }
  const mod = await entry.load();
  return {
    title: entry.title,
    component: mod.default,
  };
}
