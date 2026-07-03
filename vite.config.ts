import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, cpSync, existsSync, unlinkSync, rmSync } from 'node:fs';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/background.ts'),
        content: resolve(__dirname, 'src/content/content.ts'),
        'page-script': resolve(__dirname, 'src/content/page-script.ts'),
        devtools: resolve(__dirname, 'src/devtools/devtools.ts'),
        popup: resolve(__dirname, 'src/popup/popup.ts')
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
        // Prevent code splitting — each entry point is self-contained
        manualChunks: undefined
      }
    }
  },
  plugins: [
    {
      name: 'copy-extension-assets',
      closeBundle() {
        const dist = resolve(__dirname, 'dist');

        // Remove .DS_Store files
        const dsStore = resolve(dist, '.DS_Store');
        if (existsSync(dsStore)) {
          unlinkSync(dsStore);
        }

        // Copy manifest.json
        copyFileSync(resolve(__dirname, 'manifest.json'), resolve(dist, 'manifest.json'));

        // Copy popup.html
        if (existsSync(resolve(__dirname, 'popup.html'))) {
          copyFileSync(resolve(__dirname, 'popup.html'), resolve(dist, 'popup.html'));
        }

        // Copy popup.css
        if (existsSync(resolve(__dirname, 'src/popup/popup.css'))) {
          copyFileSync(resolve(__dirname, 'src/popup/popup.css'), resolve(dist, 'popup.css'));
        }

        // Copy devtools.html
        copyFileSync(resolve(__dirname, 'src/devtools/devtools.html'), resolve(dist, 'devtools.html'));

        // Copy icons
        const iconsDir = resolve(__dirname, 'public/icons');
        if (existsSync(iconsDir)) {
          cpSync(iconsDir, resolve(dist, 'icons'), { recursive: true });
        }

        // Flatten Angular panel output (browser/ → panel/) and remove browser/ dir
        const panelBrowser = resolve(dist, 'panel/browser');
        if (existsSync(panelBrowser)) {
          cpSync(panelBrowser, resolve(dist, 'panel'), { recursive: true });
          rmSync(panelBrowser, { recursive: true, force: true });
        }

        // Remove unnecessary Angular build artifacts
        const artifacts = ['panel/prerendered-routes.json', 'panel/3rdpartylicenses.txt'];
        for (const artifact of artifacts) {
          const artifactPath = resolve(dist, artifact);
          if (existsSync(artifactPath)) {
            unlinkSync(artifactPath);
          }
        }
      }
    }
  ]
});
