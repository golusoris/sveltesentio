import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerAdrResource(server: McpServer, rootDir: string): void {
  const adrDir = join(rootDir, 'docs', 'adr');

  server.resource('adr-index', 'adr://index', async (uri) => {
    const text = await readFile(join(adrDir, 'README.md'), 'utf8');
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
  });

  server.resource(
    'adr',
    new ResourceTemplate('adr://{number}', { list: undefined }),
    async (uri, { number }) => {
      const padded = String(number).padStart(4, '0');
      const files = await readdir(adrDir);
      const match = files.find((f) => f.startsWith(`${padded}-`) && f.endsWith('.md'));
      if (!match) {
        throw new Error(`ADR ${padded} not found`);
      }
      const text = await readFile(join(adrDir, match), 'utf8');
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    }
  );
}
