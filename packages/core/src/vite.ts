import type { Plugin } from 'vite';

export interface SentioPluginOptions {
  /**
   * Validate that required env vars are present at dev/build start.
   * Pass an array of variable names that must be non-empty.
   */
  requiredEnv?: string[];
  /**
   * Log the resolved config on startup. Default: false.
   */
  verbose?: boolean;
}

/**
 * Vite plugin for sveltesentio apps.
 *
 * Currently provides:
 * - Startup env validation (fails fast instead of at runtime)
 * - Verbose config logging for debugging
 *
 * Future: virtual $sentio module with typed runtime config.
 */
export function sentioPlugin(options: SentioPluginOptions = {}): Plugin {
  const { requiredEnv = [], verbose = false } = options;

  return {
    name: 'vite-plugin-sentio',
    enforce: 'pre',

    configResolved(config) {
      if (verbose) {
        console.warn('[sentio] Resolved Vite config:', {
          mode: config.mode,
          root: config.root,
          build: { outDir: config.build.outDir, ssr: config.build.ssr },
        });
      }
    },

    buildStart() {
      const missing = requiredEnv.filter(
        (key) => !process.env[key] || process.env[key] === '',
      );
      if (missing.length > 0) {
        throw new Error(
          `[sentio] Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join('\n')}\n` +
          `Check your .env file or deployment environment.`,
        );
      }
    },
  };
}
