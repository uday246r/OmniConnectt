#!/usr/bin/env node
/*
 * HTTP load driver for the local OmniRemit stack. No dependencies (Node 20+ built-in fetch).
 *
 *   node scripts/loadtest/http-load.mjs                       # default ramp 10,50,100,200 × 15s
 *   node scripts/loadtest/http-load.mjs --steps 10,50 --seconds 10 --out results.json
 *
 * Anonymous scenarios always run: health probes, and protected list endpoints called without a token
 * (exercises routing, CORS, JWT validation and the 401 path under load).
 *
 * Signed-in scenarios run only when scripts/loadtest/.env.loadtest exists with
 *   LOADTEST_EMAIL=...        a NON-administrator test account created for this purpose
 *   LOADTEST_PASSWORD=...
 * The script signs in once and reuses the access token; the file is git-ignored and its values are
 * never printed. Without it those scenarios are reported as skipped.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const steps = arg('steps', '10,50,100,200').split(',').map(Number).filter((n) => n > 0)
const seconds = Number(arg('seconds', '15'))
const only = arg('only', '')
const outFile = arg('out', '')

// Node's built-in fetch keeps connections alive and does not cap connections per origin, so the
// client does not throttle the higher steps.

const AUTH = process.env.AUTH_URL ?? 'http://localhost:5155'
const LEAD = process.env.LEAD_URL ?? 'http://localhost:5046/api/lead-service'
const C360 = process.env.C360_URL ?? 'http://localhost:5059'
const PRODUCTS = process.env.PRODUCTS_URL ?? 'http://localhost:5266'

const anonymous = [
  { name: 'auth /health/live (no dependencies)', url: `${AUTH}/health/live`, expect: [200] },
  { name: 'auth /health', url: `${AUTH}/health`, expect: [200] },
  { name: 'lead /health', url: `${LEAD}/health`, expect: [200] },
  { name: 'c360 /health', url: `${C360}/health`, expect: [200] },
  { name: 'products /health', url: `${PRODUCTS}/health`, expect: [200] },
  { name: 'auth audit list, no token (401)', url: `${AUTH}/api/audit-logs?page=1&pageSize=10`, expect: [401] },
  { name: 'products applications, no token (401)', url: `${PRODUCTS}/api/applications?page=1&pageSize=10`, expect: [401] },
]

const signedIn = (token) => [
  { name: 'auth navigation', url: `${AUTH}/api/navigation`, token, expect: [200] },
  { name: 'auth audit list p1', url: `${AUTH}/api/audit-logs?page=1&pageSize=10`, token, expect: [200, 403] },
  { name: 'auth users list', url: `${AUTH}/api/users?page=1&pageSize=10`, token, expect: [200, 403] },
  { name: 'lead list', url: `${LEAD}/api/leads?page=1&pageSize=10`, token, expect: [200, 403] },
  { name: 'products applications', url: `${PRODUCTS}/api/applications?page=1&pageSize=10`, token, expect: [200, 403] },
]

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

async function runStep(scenario, concurrency) {
  const latencies = []
  const statuses = new Map()
  let errors = 0
  const deadline = performance.now() + seconds * 1000
  const headers = scenario.token ? { Authorization: `Bearer ${scenario.token}` } : {}

  async function worker() {
    while (performance.now() < deadline) {
      const started = performance.now()
      try {
        const res = await fetch(scenario.url, { headers })
        await res.arrayBuffer()
        latencies.push(performance.now() - started)
        statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1)
      } catch {
        errors++
      }
    }
  }

  const began = performance.now()
  await Promise.all(Array.from({ length: concurrency }, worker))
  const elapsed = (performance.now() - began) / 1000
  latencies.sort((a, b) => a - b)
  const total = latencies.length
  const unexpected = [...statuses.entries()].filter(([s]) => !scenario.expect.includes(s)).reduce((n, [, c]) => n + c, 0)
  return {
    scenario: scenario.name,
    concurrency,
    requests: total,
    rps: Math.round(total / elapsed),
    p50: +percentile(latencies, 50).toFixed(1),
    p95: +percentile(latencies, 95).toFixed(1),
    p99: +percentile(latencies, 99).toFixed(1),
    max: +(latencies.at(-1) ?? 0).toFixed(1),
    unexpectedStatus: unexpected,
    rateLimited: statuses.get(429) ?? 0,
    networkErrors: errors,
    statuses: Object.fromEntries(statuses),
  }
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
  if (!existsSync(envPath)) return { skipped: 'scripts/loadtest/.env.loadtest not present' }
  const env = readEnvFile(envPath)
  if (!env.LOADTEST_EMAIL || !env.LOADTEST_PASSWORD) return { skipped: '.env.loadtest lacks LOADTEST_EMAIL/LOADTEST_PASSWORD' }
  const res = await fetch(`${AUTH}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.LOADTEST_EMAIL, password: env.LOADTEST_PASSWORD }),
  })
  if (!res.ok) return { skipped: `sign-in failed with HTTP ${res.status}` }
  const body = await res.json()
  const token = body.accessToken ?? body.token
  return token ? { token } : { skipped: 'sign-in response carried no access token' }
}

const results = []
const auth = await signIn()
const scenarios = [...anonymous, ...(auth.token ? signedIn(auth.token) : [])].filter((s) => !only || s.name.includes(only))

console.log(`OmniRemit HTTP load — steps ${steps.join(', ')} × ${seconds}s, ${scenarios.length} scenarios`)
if (auth.skipped) console.log(`signed-in scenarios skipped: ${auth.skipped}`)
console.log('scenario'.padEnd(42), 'conc'.padStart(5), 'req/s'.padStart(7), 'p50'.padStart(7), 'p95'.padStart(7), 'p99'.padStart(7), 'bad'.padStart(5), '429'.padStart(5), 'err'.padStart(5))

for (const scenario of scenarios) {
  for (const concurrency of steps) {
    const r = await runStep(scenario, concurrency)
    results.push(r)
    console.log(r.scenario.padEnd(42), String(r.concurrency).padStart(5), String(r.rps).padStart(7), String(r.p50).padStart(7), String(r.p95).padStart(7), String(r.p99).padStart(7), String(r.unexpectedStatus).padStart(5), String(r.rateLimited).padStart(5), String(r.networkErrors).padStart(5))
  }
}

if (outFile) {
  writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), steps, seconds, signedInSkipped: auth.skipped ?? null, results }, null, 2))
  console.log(`wrote ${outFile}`)
}
