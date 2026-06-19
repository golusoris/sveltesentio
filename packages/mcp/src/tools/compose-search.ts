import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const searchSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "Keywords to search compose recipes for (e.g. 'oidc session cookie'). Whitespace-separated terms are matched case-insensitively against each recipe's slug and body."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('Maximum number of matching recipes to return (default 10).')
};

interface Match {
  slug: string;
  score: number;
  snippet: string;
}

/** Split a query into lowercased, de-duplicated, non-empty terms. */
function terms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
}

/** Count non-overlapping occurrences of `needle` in `haystack` (both lowercased). */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) {
      break;
    }
    count += 1;
    from = at + needle.length;
  }
  return count;
}

/** First body line containing any query term, trimmed; empty string if none. */
function firstHitLine(body: string, words: string[]): string {
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }
    const lower = line.toLowerCase();
    if (words.some((w) => lower.includes(w))) {
      return line.length > 160 ? `${line.slice(0, 157)}...` : line;
    }
  }
  return '';
}

/** Score one recipe: slug hits weigh 5×, body hits 1× each; 0 means no match. */
function scoreRecipe(slug: string, body: string, words: string[]): Match | undefined {
  const slugLower = slug.toLowerCase();
  const bodyLower = body.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (slugLower.includes(word)) {
      score += 5;
    }
    score += countOccurrences(bodyLower, word);
  }
  if (score === 0) {
    return undefined;
  }
  return { slug, score, snippet: firstHitLine(body, words) };
}

export function registerComposeSearchTool(server: McpServer, rootDir: string): void {
  const composeDir = join(rootDir, 'docs', 'compose');

  server.tool(
    'compose_search',
    'Full-text search across docs/compose/*.md recipes by keyword. Returns matching recipe slugs ranked by relevance, each with a one-line snippet. Read a full recipe via the compose://<slug> resource.',
    searchSchema,
    async ({ query, limit }) => {
      const words = terms(query);
      const files = (await readdir(composeDir)).filter((f) => f.endsWith('.md'));

      const bodies = await Promise.all(
        files.map(async (file) => ({
          slug: file.replace(/\.md$/, ''),
          body: await readFile(join(composeDir, file), 'utf8')
        }))
      );

      const matches: Match[] = [];
      for (const { slug, body } of bodies) {
        const match = scoreRecipe(slug, body, words);
        if (match) {
          matches.push(match);
        }
      }

      matches.sort((a, b) => b.score - a.score || (a.slug < b.slug ? -1 : 1));
      const top = matches.slice(0, limit ?? 10);

      if (top.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No compose recipes matched '${query}'. Browse all recipes via the compose://index resource.`
            }
          ]
        };
      }

      const lines = top.map((m) => {
        const head = `- compose://${m.slug} (score ${m.score})`;
        return m.snippet ? `${head}\n  ${m.snippet}` : head;
      });
      const header = `# compose_search: '${query}' — ${top.length} of ${matches.length} match(es)\n\n`;

      return { content: [{ type: 'text', text: header + lines.join('\n') }] };
    }
  );
}
