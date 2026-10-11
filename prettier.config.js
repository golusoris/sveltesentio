/** @type {import('prettier').Config} */
export default {
	printWidth: 100,
	// The repository is tab-indented: 381 of 475 source files under packages/,
	// apps/ and scripts/ lead with tabs against 77 leading with spaces. The config
	// previously said spaces, so 80% of the tree was non-conformant by
	// configuration rather than by neglect -- and the pre-commit hook rewriting
	// tabs to spaces turned one ~20-line change into 1351 insertions, which is why
	// its glob had to be narrowed to data and prose.
	//
	// Tabs also let a reader choose their own indentation width, which matters for
	// the WCAG 2.2 AA posture this repository holds itself to.
	useTabs: true,
	tabWidth: 2,
	singleQuote: true,
	trailingComma: 'all',
	semi: true,
	plugins: ['prettier-plugin-svelte'],
	overrides: [
		{
			files: '*.svelte',
			options: {
				parser: 'svelte',
			},
		},
		{
			// Code samples inside Markdown are indented with spaces. The documentation
			// gate lints Markdown with markdownlint's default rule set, whose MD010
			// refuses a hard tab anywhere in a document, fenced code included, and
			// Prettier formats embedded code with the options of the Markdown file
			// around it. Source files keep tabs.
			files: ['*.md', '*.mdx'],
			options: {
				useTabs: false,
			},
		},
	],
};
