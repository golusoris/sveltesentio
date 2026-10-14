// Vite does not expand a template import through the #lib subpath import, so
// the documents are listed with import.meta.glob, as docs/compose/markdown.md does.
const docs = import.meta.glob<string>('/src/lib/docs/*.md', { query: '?raw', import: 'default' });

export const entries = (): { slug: string }[] => [{ slug: 'intro' }];

export async function load({ params }: { params: { slug: string } }): Promise<{ raw: string }> {
	const read = docs[`/src/lib/docs/${params.slug}.md`];
	if (!read) throw new Error(`no document ${params.slug}`);
	return { raw: await read() };
}
