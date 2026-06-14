import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerComplianceResource(server: McpServer, rootDir: string): void {
  const complianceDir = join(rootDir, 'docs', 'compliance');

  server.resource('compliance-index', 'compliance://index', async (uri) => {
    const files = (await readdir(complianceDir)).filter((f) => f.endsWith('.md')).sort();
    const text = files.map((f) => `- ${f.replace(/\.md$/, '')}`).join('\n');
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
  });

  server.resource(
    'compliance',
    new ResourceTemplate('compliance://{slug}', { list: undefined }),
    async (uri, { slug }) => {
      const name = Array.isArray(slug) ? slug[0] : slug;
      if (typeof name !== 'string' || name.includes('/') || name.includes('..')) {
        throw new Error(`Invalid compliance slug: ${String(slug)}`);
      }
      const path = join(complianceDir, `${name}.md`);
      const text = await readFile(path, 'utf8');
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    }
  );
}
