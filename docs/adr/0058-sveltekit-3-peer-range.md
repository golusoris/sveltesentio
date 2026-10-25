# ADR-0058: Move `@sveltejs/kit` peer range to `^3.0.0` and drop SvelteKit 2 support

- **Status**: Accepted
- **Date**: 2026-10-25
- **Deciders**: @lusoris (operator decision)

## Context

The framework packages previously declared a `@sveltejs/kit` peerDependency floor of `>=2.70.2`, admitting both SvelteKit 2 and SvelteKit 3. Maintaining SvelteKit 2 compatibility carries growing security and maintenance costs:

- Dependabot alerts #141–#144 on the `sveltekit-2` development alias and kit 2 fixture are affected by low-severity advisories GHSA-27mw-82g8-phjj and GHSA-pfhg-q3qv-9q6r (`@sveltejs/kit < 3.0.0`). The fixes are present only in SvelteKit 3.0.0 and later, requiring temporary category C audit exceptions.
- The dual-major compatibility leg required maintaining a separate `sveltekit-2` alias in the root `package.json`, dual-major typechecking passes in `scripts/check-kit-compat.mjs`, and separate fixture apps and matrix jobs in `.github/workflows/compose-recipes.yml` (`tools/compose-lib-fixture/kit2/`).
- SvelteKit 3 has released versions 3.0.0, 3.0.1, and 3.1.0 with zero GitHub security advisories (measured 2026-10-25). The workspace `devDependencies` are already on `^3.0.0`.

## Decision

1. Update `peerDependencies` for `@sveltejs/kit` from `>=2.70.2` to `^3.0.0` across all eight consuming workspace packages: `@sveltesentio/ai`, `@sveltesentio/auth`, `@sveltesentio/core`, `@sveltesentio/forms`, `@sveltesentio/i18n`, `@sveltesentio/query`, `@sveltesentio/realtime`, and `@sveltesentio/shell`.
2. Drop the `sveltekit-2` npm alias from root `package.json` and remove its Renovate rules.
3. Replace the `@sveltejs/kit@2>cookie` override in `pnpm-workspace.yaml` with `'runed>@sveltejs/kit': '^3.0.0'`: runed 0.35.1 and 0.37.1 (through bits-ui, svelte-toolbelt and layerchart) declare an optional kit peer `^2.21.0`, which otherwise keeps SvelteKit 2.70.3 and cookie 0.6.0 in the lockfile. It ends when those packages depend on runed 0.38.0 or later, whose peer is `^3.0.0`.
4. Drop the SvelteKit 2 compatibility check leg and tests; configure `scripts/check-kit-compat.mjs` to typecheck against SvelteKit 3 only.
5. Remove the `tools/compose-lib-fixture/kit2/` fixture directory and remove `kit2` from the matrix in `.github/workflows/compose-recipes.yml`.
6. Remove the Category C forge alerts exception for Dependabot #141–#144 from `.standards.yaml`.
7. Keep the derived `Handle` hook type (`Parameters<typeof sequence>[number]`) in `@sveltesentio/auth` and `@sveltesentio/core`, superseding the range aspect of the earlier decision while keeping the type definition stable.

## Alternatives considered

- **Keep `>=2.70.2` with exception**: Prolongs the category C audit exception and requires continued maintenance of dual-major test infrastructure for an upstream major with known unfixed advisories.
- **Dual range `^2.70.2 || ^3`**: Retains the same dependency and security liabilities on the 2.x branch without providing clean separation or resolving Dependabot alerts.

## Consequences

**Positive**:

- Eliminates dual-major test matrix overhead and removes obsolete `kit2` fixtures and root aliases.
- Resolves Dependabot security alerts #141–#144 and clears the temporary Category C exception from `.standards.yaml`.
- Establishes a clean, single SvelteKit 3 floor across all framework packages.

**Negative / trade-offs**:

- Breaking change for downstream consumers still running SvelteKit 2; applications must migrate to SvelteKit 3 before upgrading `@sveltesentio/*` packages.

## Evidence

- `gh api /advisories` (checked 2026-10-25): SvelteKit 3.0.0 and 3.1.0 have 0 advisories; GHSA-27mw-82g8-phjj and GHSA-pfhg-q3qv-9q6r affect `<3.0.0`.
- All 8 package manifests declare `@sveltejs/kit`: `^3.0.0`.
- `pnpm check:kit-compat` verifies typecheck against SvelteKit 3.
- `pnpm-lock.yaml` resolves no `@sveltejs/kit` 2.x and no cookie 0.6.x after the change.
- `pnpm peers check`: `@vite-pwa/sveltekit` 1.1.0 (newest) still declares `@sveltejs/kit` `^1.3.1 || ^2.0.1`; this warning predates the change, since the workspace was already on kit 3.
