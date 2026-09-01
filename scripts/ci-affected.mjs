import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

export const SHARED_SURFACE_PATTERNS = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^turbo\.json$/,
  /^tsconfig(\..*)?\.json$/,
  /^eslint\.config\.(ts|js|mjs|cjs)$/,
  /^prettier\.config\.(js|mjs|cjs)$/,
  /^commitlint\.config\.(js|mjs|cjs)$/,
  /^Makefile$/,
  /^\.github\//,
  /^scripts\//,
  /^packages\/core\//,
  /^packages\/testing\//,
];

export const DOCS_ONLY_PATTERNS = [
  /\.md$/,
  /^docs\//,
  /^\.workingdir\//,
  /^LICENSE$/,
  /^CODE_OF_CONDUCT\.md$/,
  /^SECURITY\.md$/,
  /^\.editorconfig$/,
  /^\.markdownlint/,
];

export const PACKAGE_DIRECTORY_MAP = {
  'packages/ai': '@sveltesentio/ai',
  'packages/api': '@sveltesentio/api',
  'packages/auth': '@sveltesentio/auth',
  'packages/charts': '@sveltesentio/charts',
  'packages/collab': '@sveltesentio/collab',
  'packages/core': '@sveltesentio/core',
  'packages/emulator': '@sveltesentio/emulator',
  'packages/flow': '@sveltesentio/flow',
  'packages/forms': '@sveltesentio/forms',
  'packages/i18n': '@sveltesentio/i18n',
  'packages/ipc-sockmap': '@sveltesentio/ipc-sockmap',
  'packages/mcp': '@sveltesentio/mcp',
  'packages/media': '@sveltesentio/media',
  'packages/query': '@sveltesentio/query',
  'packages/realtime': '@sveltesentio/realtime',
  'packages/shell': '@sveltesentio/shell',
  'packages/testing': '@sveltesentio/testing',
  'packages/ui': '@sveltesentio/ui',
  'packages/uploads': '@sveltesentio/uploads',
  'apps/docs': '@sveltesentio/docs',
  'apps/integration': '@sveltesentio/integration',
  'apps/storybook': '@sveltesentio/storybook',
};

/**
 * Analyzes a list of changed file paths and returns the change impact.
 * @param {string[]} changedFiles
 * @returns {{
 *   allAffected: boolean,
 *   hasCodeChanges: boolean,
 *   sharedSurfaces: string[],
 *   affectedPackages: string[],
 *   turboFilter: string
 * }}
 */
export function analyzeChanges(changedFiles) {
  if (!changedFiles || changedFiles.length === 0) {
    return {
      allAffected: false,
      hasCodeChanges: false,
      sharedSurfaces: [],
      affectedPackages: [],
      turboFilter: '',
    };
  }

  const normalizedFiles = changedFiles.map((f) => f.replace(/\\/g, '/').replace(/^\.\//, ''));

  const sharedSurfaces = normalizedFiles.filter((file) =>
    SHARED_SURFACE_PATTERNS.some((pattern) => pattern.test(file)),
  );

  const isDocsOnly = normalizedFiles.every((file) =>
    DOCS_ONLY_PATTERNS.some((pattern) => pattern.test(file)),
  );

  if (isDocsOnly) {
    return {
      allAffected: false,
      hasCodeChanges: false,
      sharedSurfaces: [],
      affectedPackages: [],
      turboFilter: '',
    };
  }

  if (sharedSurfaces.length > 0) {
    return {
      allAffected: true,
      hasCodeChanges: true,
      sharedSurfaces,
      affectedPackages: Object.values(PACKAGE_DIRECTORY_MAP),
      turboFilter: '',
    };
  }

  const affectedPkgSet = new Set();
  for (const file of normalizedFiles) {
    for (const [dir, pkgName] of Object.entries(PACKAGE_DIRECTORY_MAP)) {
      if (file.startsWith(`${dir}/`)) {
        affectedPkgSet.add(pkgName);
        break;
      }
    }
  }

  const affectedPackages = Array.from(affectedPkgSet).sort();

  if (affectedPackages.length === 0) {
    return {
      allAffected: false,
      hasCodeChanges: false,
      sharedSurfaces: [],
      affectedPackages: [],
      turboFilter: '',
    };
  }

  const filterArgs = affectedPackages.map((pkg) => `--filter=...${pkg}...`).join(' ');

  return {
    allAffected: false,
    hasCodeChanges: true,
    sharedSurfaces: [],
    affectedPackages,
    turboFilter: filterArgs,
  };
}

/**
 * Gets git changed files between base and head.
 * @param {string} baseRef
 * @param {string} headRef
 * @returns {string[]}
 */
export function getGitDiffFiles(baseRef = 'origin/main', headRef = 'HEAD') {
  try {
    const output = execSync(`git diff --name-only ${baseRef}...${headRef}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return output
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    try {
      const fallback = execSync(`git diff --name-only HEAD~1...HEAD`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return fallback
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}

// If invoked as CLI script
if (process.argv[1] && resolve(process.argv[1]) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  let baseRef = process.env.BASE_REF || 'origin/main';
  let headRef = process.env.HEAD_REF || 'HEAD';
  let explicitFiles = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) {
      baseRef = args[++i];
    } else if (args[i] === '--head' && args[i + 1]) {
      headRef = args[++i];
    } else if (args[i] === '--files') {
      explicitFiles = args.slice(i + 1);
      break;
    }
  }

  const files = explicitFiles !== null ? explicitFiles : getGitDiffFiles(baseRef, headRef);
  const result = analyzeChanges(files);

  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('node:fs/promises');
    const out = [
      `all_affected=${result.allAffected}`,
      `has_code_changes=${result.hasCodeChanges}`,
      `turbo_filter=${result.turboFilter}`,
      `affected_packages=${JSON.stringify(result.affectedPackages)}`,
    ].join('\n');
    await fs.appendFile(process.env.GITHUB_OUTPUT, `${out}\n`);
  }

  console.log(JSON.stringify(result, null, 2));
}
