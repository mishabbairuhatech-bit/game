import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    // Array form so the ordering is explicit: the workspace packages are
    // matched before the catch-all '@' prefix.
    //
    // The packages compile to CommonJS because NestJS consumes them that way,
    // and Rollup cannot statically resolve named exports through tsc's
    // __exportStar shims. Pointing the bundler at the TypeScript source avoids
    // the interop problem entirely and removes the need to build the packages
    // before `vite dev`.
    alias: [
      { find: /^@empire\/shared$/, replacement: pkg('shared') },
      { find: /^@empire\/game-data$/, replacement: pkg('game-data') },
      { find: /^@empire\/game-engine$/, replacement: pkg('game-engine') },
      { find: /^@\//, replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/` },
    ],
    // Three.js must resolve to exactly one copy: two instances break
    // instanceof checks inside R3F and produce very confusing runtime errors.
    dedupe: ['three', 'react', 'react-dom'],
  },

  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Inside Docker the bind-mounted filesystem does not deliver inotify
    // events on macOS/Windows hosts, so fall back to polling.
    watch: { usePolling: process.env.CHOKIDAR_USEPOLLING === 'true', interval: 400 },
    // The browser reaches the dev server through NGINX on :80, so the HMR
    // websocket must be advertised on that port, not 5173.
    hmr: { clientPort: Number(process.env.HMR_CLIENT_PORT ?? 80) },
    // NGINX is the only origin that talks to Vite.
    allowedHosts: true,
    proxy: {
      // Only used when running `vite dev` directly on the host without NGINX.
      '/api': { target: process.env.DEV_API_TARGET ?? 'http://backend:4000', changeOrigin: true },
      '/socket.io': { target: process.env.DEV_API_TARGET ?? 'http://backend:4000', ws: true },
    },
  },

  build: {
    target: 'es2022',
    sourcemap: mode !== 'production',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Three.js is large and changes rarely; splitting it means a gameplay
        // code change does not invalidate the biggest chunk in the bundle.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('three') || id.includes('@react-three')) return 'three';
            if (id.includes('react-router')) return 'router';
            if (id.includes('react') || id.includes('scheduler')) return 'react';
            if (id.includes('socket.io')) return 'realtime';
          }
          return undefined;
        },
      },
    },
  },

  // Pre-bundling these keeps the first dev page load from stalling on a
  // few hundred small three/drei modules.
  optimizeDeps: {
    include: ['three', '@react-three/fiber', '@react-three/drei', 'react', 'react-dom'],
    // Aliased to source above - prebundling them would defeat HMR on edits.
    exclude: ['@empire/shared', '@empire/game-data', '@empire/game-engine', '@empire/ui'],
  },

  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
}));
