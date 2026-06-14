import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerComposeResource(server: McpServer, rootDir: string): void {
  const composeDir = join(rootDir, 'docs', 'compose');

  server.resource('compose-index', 'compose://index', async (uri) => {
    const files = (await readdir(composeDir)).filter((f) => f.endsWith('.md')).sort();
    const text = files.map((f) => `- ${f.replace(/\.md$/, '')}`).join('\n');
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
  });

  server.resource(
    'compose',
    new ResourceTemplate('compose://{slug}', { list: undefined }),
    async (uri, { slug }) => {
      const name = Array.isArray(slug) ? slug[0] : slug;
      if (typeof name !== 'string' || name.includes('/') || name.includes('..')) {
        throw new Error(`Invalid compose slug: ${String(slug)}`);
      }
      const path = join(composeDir, `${name}.md`);
      const text = await readFile(path, 'utf8');
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    }
  );
}
