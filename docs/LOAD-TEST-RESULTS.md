# Load test results — 2026-09-15

A measured run against the whole local stack with generated volume, followed by verified deletion of
that volume. What was measured is reported as measured; what a production deployment would need is
labelled as extrapolation.

## How it was run

| | |
|---|---|
| Machine | One Windows 11 laptop running the 4 .NET services, the 3 remotes, the host **and** the load client |
| Database | Neon Postgres (us-east-2 pooler), shared with the team. **~285 ms round trip from this machine** |
| Rate limiting | Left on (production settings). List endpoints are not rate limited; sign-in and page-view writes are |
| Volume tool | `Backend/LoadTest/OmniRemit.LoadTest` — `seed`, `count`, `cleanup --run <id>` |
| Throughput | `scripts/loadtest/http-load.mjs` — concurrency ramp 10 → 50 → 100 → 200, 12–15 s per step |
| Signed-in latency | `scripts/loadtest/browser-bench.js` — run in a signed-in host tab, 30 requests per endpoint, 6 concurrent |

Every generated row carries the run id and was removed by it; nothing else is touched:

| Table | Tag |
|---|---|
| AuthDb.AuditLogs | `ServiceName = 'LoadTest'`, `CorrelationId = 'loadtest-<run>'` |
| AuthDb.Users | e-mail ends `@<run>.loadtest.invalid`; Inactive and no password, so they cannot sign in |
| LeadDb.Leads | `LeadReference` starts `LT-<run>-` |
| Products | category / type / product code `loadtest-<run>`, and every application under that product |

### Dataset (run `r3load`)

| Table | Before | Generated | Insert time |
|---|---|---|---|
| AuthDb.AuditLogs | 650 | **100,000** (spread over 180 days) | 61.7 s (1,622 rows/s) |
| AuthDb.Users | 3 | **20,000** | 11.8 s |
| LeadDb.Leads | 7 | **50,000** | 31.9 s |
| Products.Applications | 50 | **50,000** | 25.7 s |
| **Total** | | **220,003 rows** | ~2.2 min |

### Cleanup — verified

```
AuthDb.AuditLogs deleted: 100,000
AuthDb.Users deleted:     20,000
LeadDb.Leads deleted:     50,000
Products deleted: 50,000 applications, 1 product, 1 type, 1 category
cleanup took 13.5s
TOTAL tagged rows: 0
CLEANUP VERIFIED: 0 tagged rows remain.
```

Tables returned to their pre-test totals (the one extra audit row is a real page view recorded while
the UI was being checked). The Users page was re-checked in the browser: 3 users.

## Results

### Signed-in API latency: small data vs 220k rows (p50 / p95, ms)

| Endpoint | Small data | With volume | What the number is |
|---|---|---|---|
| Navigation (cached tree) | 15 / 17 | 15 / 28 | no DB round trip |
| Audit list, page 1 | 599 / 2769¹ | 580 / 621 | count + page = 2 round trips |
| Audit list, page 5,000 (offset 50,000) | 594 / 627 | **821 / 1076** | deep OFFSET scan |
| Audit list, module + result filter | 600 / 621 | 616 / 682 | |
| Audit summary | 1187 / 1210 | 1141 / 1198 | 4 aggregate queries |
| Audit facets | 1771 / 2228 | **1984 / 2189** | 6 distinct-value queries, sequential |
| Users list, page 1 | 593 / 607 | 604 / 645 | |
| Users list, page 1,000 | 590 / 613 | 665 / 686 | |
| Users mobile-digits filter | 591 / 612 | 682 / 756 | `regexp_replace` over every row |
| Users quick search | 596 / 610 | 679 / 818 | |
| Users summary | 884 / 913 | 870 / 1123 | 3 counts |
| Lead list, page 1 | 569 / 2547¹ | 585 / 2688¹ | |
| Lead list, page 2,500 | 570 / 582 | 613 / 695 | |
| Lead search (contains) | 565 / 584 | **1130 / 1192** | 6-column `ILIKE '%…%'` across joins |
| Applications, page 1 | 571 / 2281¹ | 587 / 2440¹ | |
| Applications, page 2,500 | 576 / 595 | 634 / 768 | |
| Applications search | 569 / 581 | 814 / 949 | |
| Application status counts | 291 / 318 | 302 / 330 | one GROUP BY |

