/**
 * Build-time package index.
 *
 * Every `packages/*‍/package.json` is globbed eagerly and reduced to the
 * fields the landing page needs. Keeping it data-driven means the index
 * tracks the workspace automatically — no hand-maintained list to drift.
 */
interface RawManifest {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  private?: unknown;
}

const manifests = import.meta.glob('../../../../packages/*/package.json', {
  import: 'default',
  eager: true,
}) as Record<string, RawManifest>;

/** One published `@sveltesentio/*` package. */
export interface PackageEntry {
  name: string;
  version: string;
  description: string;
  npmUrl: string;
  isPrivate: boolean;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function buildPackages(): PackageEntry[] {
  const out: PackageEntry[] = [];
  for (const manifest of Object.values(manifests)) {
    const name = asString(manifest.name, '');
    if (name === '') continue;
    out.push({
      name,
      version: asString(manifest.version, '0.0.0'),
      description: asString(manifest.description, ''),
      npmUrl: `https://www.npmjs.com/package/${name}`,
      isPrivate: manifest.private === true,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

const packages = buildPackages();

/** All `@sveltesentio/*` packages, name-sorted. */
export function allPackages(): PackageEntry[] {
  return packages;
}

/** Count of public (npm-published) packages. */
export function publicPackageCount(): number {
  return packages.filter((pkg) => !pkg.isPrivate).length;
}
