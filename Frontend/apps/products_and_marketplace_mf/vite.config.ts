import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';
import { remoteFederationConfig } from '@omniremit/federation-config';

// Products & Marketplace Remote Micro-Frontend
// Container Name: products_mf (must be unique across all remotes)
// Exposes: ./App pointing to ./src/App.tsx
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.VITE_PREVIEW_PORT ?? 5004);

  return {
    plugins: [
      react(),
      federation(remoteFederationConfig('products_mf', './src/App.tsx', ['zustand', 'react-router-dom'])),
    ],

    build: {
      target: 'esnext',
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          assetFileNames: 'assets/[name].[ext]',
        },
      },
    },

    server: {
      host: true,
      port,
      strictPort: true,
      cors: true,
    },

    preview: {
      host: true,
      port,
      strictPort: true,
      cors: true,
    },
  };
});
