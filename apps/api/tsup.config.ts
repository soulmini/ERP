import { defineConfig } from 'tsup';

/**
 * Production bundle → dist/server.js.
 * @erp/shared (workspace TS source) is bundled in, so the deployed API
 * only needs its npm dependencies, not the monorepo.
 */
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@erp/shared'],
});
