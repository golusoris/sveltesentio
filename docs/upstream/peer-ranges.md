# Peer ranges

Target peer versions for sveltesentio consuming applications and upstream libraries.

## Upstream snapshots

Version-pinned snapshots live in `docs/upstream/` (maintained by `refresh-upstream-docs.yml`). Library not yet snapshotted -> check library repo directly for exact version in `pnpm-lock.yaml`. Public docs may be ahead of or behind pinned version.

## Current peer-range targets

Consumers must satisfy these targets:

| Package                  | Version target | Notes                                                             |
| ------------------------ | -------------- | ----------------------------------------------------------------- |
| `svelte`                 | >=5.56.4       | runes-first; published peer range; root devDep `^5.57.0`          |
| `@sveltejs/kit`          | ^3.0.0         | ADR-0058; kit 2 dropped; floor 3.0.0, 0 advisories                |
| `vite`                   | >=8.0.16       | core peer; lowest vite 8 with 0 advisories                        |
| `typescript`             | >=5.5 <7       | published peerDep; root devDependency `^6.0.3` (ADR-0020)         |
| `zod`                    | >=4.0.0        | published peerDep; v3 unsupported                                 |
| `tailwindcss`            | >=4.0.0        | published peerDep; v3 unsupported; preset compatible only with v4 |
| `@tanstack/svelte-query` | >=6.0.0        | published peerDep; ADR-0008                                       |
| `node`                   | >=24           | ADR-0021; LTS; closes D5                                          |
| `pnpm`                   | >=10           | workspace features required; repository pins `pnpm@12.14.0`       |
