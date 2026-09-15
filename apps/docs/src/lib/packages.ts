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

// Typed through the glob's type parameter rather than a trailing `as`. The cast
// form is load-bearing here — without it `manifest` is `unknown` and every field
// read fails — but `@typescript-eslint/no-unnecessary-type-assertion` reports it
// as redundant, so the parameter states the same thing where the rule agrees.
const manifests = import.meta.glob<RawManifest>('../../../../packages/*/package.json', {
  import: 'default',
  eager: true,
});

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
