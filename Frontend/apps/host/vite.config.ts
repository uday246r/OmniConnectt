import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { federation } from '@module-federation/vite'
import { hostFederationConfig } from '@omniconnect/federation-config'
import { devProxy } from './dev-proxy.ts'

// This app is a Module Federation 2.0 *host* with zero build-time remotes. Every remote app is
// registered at runtime (see src/shared/federation/remoteLoader.ts) from a manifest URL fetched
// from AuthService's remote-app API — nothing about which remotes exist is known at build time.
//
// The shared-dependency set deliberately lives in @omniconnect/federation-config, not inline here:
// the host and every remote must agree on it exactly, and a copy-pasted block drifts. See that
// package's header for which packages belong in it and why.
export default defineConfig({
  // A release publishes each host build to its own immutable folder, /host/<version>/, and serves only
  // index.html at the origin root (scripts/release/build.mjs sets this). Development stays at '/'.
  base: process.env.OMNI_HOST_BASE || '/',
  plugins: [
    react(),
    federation(hostFederationConfig('omniconnect_host')),
  ],
  css: {
    modules: {
      // Namespaced so hashed class names never collide with a remote app's own CSS Modules output
      // even if both bundles land in the same DOM — see shared/styles/README for the full rule.
      generateScopedName: 'omni-host-[name]__[local]__[hash:base64:5]',
    },
  },
  server: {
    // IPv4 loopback: the browser's http://localhost:5173 still reaches it, and AuthService's manifest
    // prober (RemoteApps:InternalBaseUrl) gets a deterministic address instead of a ::1/127.0.0.1 race.
    host: '127.0.0.1',
    port: 5173,
    // Fail loudly if 5173 is taken instead of silently rebinding to another port: every link, the
    // Google sign-in origin and AuthService's CORS list name exactly this one.
    strictPort: true,
    // The only URL a developer's browser uses. Backends and remote build servers sit behind it, the
    // same way they sit behind nginx in production — see dev-proxy.ts.
    proxy: devProxy(),
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        // Split long-lived vendor code out of the app chunk so a deploy that only changes app code
        // doesn't invalidate the (much larger) framework bundles in users' caches.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react-router')) return 'vendor-router'
          if (id.includes('@tanstack')) return 'vendor-query'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'vendor-react'
          return undefined
        },
      },
    },
  },
})
