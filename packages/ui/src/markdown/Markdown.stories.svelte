<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Markdown from './Markdown.svelte';

  const SAMPLE = `# Release notes

**sveltesentio** renders _untrusted_ markdown through a single audited XSS
boundary (ADR-0026): \`marked\` parses, then \`DOMPurify\` sanitises.

- Safe inline \`code\`
- [A link](https://example.com)
- A list item with **bold** and _italic_

\`\`\`ts
const html = renderMarkdown(source);
\`\`\`

> Block quotes render too.
`;

  const { Story } = defineMeta({
    title: 'ui/markdown/Markdown',
    component: Markdown,
    tags: ['autodocs'],
    argTypes: {
      source: { control: 'text' },
      gfm: { control: 'boolean' },
      'aria-label': { control: 'text' },
    },
    args: {
      source: SAMPLE,
    },
  });
</script>

<!-- Rendered, sanitised markdown — the common case. -->
<Story name="Rendered" args={{ source: SAMPLE }} />

<!-- A labelled region exposes the content as a named group to assistive tech. -->
<Story
  name="Labelled region"
  args={{ source: '## Changelog\n\nAll notable changes.', 'aria-label': 'Changelog' }}
/>

<!--
	XSS hardening: the `<script>` and `onerror` payloads are STRIPPED by DOMPurify,
	so only the safe text/heading survives. This story proves the sanitiser sink.
-->
<Story
  name="Sanitised XSS"
  args={{
    source:
      '# Safe heading\n\n<script>alert(1)</' +
      'script>\n\n<img src=x onerror="alert(2)">\n\nText after.',
  }}
/>
