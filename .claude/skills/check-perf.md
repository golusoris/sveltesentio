# Skill: check-perf

Run performance and bundle size analysis. Verify Core Web Vitals budgets are met.

## When to use

Before a release, after adding a new dependency, or when a page feels slow.

## Budgets (from docs/principles.md §2.9)

| Metric | Target | Tool |
| --- | --- | --- |
| LCP | < 2.5s | Lighthouse / PageSpeed |
| INP | < 200ms | Lighthouse / Chrome DevTools |
| CLS | < 0.1 | Lighthouse |
| JS bundle (initial) | < 150kb gzipped | rollup-plugin-visualizer |
| Lighthouse performance | ≥ 80 | `pnpm lighthouse` |
| Lighthouse a11y | ≥ 95 | `pnpm lighthouse` |

## Steps

### 1. Bundle size analysis

```bash
# Build with visualizer output
VITE_VISUALIZE=true pnpm --filter <app> build
# Opens stats.html in browser — look for large unexpected modules
open dist/stats.html
```

### 2. Lighthouse CI

```bash
# From app root (must have pnpm serve running):
pnpm --filter <app> build && pnpm --filter <app> preview &
npx lighthouse http://localhost:4173 --output=json --chrome-flags="--headless" | jq '.categories | to_entries[] | "\(.key): \(.value.score * 100)"'
```

### 3. Quick checks for common issues

```bash
# Find large dependencies
pnpm why <suspected-large-package>

# Check for accidental server code in client bundle
grep -r "process.env" src/routes --include="*.svelte" --include="*.ts"

# Verify tree-shaking — no default barrel imports
grep -r "from '@sveltesentio" src --include="*.svelte" --include="*.ts" | grep "import \*"
```

### 4. Image optimization checklist

- [ ] All `<img>` use `loading="lazy"` + `decoding="async"`
- [ ] Artwork served as WebP/AVIF with `<picture>` fallback
- [ ] `width` and `height` attributes set (prevents CLS)
- [ ] Dominant-color placeholder while loading

### 5. Font optimization

- [ ] Variable fonts only — single file covers all weights
- [ ] `font-display: swap` in `@font-face`
- [ ] `<link rel="preload">` for critical fonts in `app.html`

## Rules

- Fail the PR if any Lighthouse score drops below budget — enforced in `ci.yml`
- Never import a whole library for one util — always import the specific function
- Use `$app/stores` `page` for navigation, never import full router
