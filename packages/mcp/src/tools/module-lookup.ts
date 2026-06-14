import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const lookupSchema = {
  name: z
    .string()
    .min(1)
    .describe(
      "Package short name (e.g. 'core', 'ui', 'forms') or full @sveltesentio/<name> form."
    )
};

export function registerModuleLookupTool(server: McpServer, rootDir: string): void {
  const packagesDir = join(rootDir, 'packages');

  server.tool(
    'module_lookup',
    'Return the AGENTS.md and package.json sub-export shape for a sveltesentio package.',
    lookupSchema,
    async ({ name }) => {
      const short = name.replace(/^@sveltesentio\//, '');
      const pkgDir = join(packagesDir, short);

      try {
        await stat(pkgDir);
      } catch {
        const available = (await readdir(packagesDir)).sort().join(', ');
        return {
          content: [
            {
              type: 'text',
              text: `package '${short}' not found under packages/. Available: ${available}`
            }
          ],
          isError: true
        };
      }

      const [agents, pkgJson] = await Promise.all([
        readFile(join(pkgDir, 'AGENTS.md'), 'utf8').catch(() => '(no AGENTS.md)'),
        readFile(join(pkgDir, 'package.json'), 'utf8').catch(() => '{}')
      ]);

      const parsed = JSON.parse(pkgJson) as { exports?: unknown };
      const exportsBlock = JSON.stringify(parsed.exports ?? {}, null, 2);

      return {
        content: [
          {
            type: 'text',
            text: `# @sveltesentio/${short}\n\n## Sub-exports (from package.json)\n\n\`\`\`json\n${exportsBlock}\n\`\`\`\n\n## AGENTS.md\n\n${agents}`
          }
        ]
      };
    }
  );
}
