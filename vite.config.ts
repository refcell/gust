/// <reference types="vitest/config" />
import { defineConfig, build, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

const BASE = '/gust/';

/**
 * Builds src/sw/sw.ts into dist/sw.js as a classic (IIFE) script, after the main build,
 * injecting the list of emitted assets so the service worker can precache the shell.
 */
function serviceWorker(): Plugin {
  let files: string[] = [];
  let outDir = 'dist';
  return {
    name: 'gust-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    generateBundle(_opts, bundle) {
      files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && !f.endsWith('.mp4'));
    },
    async closeBundle() {
      const version = Date.now().toString(36);
      await build({
        configFile: false,
        logLevel: 'warn',
        define: {
          __PRECACHE__: JSON.stringify(files.map((f) => BASE + f)),
          __SW_VERSION__: JSON.stringify(version),
          __BASE__: JSON.stringify(BASE),
        },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          minify: true,
          lib: { entry: resolve(import.meta.dirname, 'src/sw/sw.ts'), formats: ['iife'], name: 'gustsw', fileName: () => 'sw.js' },
        },
      });
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [preact(), serviceWorker()],
  define: {
    __BASE__: JSON.stringify(BASE),
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'server/test/**/*.test.ts'],
    environment: 'node',
  },
});
