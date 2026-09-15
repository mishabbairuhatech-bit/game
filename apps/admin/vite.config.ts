import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// The panel is mounted under /admin/ by the edge NGINX, so every asset URL and
// the router basename must carry that prefix.
const BASE = process.env.VITE_BASE_PATH ?? '/admin/';

export default defineConfig(({ mode }) => ({
  base: BASE,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // The workspace packages compile to CommonJS for NestJS. Rollup cannot
      // statically resolve named exports through tsc's __exportStar shims, so
      // the bundlers consume the TypeScript source directly instead - which
      // also means no build step is needed before `vite dev`.
      '@empire/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@empire/game-data': fileURLToPath(new URL('../../packages/game-data/src/index.ts', import.meta.url)),
      '@empire/game-engine': fileURLToPath(new URL('../../packages/game-engine/src/index.ts', import.meta.url)),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    exclude: ['@empire/shared', '@empire/game-data', '@empire/ui'],
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    watch: { usePolling: process.env.CHOKIDAR_USEPOLLING === 'true', interval: 400 },
    hmr: { clientPort: Number(process.env.HMR_CLIENT_PORT ?? 80), path: '/admin/' },
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    sourcemap: mode !== 'production',
  },
  test: { environment: 'jsdom', globals: true },
}));