¹ The first requests after a quiet period open new pooled connections; a TLS handshake to Neon from
here takes ~2 s. It shows as a p95 outlier on whichever endpoint happens to run first.

**Reading:** with 150–600× more rows, every list stays within ~15% of its small-data latency except
three: deep audit paging (+230 ms), lead search (+565 ms) and applications search (+245 ms). Nothing
returned an error. The floor on every endpoint is the ~285 ms round trip per query, not the query.

### Throughput ramp (req/s, p50 ms; 0 errors and 0 unexpected statuses at every step)

| Endpoint | c=10 | c=50 | c=100 | c=200 |
|---|---|---|---|---|
| `/health` (opens a DB connection), each of 4 services | ~31 / 285 | ~155 / 283 | ~320 / 282 | **~345 / 557** |
| `/health/live` (added in this pass, no dependencies) | 3,563 / 2.8 | 3,208 / 14.5 | 3,281 / 28.6 | **3,358 / 57** |
| Protected list without a token → 401 (routing, CORS, JWT) | 4,869 / 1.9 | 4,792 / 9.7 | 4,577 / 20.9 | 4,529 / 42 |

**Reading:** the DB-backed endpoints scale linearly until ~100 concurrent and then hold at ~350 req/s
while latency doubles — requests queue for the Npgsql pool (default 100 connections) rather than
failing. The request pipeline without a database holds ~3,300–4,800 req/s flat, which is the CPU of this
laptop shared with the load client, not a server limit.

## Found and fixed during the run

| Finding | Fix |
|---|---|
| Liveness probes had to use `/health`, which opens a DB connection on every call — at a few hundred probes a second they compete with real requests for the pool | `/health/live` on all four services (no dependency checks). `/health` stays the readiness check |
| The benchmark first reported ~3.4 s for every endpoint | Chrome serializes concurrent GETs to an identical URL behind its HTTP cache lock; the bench now sends distinct `no-store` requests. Real single-request latency confirmed at 570 ms / 283 ms by Resource Timing |
| Users page could never see past 100 users (fixed earlier this round) | Confirmed at volume: 20,003 users counted, the 20,000th generated user found by search and by type-ahead |
| Application list loaded documents, field values and history for every row (fixed earlier this round) | Confirmed at volume: page 2,500 of 50,000 in 634 ms |

## Not done, and why

- **Signed-in throughput ramp.** `http-load.mjs` supports it, but it needs a non-administrator test
  account whose credentials the user puts in `scripts/loadtest/.env.loadtest` (git-ignored). Creating
  accounts or handling passwords was out of bounds for this run. Signed-in *latency* was measured from a
  real signed-in browser session instead.
- **Lead search and deep OFFSET paging** were measured, not changed. Options below.

## What "a million users" would need — extrapolation, not measured

This laptop cannot generate a million users' traffic, and the DB is 285 ms away. From the numbers above:

1. **Put the database next to the services.** Every endpoint's floor is N × 285 ms. In the same region
   (≈1 ms), a 2-query list becomes single-digit ms and the ~350 req/s pool plateau rises by roughly the
   same factor. This is the largest single lever and needs no code change.
2. **Scale out horizontally.** The services are stateless; `ConnectionStrings:Redis` switches the cache,
   distributed lock and SignalR backplane to Redis (already built in). Use `/health/live` for liveness
   and `/health` for readiness.
3. **Size connection pools deliberately** (`Maximum Pool Size`) against the database's connection limit
   across all replicas, or front Postgres with PgBouncer / Neon's pooler in transaction mode.
4. **Search at scale:** a `pg_trgm` GIN index on the lead and application search columns, or a search
   service, so "contains" does not scan. Deep paging: keyset (seek) pagination on `(OccurredAt, Id)` for
   audit history instead of OFFSET.
5. **Read replicas** for audit, facets and summaries, which are read-heavy and tolerate a second of lag.

## Re-running

```bash
cd Backend/LoadTest/OmniRemit.LoadTest
dotnet run -- seed --run myrun          # optional: --audit N --users N --leads N --applications N
dotnet run -- count --run myrun
node ../../../scripts/loadtest/http-load.mjs --out results.json
# signed-in latency: paste scripts/loadtest/browser-bench.js into a signed-in host tab, await omniBench()
dotnet run -- cleanup --run myrun       # exits non-zero unless 0 tagged rows remain
```
