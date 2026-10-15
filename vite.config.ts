/// <reference types="vitest" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

// Owenil is served from GitHub Pages at https://vishnumurali.github.io/owenil/.
// Override with VITE_BASE_PATH (must start and end with "/") for other hosts.
// `--mode android` and `--mode ios` build the copy packaged in the phone apps
// (see .env.android, .env.ios) into dist-app/, which Capacitor copies into each app.

// GitHub Pages can't send response headers, so the policy ships as a <meta> tag.
// (frame-ancestors is ignored in <meta>; public/theme-init.js refuses framing instead.)
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-src https://*.supabase.co",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

/**
 * The Android app shows pages inside the safe area (below the status bar,
 * above the navigation bar) instead of edge-to-edge, so no screen needs
 * system-bar padding. Capacitor follows the page's viewport-fit value.
 */
function androidViewport(): Plugin {
  return {
    name: 'owenil-android-viewport',
    transformIndexHtml: (html) => html.replace(', viewport-fit=cover', ''),
  };
}

/** Static-host extras for production builds: security meta tags and a 404.html SPA fallback. */
function staticHosting(): Plugin {
  let outDir = 'dist';
  return {
    name: 'owenil-static-hosting',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'strict-origin-when-cross-origin' }, injectTo: 'head-prepend' },
    ],
    // GitHub Pages serves 404.html for unknown paths, so deep links still boot the app.
    closeBundle() {
      copyFileSync(join(outDir, 'index.html'), join(outDir, '404.html'));
    },
  };
}

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), 'VITE_');
  const android = mode === 'android';
  const phoneApp = android || mode === 'ios';
  const base = process.env.VITE_BASE_PATH ?? fileEnv.VITE_BASE_PATH ?? '/owenil/';
  return {
  base,
  plugins: [react(), staticHosting(), ...(android ? [androidViewport()] : [])],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@owenil/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: phoneApp ? 'dist-app' : 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          motion: ['framer-motion'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['packages/core/test/**/*.test.ts', 'src/**/*.test.{ts,tsx}', 'tests/sql/**/*.test.ts'],
    environmentMatchGlobs: [['tests/sql/**', 'node'], ['packages/core/**', 'node']],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    css: false,
  },
  };
});
