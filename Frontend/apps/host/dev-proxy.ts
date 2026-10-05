import type { ProxyOptions } from 'vite'

/**
 * The development twin of the production nginx config (deploy/nginx/app.conf): the browser only ever
 * talks to the host dev server on :5173, and the host dev server forwards everything else.
 *
 *   /api/lead-service/*         → LeadService            (keeps its prefix: the service's path base)
 *   /api/customer360-service/*  → Customer360Service     (same)
 *   /api/products-service/*     → ProductsService        (same, plus its SignalR hub)
 *   /api/*, /hubs/*             → AuthService            (published at the origin root)
 *   /modules/<key>/<version>/*  → that remote's build server, version segment stripped
 *
 * Same origin in development is the point, not a convenience: the refresh cookie is first-party, no
 * CORS is involved, and a remote is loaded from exactly the kind of URL production uses, so "works
 * on my machine" means the same thing it means in production. The remote and backend servers bind to
 * loopback only — they are implementation detail, not entry points.
 *
 * ORDER MATTERS. Vite tries proxy keys in insertion order and the first prefix match wins (unlike
 * nginx, which picks the longest), so every /api/<service> prefix must come before the bare /api.
 *
 * Every target can be overridden for a non-standard local setup, e.g. AuthService on another port:
 *   OMNI_DEV_AUTH_URL=http://127.0.0.1:5165 pnpm dev:host
 */

/** The remotes a developer can run locally: registry key → the port its build server listens on. */
export const DEV_REMOTES: Record<string, number> = {
  lead: 5002,
  customer360: 5003,
  products: 5004,
}

const target = (envName: string, fallback: string) => process.env[envName]?.trim() || fallback

export function devProxy(): Record<string, ProxyOptions> {
  const backend = (url: string, ws = false): ProxyOptions => ({
    target: url,
    ws,
    // The backend sees the browser's own Host and the caller's address in X-Forwarded-For, exactly
    // as it does behind nginx.
    changeOrigin: false,
    xfwd: true,
  })

  const proxy: Record<string, ProxyOptions> = {
    '/api/lead-service': backend(target('OMNI_DEV_LEAD_URL', 'http://127.0.0.1:5046')),
    '/api/customer360-service': backend(target('OMNI_DEV_C360_URL', 'http://127.0.0.1:5059')),
    '/api/products-service': backend(target('OMNI_DEV_PRODUCTS_URL', 'http://127.0.0.1:5266'), true),
    '/api': backend(target('OMNI_DEV_AUTH_URL', 'http://127.0.0.1:5155')),
    '/hubs': backend(target('OMNI_DEV_AUTH_URL', 'http://127.0.0.1:5155'), true),
  }

  for (const [key, port] of Object.entries(DEV_REMOTES)) {
    const prefix = `/modules/${key}/`
    proxy[prefix] = {
      target: target(`OMNI_DEV_REMOTE_${key.toUpperCase()}_URL`, `http://127.0.0.1:${port}`),
      changeOrigin: true,
      // Production serves /modules/<key>/<version>/...; locally there is one build per remote, so any
      // version segment ("dev", "1.4.0") maps to its root.
      rewrite: (path) => path.replace(new RegExp(`^/modules/${key}/[^/]+/`), '/'),
    }
  }

  return proxy
}
