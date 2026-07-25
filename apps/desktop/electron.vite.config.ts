import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

/**
 * Inject a strict CSP <meta> into index.html at BUILD time only (apply: 'build'). The
 * packaged app loads via file://, where the main-process header CSP does not apply — so
 * the meta tag is the enforcement mechanism there. In dev this plugin is inactive and the
 * dev-friendly header CSP (main/index.ts) governs instead (ADR-0004).
 */
function cspMetaPlugin(): Plugin {
  const csp =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:";
  return {
    name: 'icarus-inject-csp-meta',
    apply: 'build',
    transformIndexHtml(html: string): string {
      const tag = `    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n  </head>`;
      return html.replace('  </head>', tag);
    },
  };
}

/**
 * electron-vite config: three build targets (main, preload, renderer). The renderer is a
 * React + Vite app; main/preload are Node/Electron bundles. Kept minimal for the walking
 * skeleton.
 */
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
        // `ws` must be required at runtime, not bundled: it lazily requires optional
        // native deps (bufferutil/utf-8-validate) that break the bundler. @icarus/core
        // and zod stay bundled (core is workspace TS source).
        external: ['ws', 'bufferutil', 'utf-8-validate'],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        // A sandboxed preload (sandbox: true, ADR-0004) must be CommonJS, not ESM —
        // Electron cannot load an ESM preload in the sandbox. Emit .cjs.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
      },
    },
    plugins: [react(), cspMetaPlugin()],
  },
});
