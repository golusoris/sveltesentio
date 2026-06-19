import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const lookupSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "A §2 principle id ('2.4', '§2.4') or a keyword to match against section titles and bodies (e.g. 'runes', 'owasp', 'testing')."
    )
};

interface Section {
  /** Numeric id without the leading section, e.g. '2.4'. */
  id: string;
  /** Full heading line without the leading '## ', e.g. '§2.4 Svelte 5 runes-first'. */
  title: string;
  /** Section body including its heading line. */
  body: string;
}

const HEADING = /^##\s+§(\d+\.\d+)\s+(.*)$/;

/** Split principles.md into its `## §N.M Title` sections, in document order. */
export function parseSections(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const sections: Section[] = [];
  let current: Section | undefined;

  for (const line of lines) {
    const match = HEADING.exec(line);
    if (match) {
      const id = match[1] ?? '';
      const title = `§${id} ${match[2] ?? ''}`.trimEnd();
      current = { id, title, body: line };
      sections.push(current);
    } else if (current) {
      current.body += `\n${line}`;
    }
  }

  return sections.map((s) => ({ ...s, body: s.body.replace(/\s+$/, '') }));
}

/** Normalise an id query to bare 'N.M' form, or undefined if not id-shaped. */
function asId(query: string): string | undefined {
  const cleaned = query.trim().replace(/^§/, '');
  return /^\d+\.\d+$/.test(cleaned) ? cleaned : undefined;
}

/** Keyword-rank sections by hits in title (3×) and body (1×). */
function rankByKeyword(sections: Section[], query: string): Section[] {
  const needle = query.toLowerCase();
  const scored = sections
    .map((section) => {
      const titleHit = section.title.toLowerCase().includes(needle) ? 3 : 0;
      const bodyHit = section.body.toLowerCase().includes(needle) ? 1 : 0;
      return { section, score: titleHit + bodyHit };
    })
    .filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score || (a.section.id < b.section.id ? -1 : 1));
  return scored.map((s) => s.section);
}

export function registerPrincipleLookupTool(server: McpServer, rootDir: string): void {
  const principlesPath = join(rootDir, 'docs', 'principles.md');

  server.tool(
    'principle_lookup',
    'Look up a single §2 coding-contract principle from docs/principles.md by id (e.g. "2.4") or keyword (e.g. "runes"). Returns the matching section verbatim.',
    lookupSchema,
    async ({ query }) => {
      const markdown = await readFile(principlesPath, 'utf8');
      const sections = parseSections(markdown);

      const id = asId(query);
      if (id) {
        const hit = sections.find((s) => s.id === id);
        if (!hit) {
          const ids = sections.map((s) => `§${s.id}`).join(', ');
          return {
            content: [
              {
                type: 'text',
                text: `No principle §${id} in docs/principles.md. Available: ${ids}`
              }
            ],
            isError: true
          };
        }
        return { content: [{ type: 'text', text: hit.body }] };
      }

      const ranked = rankByKeyword(sections, query);
      if (ranked.length === 0) {
        const ids = sections.map((s) => `§${s.id}`).join(', ');
        return {
          content: [
            {
              type: 'text',
              text: `No principle matched '${query}'. Available sections: ${ids}`
            }
          ],
          isError: true
        };
      }

      const best = ranked[0];
      if (!best) {
        return {
          content: [{ type: 'text', text: `No principle matched '${query}'.` }],
          isError: true
        };
      }

      const others = ranked.slice(1, 4).map((s) => s.title);
      const footer =
        others.length > 0 ? `\n\n---\nOther matches: ${others.join(' · ')}` : '';
      return { content: [{ type: 'text', text: best.body + footer }] };
    }
  );
}
