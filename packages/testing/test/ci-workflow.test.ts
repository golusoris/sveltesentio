import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  analyzeChanges,
  SHARED_SURFACE_PATTERNS,
  DOCS_ONLY_PATTERNS,
  PACKAGE_DIRECTORY_MAP,
} from '../../scripts/ci-affected.mjs';

describe('CI Affected Package Selection (scripts/ci-affected.mjs)', () => {
  it('returns no code changes when file list is empty', () => {
    const result = analyzeChanges([]);
    expect(result.allAffected).toBe(false);
    expect(result.hasCodeChanges).toBe(false);
    expect(result.affectedPackages).toEqual([]);
    expect(result.turboFilter).toBe('');
  });

  it('marks docs-only changes as non-code changes so builds can skip', () => {
    const docsFiles = [
      'README.md',
      'docs/principles.md',
      'docs/adr/0001-init.md',
      '.workingdir/STATE.md',
      'LICENSE',
      'SECURITY.md',
      'CODE_OF_CONDUCT.md',
    ];
    const result = analyzeChanges(docsFiles);
    expect(result.allAffected).toBe(false);
    expect(result.hasCodeChanges).toBe(false);
    expect(result.affectedPackages).toEqual([]);
    expect(result.turboFilter).toBe('');
  });

  it('triggers all packages when a shared root surface is touched', () => {
    const rootConfigs = [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'turbo.json',
      'tsconfig.base.json',
      'eslint.config.ts',
      'prettier.config.js',
      'commitlint.config.js',
      'Makefile',
    ];

    for (const config of rootConfigs) {
      const result = analyzeChanges([config]);
      expect(result.allAffected).toBe(true);
      expect(result.hasCodeChanges).toBe(true);
      expect(result.sharedSurfaces).toContain(config);
      expect(result.affectedPackages.length).toBe(Object.keys(PACKAGE_DIRECTORY_MAP).length);
      expect(result.turboFilter).toBe('');
    }
  });

  it('triggers all packages when core or testing packages are touched', () => {
    const coreResult = analyzeChanges(['packages/core/src/index.ts']);
    expect(coreResult.allAffected).toBe(true);
    expect(coreResult.hasCodeChanges).toBe(true);

    const testingResult = analyzeChanges(['packages/testing/src/clock.ts']);
    expect(testingResult.allAffected).toBe(true);
    expect(testingResult.hasCodeChanges).toBe(true);
  });

  it('triggers all packages when .github workflows or scripts change', () => {
    const workflowResult = analyzeChanges(['.github/workflows/ci.yml']);
    expect(workflowResult.allAffected).toBe(true);
    expect(workflowResult.hasCodeChanges).toBe(true);

    const scriptResult = analyzeChanges(['scripts/ci-affected.mjs']);
    expect(scriptResult.allAffected).toBe(true);
    expect(scriptResult.hasCodeChanges).toBe(true);
  });

  it('narrows to single package and constructs downstream turbo filter for isolated package edits', () => {
    const result = analyzeChanges([
      'packages/ui/src/button.svelte',
      'packages/ui/src/dialog.svelte',
    ]);
    expect(result.allAffected).toBe(false);
    expect(result.hasCodeChanges).toBe(true);
    expect(result.sharedSurfaces).toEqual([]);
    expect(result.affectedPackages).toEqual(['@sveltesentio/ui']);
    expect(result.turboFilter).toBe('--filter=...@sveltesentio/ui...');
  });

  it('handles multiple specific package edits without selecting entire workspace', () => {
    const result = analyzeChanges([
      'packages/forms/src/use-form.ts',
      'packages/query/src/connect.ts',
      'apps/storybook/src/stories/button.stories.svelte',
    ]);
    expect(result.allAffected).toBe(false);
    expect(result.hasCodeChanges).toBe(true);
    expect(result.affectedPackages).toEqual([
      '@sveltesentio/forms',
      '@sveltesentio/query',
      '@sveltesentio/storybook',
    ]);
    expect(result.turboFilter).toBe(
      '--filter=...@sveltesentio/forms... --filter=...@sveltesentio/query... --filter=...@sveltesentio/storybook...',
    );
  });
});

