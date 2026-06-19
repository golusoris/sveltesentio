import type { Component } from 'svelte';

/**
 * Build-time markdown registry.
 *
 * Every `.md` under the repo's `docs/` tree is globbed twice:
 *  - eager `?raw` for title/nav extraction (cheap string work),
 *  - lazy component import for the catch-all route to render on demand.
 *
 * Paths are relative to this file (`apps/docs/src/lib/`), so the repo
 * `docs/` directory sits three levels up.
 */
const rawModules = import.meta.glob('../../../../docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const componentModules = import.meta.glob('../../../../docs/**/*.md') as Record<
  string,
  () => Promise<{ default: Component }>
>;

const DOCS_PREFIX = '../../../../docs/';

/** A single rendered doc page. */
export interface DocEntry {
  /** URL slug, e.g. `principles` or `adr/0001-zod-v4-floor`. */
  slug: string;
  /** Human title pulled from the first `# ` heading (fallback: filename). */
  title: string;
  /** Top-level section: `principles`, `ux`, `adr`, `compliance`, `compose`, `other`. */
  section: DocSection;
  /** Lazy loader for the compiled mdsvex Svelte component. */
  load: () => Promise<{ default: Component }>;
}

export type DocSection = 'principles' | 'ux' | 'adr' | 'compliance' | 'compose' | 'other';

function pathToSlug(filePath: string): string {
  const rel = filePath.slice(DOCS_PREFIX.length);
  return rel.replace(/\.md$/, '');
}

function sectionForSlug(slug: string): DocSection {
  if (slug === 'principles') return 'principles';
  if (slug === 'ux-principles') return 'ux';
  if (slug.startsWith('adr/')) return 'adr';
  if (slug.startsWith('compliance/')) return 'compliance';
  if (slug.startsWith('compose/')) return 'compose';
  return 'other';
}

function extractTitle(raw: string, slug: string): string {
  for (const line of raw.split('\n')) {
    const match = /^#\s+(.+?)\s*$/.exec(line);
    if (match && match[1]) return match[1].replace(/`/g, '');
  }
  const tail = slug.split('/').pop() ?? slug;
  return tail;
}

function buildEntries(): DocEntry[] {
  const entries: DocEntry[] = [];
  for (const [filePath, raw] of Object.entries(rawModules)) {
    const loader = componentModules[filePath];
    if (!loader) continue;
    const slug = pathToSlug(filePath);
    entries.push({
      slug,
      title: extractTitle(raw, slug),
      section: sectionForSlug(slug),
      load: loader,
    });
  }
  entries.sort((a, b) => a.slug.localeCompare(b.slug));
  return entries;
}

const entries = buildEntries();
const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));

/** All doc entries, slug-sorted. */
export function allDocs(): DocEntry[] {
  return entries;
}

/** Lookup one doc by slug, or `undefined`. */
export function docBySlug(slug: string): DocEntry | undefined {
  return bySlug.get(slug);
}

/** Every slug — used to enumerate prerender entries. */
export function allSlugs(): string[] {
  return entries.map((entry) => entry.slug);
}

/** A nav group rendered in the sidebar. */
export interface NavGroup {
  section: DocSection;
  label: string;
  docs: DocEntry[];
}

const SECTION_LABELS: Record<DocSection, string> = {
  principles: 'Coding Contract (§2)',
  ux: 'UX Principles (§3)',
  adr: 'Architecture Decisions',
  compliance: 'Compliance',
  compose: 'Composition Recipes',
  other: 'Other',
};

const SECTION_ORDER: DocSection[] = ['principles', 'ux', 'adr', 'compliance', 'compose', 'other'];

/** Sidebar navigation grouped by section, in display order. */
export function navGroups(): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const section of SECTION_ORDER) {
    const docs = entries.filter((entry) => entry.section === section);
    if (docs.length === 0) continue;
    groups.push({ section, label: SECTION_LABELS[section], docs });
  }
  return groups;
}
