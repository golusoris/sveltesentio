/**
 * Token CSS file paths for programmatic use (e.g. in Vite plugins, CLIs).
 * In apps, import the CSS files directly:
 *   @import '@sveltesentio/ui/tokens/media.css';
 */

export const tokenPaths = {
  base:      '@sveltesentio/ui/tokens/base.css',
  media:     '@sveltesentio/ui/tokens/media.css',
  dashboard: '@sveltesentio/ui/tokens/dashboard.css',
  webapp:    '@sveltesentio/ui/tokens/webapp.css',
  pwa:       '@sveltesentio/ui/tokens/pwa.css',
  tenFoot:   '@sveltesentio/ui/tokens/ten-foot.css',
  flow:      '@sveltesentio/ui/tokens/flow.css',
} as const;

export type TokenKey = keyof typeof tokenPaths;
