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
| Run full CI locally                                      | `make ci`                                                                                                  |
| Run every story with axe                                 | `pnpm test:stories`                                                                                        |
| Run the end-to-end tests (auth, media, shell)            | `pnpm test:e2e`                                                                                            |
| Add a new root-level dep                                 | `pnpm add -Dw <dep>`                                                                                       |
| Add a workspace-package dep                              | `pnpm --filter @sveltesentio/<pkg> add <dep>`                                                              |
| Create release PR                                        | (automated by release-please — open a branch + Conventional-Commit PR; `release-please.yml` runs on merge) |
