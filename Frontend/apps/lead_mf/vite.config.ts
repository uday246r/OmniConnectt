import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';
import { remoteFederationConfig } from '@omniconnect/federation-config';

// Lead Management Remote Micro-Frontend
// Container Name: lead_mf (must be unique across all remotes)
// Exposes: ./App pointing to ./src/App.tsx
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.VITE_PREVIEW_PORT ?? 5002);

  return {
    plugins: [
      react(),
      federation(remoteFederationConfig('lead_mf', './src/App.tsx', ['zustand'])),
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
      // `true`, not the string '0.0.0.0': the string binds the IPv4 wildcard ONLY. AuthService's
      // background health prober is a .NET HttpClient resolving "localhost", which on this platform
      // sometimes tries ::1 first — with no IPv6 listener that attempt is refused, and if the IPv4
      // fallback doesn't complete inside the prober's 5s timeout the app flaps to "Unreachable" even
      // though it's actually up (observed live: 4 consecutive Healthy probes, then one Unreachable).
      // `true` listens on both address families, removing the race entirely.
      host: true,
      port,
      strictPort: true,
      cors: true,
    },

    preview: {
      // `true`, not the string '0.0.0.0': the string binds the IPv4 wildcard ONLY. AuthService's
      // background health prober is a .NET HttpClient resolving "localhost", which on this platform
      // sometimes tries ::1 first — with no IPv6 listener that attempt is refused, and if the IPv4
      // fallback doesn't complete inside the prober's 5s timeout the app flaps to "Unreachable" even
      // though it's actually up (observed live: 4 consecutive Healthy probes, then one Unreachable).
      // `true` listens on both address families, removing the race entirely.
      host: true,
      port,
      strictPort: true,
      cors: true,
    },
  };
});
