# Common development tasks

Workflow commands, skills, and recipes for common development tasks in the sveltesentio monorepo.

## Tasks table

| Task                                                     | Command / Skill                                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Add a new `@sveltesentio/*` package                      | `/wire-module` skill                                                                                       |
| Scaffold a SvelteKit route (Superforms + TanStack Query) | `/scaffold-route` skill                                                                                    |
| Add a shadcn-svelte component                            | `/add-shadcn` skill                                                                                        |
| Add a Storybook story                                    | `/add-storybook` skill                                                                                     |
| Bootstrap dev environment                                | `make setup`                                                                                               |
| Run lint, typecheck, unit tests and build locally        | `make ci`                                                                                                  |
| Run every story with axe                                 | `pnpm test:stories`                                                                                        |
| Run the end-to-end tests (auth, media, shell)            | `pnpm test:e2e`                                                                                            |
| Run dependency vulnerability audit locally               | `pnpm audit --audit-level=high`                                                                            |
| Add a new root-level dep                                 | `pnpm add -Dw <dep>`                                                                                       |
| Add a workspace-package dep                              | `pnpm --filter @sveltesentio/<pkg> add <dep>`                                                              |
| Create release PR                                        | (automated by release-please — open a branch + Conventional-Commit PR; `release-please.yml` runs on merge) |

`make ci` runs `pnpm run ci` (`turbo lint typecheck test build`). It omits the audit, stories and end-to-end jobs of `ci.yml`; run those with `pnpm audit --audit-level=high`, `pnpm test:stories` and `pnpm test:e2e`.
