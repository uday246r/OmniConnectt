/*
 * Signed-in API latency benchmark, run inside a signed-in OmniRemit host tab.
 *
 * Paste into the browser console on http://localhost:5173 (or run it through a browser automation
 * "evaluate" call) and await the promise:
 *
 *     await omniBench({ rounds: 20, concurrency: 6 })
 *
 * It uses the host's own session (window.__omniremitHost__.getAccessToken()), so no credential or
 * token is ever copied anywhere — the requests leave from the page exactly as the app's would. The
 * browser caps connections per origin (6 on HTTP/1.1), so this measures latency at realistic
 * per-user concurrency, not server throughput; scripts/loadtest/http-load.mjs covers throughput.
 *
 * Every endpoint is a read. Nothing is created, changed or deleted.
 */
async function omniBench({ rounds = 20, concurrency = 6, deepPages = {} } = {}) {
  const AUTH = 'http://localhost:5155'
  const LEAD = 'http://localhost:5046/api/lead-service'
  const PRODUCTS = 'http://localhost:5266'
  const token = window.__omniremitHost__?.getAccessToken?.()
  if (!token) throw new Error('Not signed in: open the host and sign in first.')

  const endpoints = [
    ['auth navigation', `${AUTH}/api/navigation`],
    ['audit list p1', `${AUTH}/api/audit-logs?page=1&pageSize=10`],
    ['audit list deep page', `${AUTH}/api/audit-logs?page=${deepPages.audit ?? 5000}&pageSize=10`],
    ['audit list filtered (module+result)', `${AUTH}/api/audit-logs?page=1&pageSize=10&module=Users&result=Failure`],
    ['audit summary', `${AUTH}/api/audit-logs/summary`],
    ['audit facets', `${AUTH}/api/audit-logs/facets`],
    ['users list p1', `${AUTH}/api/users?page=1&pageSize=10`],
    ['users list deep page', `${AUTH}/api/users?page=${deepPages.users ?? 1000}&pageSize=10`],
    ['users phone digits filter', `${AUTH}/api/users?page=1&pageSize=10&phone=601200`],
    ['users quick search', `${AUTH}/api/users?page=1&pageSize=10&search=load%20user%2001`],
    ['users summary', `${AUTH}/api/users/summary`],
    ['users facets', `${AUTH}/api/users/facets`],
    ['lead list p1', `${LEAD}/api/leads?page=1&pageSize=10`],
    ['lead list deep page', `${LEAD}/api/leads?page=${deepPages.leads ?? 2500}&pageSize=10`],
    ['lead search', `${LEAD}/api/leads?page=1&pageSize=10&search=load%20customer%20000`],
    ['products applications p1', `${PRODUCTS}/api/applications?page=1&pageSize=10`],
    ['products applications deep page', `${PRODUCTS}/api/applications?page=${deepPages.applications ?? 2500}&pageSize=10`],
    ['products applications search', `${PRODUCTS}/api/applications?page=1&pageSize=10&search=applicant%20000`],
    ['products status counts', `${PRODUCTS}/api/applications/status-counts`],
  ]

  const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
  const results = []

  for (const [name, url] of endpoints) {
    const times = []
    const statuses = {}
    let bytes = 0
    let next = 0
    // One warm-up request so connection setup is not counted against the endpoint.
    await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.arrayBuffer()).catch(() => {})
    const worker = async () => {
      while (next < rounds) {
        const n = next++
        const started = performance.now()
        try {
          // A distinct URL and no-store per request: Chrome serializes concurrent GETs to an identical
          // URL behind its HTTP cache lock, which made six "parallel" workers run one at a time and
          // reported ~6x the real latency for every endpoint.
          const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}_bench=${n}-${Date.now()}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          })
          const body = await res.arrayBuffer()
          bytes = body.byteLength
          statuses[res.status] = (statuses[res.status] ?? 0) + 1
        } catch {
          statuses.error = (statuses.error ?? 0) + 1
        }
        times.push(performance.now() - started)
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
    times.sort((a, b) => a - b)
    results.push({
      endpoint: name,
      n: times.length,
      p50: Math.round(pct(times, 50)),
      p95: Math.round(pct(times, 95)),
      max: Math.round(times.at(-1)),
      status: Object.entries(statuses).map(([s, c]) => `${s}×${c}`).join(' '),
      kb: +(bytes / 1024).toFixed(1),
    })
  }
  console.table(results)
  return results
}