describe('Renovate Configuration (renovate.json)', () => {
  const rootDir = resolve(__dirname, '../../..');
  const renovatePath = resolve(rootDir, 'renovate.json');

  it('exists and is valid JSON', () => {
    expect(existsSync(renovatePath)).toBe(true);
    const content = readFileSync(renovatePath, 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('has vulnerabilityAlerts enabled with immediate schedule and no minimumReleaseAge cooldown', () => {
    const config = JSON.parse(readFileSync(renovatePath, 'utf8'));
    expect(config.vulnerabilityAlerts).toBeDefined();
    expect(config.vulnerabilityAlerts.enabled).toBe(true);
    expect(config.vulnerabilityAlerts.minimumReleaseAge).toBeNull();
    expect(config.vulnerabilityAlerts.schedule).toEqual(['at any time']);
  });

  it('guarantees vulnerability updates are never grouped into batch PRs', () => {
    const config = JSON.parse(readFileSync(renovatePath, 'utf8'));
    const vulnRule = config.packageRules?.find((r: { matchUpdateTypes?: string[] }) =>
      r.matchUpdateTypes?.includes('vulnerability'),
    );
    expect(vulnRule).toBeDefined();
    expect(vulnRule.groupName).toBeNull();
    expect(vulnRule.minimumReleaseAge).toBeNull();
  });

  it('preserves undici allowedVersions cap for jsdom 29 compatibility', () => {
    const config = JSON.parse(readFileSync(renovatePath, 'utf8'));
    const undiciRule = config.packageRules?.find((r: { matchPackageNames?: string[] }) =>
      r.matchPackageNames?.includes('undici'),
    );
    expect(undiciRule).toBeDefined();
    expect(undiciRule.allowedVersions).toBe('<8');
  });

  it('groups non-major dev dependencies and tooling to reduce CI PR storms', () => {
    const config = JSON.parse(readFileSync(renovatePath, 'utf8'));
    const devRule = config.packageRules?.find(
      (r: { groupName?: string }) => r.groupName === 'devDependencies (non-major)',
    );
    expect(devRule).toBeDefined();

    const linterRule = config.packageRules?.find(
      (r: { groupName?: string }) => r.groupName === 'linters and formatters',
    );
    expect(linterRule).toBeDefined();

    const testRule = config.packageRules?.find(
      (r: { groupName?: string }) => r.groupName === 'test tooling',
    );
    expect(testRule).toBeDefined();
  });
});

describe('CI Workflows Configuration (.github/workflows/)', () => {
  const rootDir = resolve(__dirname, '../../..');
  const ciWorkflowPath = resolve(rootDir, '.github/workflows/ci.yml');
  const codeqlWorkflowPath = resolve(rootDir, '.github/workflows/codeql.yml');

  it('enforces concurrency cancel-in-progress on CI workflow', () => {
    const content = readFileSync(ciWorkflowPath, 'utf8');
    expect(content).toContain('concurrency:');
    expect(content).toContain('cancel-in-progress: true');
  });

  it('enforces concurrency cancel-in-progress on CodeQL workflow', () => {
    const content = readFileSync(codeqlWorkflowPath, 'utf8');
    expect(content).toContain('concurrency:');
    expect(content).toContain('cancel-in-progress: true');
  });

  it('has aggregate ci-gate job depending on all required checks with if: always()', () => {
    const content = readFileSync(ciWorkflowPath, 'utf8');
    expect(content).toContain('ci-gate:');
    expect(content).toContain(
      'needs: [pr-title, detect-changes, lint, typecheck, test, build, audit]',
    );
    expect(content).toContain('if: always()');
  });
});
