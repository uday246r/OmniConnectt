import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';
import { remoteFederationConfig } from '@omniconnect/federation-config';

// Products & Marketplace Remote Micro-Frontend
// Container Name: products_mf (must be unique across all remotes)
// Exposes: ./App pointing to ./src/App.tsx
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.VITE_PREVIEW_PORT ?? 5004);

  return {
    plugins: [
      react(),
      federation(remoteFederationConfig('products_mf', './src/App.tsx', ['zustand'])),
    ],

    // Relative, not '/': the built remote is published under a versioned folder
    // (/modules/<key>/<version>/), and Module Federation resolves every chunk and stylesheet from the
    // manifest's own directory. An absolute base would point a remote's assets at the host's /assets.
    base: './',

    build: {
      target: 'esnext',
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          // Content-hashed so a published version's files can be cached forever (immutable). The
          // stylesheet is found through mf-manifest.json, never by a fixed name.
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },

    server: {
      // Loopback only: this server is an implementation detail behind the host dev server's
      // /modules/<key>/ proxy, never an entry point — nothing off this machine can reach it.
      // 127.0.0.1 rather than 'localhost', which can resolve to ::1 alone and refuse an IPv4 caller.
      host: '127.0.0.1',
      port,
      strictPort: true,
      cors: true,
    },

    preview: {
      // The build is rewritten in place on every save (vite build --watch), under the same
      // unversioned URL, so nothing it serves may be cached.
      headers: { 'Cache-Control': 'no-store' },
      host: '127.0.0.1',
      port,
      strictPort: true,
      cors: true,
    },
  };
});
