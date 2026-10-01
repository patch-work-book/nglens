import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Builds the E2E accuracy harness into e2e/dist.
 * Bundles the REAL ngLens instrumentation (via harness-entry.ts) and the
 * harness.html page. Angular is loaded from a CDN inside the HTML, so it is
 * not part of this bundle.
 */
export default defineConfig({
  root: resolve(__dirname),
  // Preserve TS decorators/metadata for Angular JIT (esbuild would otherwise strip).
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        useDefineForClassFields: false,
      },
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        zoneless: resolve(__dirname, 'harness.html'),
        zoneful: resolve(__dirname, 'harness-zoneful.html'),
      },
    },
  },
});
