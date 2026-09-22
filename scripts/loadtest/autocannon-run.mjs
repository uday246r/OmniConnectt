#!/usr/bin/env node
/*
 * Combined autocannon load test across all four OmniConnect backend services, in one command.
 *
 *   cd scripts/loadtest && npm install
 *   node autocannon-run.mjs                                   # default ramp 10,50,100,200 conn x 15s
 *   node autocannon-run.mjs --connections 10,50 --duration 10 --out results.json
 *   node autocannon-run.mjs --services auth,lead               # only some services
 *   node autocannon-run.mjs --workers 4                         # spread connections over 4 CPU threads
 *   node autocannon-run.mjs --skip-preflight                    # skip the one-request-per-route check
 *
 * Signs in once (scripts/loadtest/.env.loadtest, same LOADTEST_EMAIL/LOADTEST_PASSWORD keys as
 * http-load.mjs) and reuses the token for every request in the run. GET-only, parameterless routes:
 * see the plan / PR description for exactly what is included and why (Customer360 CRM-proxying
 * routes such as indprofile/corpprofile, {id}-scoped routes, export routes, and all writes are
 * deliberately left out of this automatic run).
 *
 * Before the load ramp, a preflight pass hits every included route exactly once (sequentially, with
 * the signed-in token) and prints its status + response size, so you can see route-by-route whether
 * the API is really answering with data before trusting the aggregate ramp numbers.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpus } from 'node:os'
import autocannon from 'autocannon'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

const connectionsSteps = arg('connections', '10,50,100,200').split(',').map(Number).filter((n) => n > 0)
const duration = Number(arg('duration', '15'))
const outFile = arg('out', '')
const wantedServices = arg('services', 'auth,lead,products,c360').split(',').map((s) => s.trim())
const wantedPath = arg('path', '')
const method = arg('method', 'GET').toUpperCase()
const body = arg('body', '')
const pipelining = Number(arg('pipelining', '1')) || 1
const workers = Number(arg('workers', '')) || undefined
const skipPreflight = flag('skip-preflight')
const showTable = flag('table')
const cpuCount = cpus().length

const AUTH = process.env.AUTH_URL ?? 'http://localhost:5155'
const LEAD = process.env.LEAD_URL ?? 'http://localhost:5046/api/lead-service'
const C360 = process.env.C360_URL ?? 'http://localhost:5059'
const PRODUCTS = process.env.PRODUCTS_URL ?? 'http://localhost:5266'

// Every service: safe, parameterless GET routes only. No {id}-scoped routes (no guaranteed real id
// without seeding data first), no /export routes (heavy CSV generation), no internal/* routes
// (need X-Internal-Api-Key, not a client-facing route), no writes, no Customer360 indprofile /
// corpprofile or the other CRM-proxying routes (contactinfo, customerproduct, interactions,
// product/*) — those hit a real external CRM and need a real customer id. See plan for the reasoning.
const services = {
  auth: {
    label: 'AuthService',
    url: AUTH,
    paths: [
      '/health',
      '/health/live',
      '/api/auth/me',
      '/api/auth/password-policy',
      '/api/users?page=1&pageSize=10',
      '/api/users/summary',
      '/api/users/facets',
      '/api/roles?page=1&pageSize=10',
      '/api/approvals?page=1&pageSize=10',
      '/api/approvals/mine?page=1&pageSize=10',
      '/api/approvals/summary',
      '/api/approvals/facets',
      '/api/audit-logs?page=1&pageSize=10',
      '/api/audit-logs/summary',
      '/api/audit-logs/facets',
      '/api/checker-assignments?page=1&pageSize=10',
      '/api/checker-assignments/modules',
      '/api/dashboard/stats',
      '/api/navigation',
      '/api/permissions/catalog',
      '/api/remote-apps?page=1&pageSize=10',
      '/api/remote-apps/health',
      '/api/salutations',
      '/api/search?q=test',
      '/api/system-logs?page=1&pageSize=10',
      '/api/system-logs/summary',
      '/api/user-schema',
      '/api/validation-presets',
      '/api/me/capabilities',
    ],
  },
  lead: {
    label: 'LeadService',
    url: LEAD,
    paths: [
      '/health',
      '/health/live',
      '/permissions',
      '/api/leads?page=1&pageSize=10',
      '/api/audit-logs?page=1&pageSize=10',
      '/api/dashboard/kpis',
      '/api/dashboard/in-progress',
      '/api/dashboard/conversion-rate',
      '/api/dashboard/leads-over-time',
      '/api/dashboard/leads-by-product',
      '/api/dashboard/leads-by-branch',
      '/api/dashboard/recent-leads',
      '/api/dashboard/top-sales-executives',
      '/api/lead-field-config/formats',
    ],
  },
  products: {
    label: 'ProductsService',
    url: PRODUCTS,
    paths: [
      '/health',
      '/health/live',
      '/permissions',
      '/api/products?page=1&pageSize=10',
      '/api/products/status-counts',
      '/api/products/top-performers',
      '/api/applications?page=1&pageSize=10',
      '/api/applications/status-counts',
      '/api/categories?page=1&pageSize=10',
      '/api/audit-logs?page=1&pageSize=10',
      '/api/audit-logs/actions',
      '/api/audit-logs/summary',
      '/api/audit-logs/entity-types',
      '/api/dashboard/summary',
      '/api/dashboard/application-trends',
      '/api/dashboard/applications-by-category',
      '/api/dashboard/product-status-distribution',
      '/api/dashboard/top-products',
      '/api/dashboard/recent-products',
      '/api/dashboard/top-searches',
      '/api/document-definitions?page=1&pageSize=10',
      '/api/employment-types?page=1&pageSize=10',
      '/api/product-types?page=1&pageSize=10',
      '/api/promotions?page=1&pageSize=10',
      '/api/promotions/status-counts',
      '/api/ranking-configs',
      '/api/reviews?page=1&pageSize=10',
      '/api/status-configs',
    ],
  },
  c360: {
    label: 'Customer360Service',
    url: C360,
    paths: [
      '/health',
      '/health/live',
      '/permissions',
      '/v1/lookups',
      '/v1/field-config/individual',
      '/v1/field-config/corporate',
      '/v1/audit?page=1&pageSize=10',
    ],
  },
}

function readEnvFile(path) {
  const values = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m) values[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

async function signIn() {
  const envPath = join(here, '.env.loadtest')
  if (!existsSync(envPath)) return { skipped: 'scripts/loadtest/.env.loadtest not present (copy .env.loadtest.example)' }
  const env = readEnvFile(envPath)
  if (!env.LOADTEST_EMAIL || !env.LOADTEST_PASSWORD) return { skipped: '.env.loadtest lacks LOADTEST_EMAIL/LOADTEST_PASSWORD' }
  try {
    const res = await fetch(`${AUTH}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: env.LOADTEST_EMAIL, password: env.LOADTEST_PASSWORD }),
    })
    if (!res.ok) return { skipped: `sign-in failed with HTTP ${res.status}` }
    const body = await res.json()
    const token = body.accessToken ?? body.token
    return token ? { token } : { skipped: 'sign-in response carried no access token' }
  } catch (err) {
    return { skipped: `could not reach AuthService at ${AUTH} (${err.code ?? err.message}). Please make sure your backend services are running.` }
  }
}

function row(label, connections, result) {
  const nonOk = result.non2xx ?? 0
  return {
    service: label,
    connections,
    'req/s': Math.round(result.requests.average ?? 0),
    'p50 ms': +(result.latency.p50 ?? 0).toFixed(1),
    'p97.5 ms': +(result.latency.p97_5 ?? 0).toFixed(1),
    'p99 ms': +(result.latency.p99 ?? 0).toFixed(1),
    'max ms': +(result.latency.max ?? 0).toFixed(1),
    total: result.requests.total ?? 0,
    'non-2xx': nonOk,
    timeouts: result.timeouts ?? 0,
    errors: result.errors ?? 0,
  }
}

async function runService(key, def, token) {
  const defaultHeaders = token ? { Authorization: `Bearer ${token}` } : {}
  const requests = def.paths.map((path) => ({
    method,
    path,
    ...(body ? { body, headers: { ...defaultHeaders, 'Content-Type': 'application/json' } } : {}),
  }))
  const results = []
  for (const connections of connectionsSteps) {
    const result = await autocannon({
      url: def.url,
      requests,
      connections,
      duration,
      pipelining,
      ...(workers ? { workers } : {}),
      headers: defaultHeaders,
    })
    results.push({ raw: result, row: row(def.label, connections, result) })
  }
  return results
}

// One real request per route, sequentially, before the ramp — proves each route is actually
// reachable and returning data (not just "some status code came back") before we trust the
// aggregate req/s numbers from the ramp, where a bad route is invisible inside one non-2xx count.
async function preflight(def, token) {
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  }
  const rows = []
  for (const path of def.paths) {
    const url = `${def.url}${path}`
    const started = performance.now()
    try {
      const res = await fetch(url, {
        method,
        headers,
        ...(body && method !== 'GET' ? { body } : {}),
      })
      const text = await res.text()
      rows.push({ path, status: res.status, bytes: text.length, ms: +(performance.now() - started).toFixed(0) })
    } catch (err) {
      rows.push({ path, status: 'ERR', bytes: 0, ms: +(performance.now() - started).toFixed(0), error: String(err.message ?? err) })
    }
  }
  const bad = rows.filter((r) => r.status === 'ERR' || r.status < 200 || r.status >= 300)
  console.log(`  preflight: ${rows.length - bad.length}/${rows.length} routes returned 2xx with a body`)
  for (const r of bad) {
    console.log(`    ${String(r.status).padStart(4)}  ${r.bytes.toString().padStart(6)}B  ${String(r.ms).padStart(5)}ms  ${r.path}${r.error ? '  ' + r.error : ''}`)
  }
  return rows
}

const auth = await signIn()
if (auth.skipped) {
  console.log(`No signed-in token: ${auth.skipped}`)
  console.log('Most routes below need auth and will fail without a token. Create .env.loadtest first (see .env.loadtest.example).')
}

const activeServices = Object.entries(services)
  .filter(([key]) => wantedServices.includes(key))
  .map(([key, def]) => {
    if (wantedPath) {
      const filtered = def.paths.filter((p) => p.toLowerCase().includes(wantedPath.toLowerCase()))
      return [
        key,
        {
          ...def,
          paths: filtered.length > 0 ? filtered : [wantedPath.startsWith('/') ? wantedPath : `/${wantedPath}`],
        },
      ]
    }
    return [key, def]
  })
  .filter(([, def]) => def.paths.length > 0)

console.log(
  `OmniConnect autocannon run — services: ${activeServices.map(([, d]) => d.label).join(', ')} — ` +
    `connections ${connectionsSteps.join(', ')} x ${duration}s, pipelining ${pipelining}` +
    (workers ? `, ${workers} worker threads` : '') +
    (wantedPath ? `, path: "${wantedPath}"` : '') +
    (method !== 'GET' ? `, method: ${method}` : '') +
    (body ? `, body: ${body.length > 25 ? body.slice(0, 25) + '...' : body}` : ''),
)
console.log(
  workers
    ? `Detected ${cpuCount} CPU cores on this machine. Using ${workers} worker threads, ~${Math.ceil(connectionsSteps[0] / workers)}-${Math.ceil(connectionsSteps.at(-1) / workers)} connections per worker.`
    : `Detected ${cpuCount} CPU cores on this machine. --workers is unset; single-threaded is fine up to ~100-200 connections.`,
)
if (!workers && Math.max(...connectionsSteps) >= 200) {
  console.log(`Tip: at ${Math.max(...connectionsSteps)} connections, Node itself can become the bottleneck before the API does — try --workers ${Math.max(1, cpuCount - 1)} and compare.`)
}

const allResults = []
for (const [key, def] of activeServices) {
  console.log(`\n${def.label} (${def.url}) — ${def.paths.length} routes round-robined per connection`)
  if (!skipPreflight) await preflight(def, auth.token)
  const results = await runService(key, def, auth.token)
  if (showTable) {
    for (const { raw, row: r } of results) {
      console.log(`\n================ ${r.service} (${r.connections} connections) ================`)
      console.log(autocannon.printResult(raw))
    }
  } else {
    for (const { row: r } of results) {
      console.log(
        r.service.padEnd(20),
        String(r.connections).padStart(5),
        String(r['req/s']).padStart(8) + ' req/s',
        String(r['p50 ms']).padStart(8) + ' p50',
        String(r['p97.5 ms']).padStart(8) + ' p97.5',
        String(r['p99 ms']).padStart(8) + ' p99',
        String(r['non-2xx']).padStart(6) + ' non-2xx',
        String(r.timeouts).padStart(5) + ' timeouts',
        String(r.errors).padStart(5) + ' errors',
      )
    }
  }
  allResults.push({ service: key, label: def.label, url: def.url, results: results.map((r) => r.row) })
}

if (outFile) {
  writeFileSync(
    outFile,
    JSON.stringify(
      { at: new Date().toISOString(), connections: connectionsSteps, duration, signedInSkipped: auth.skipped ?? null, results: allResults },
      null,
      2,
    ),
  )
  console.log(`\nwrote ${outFile}`)
}
