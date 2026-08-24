# Performance: measured baseline, and the infrastructure work left to do

Measured on the local stack (five .NET services on one Windows machine) against the live Neon
Postgres databases, 2026-08-24. Numbers are from a real load test, not estimates.

## What was measured

Read path, `GET /api/roles?page=1&pageSize=25`, warm:

| Concurrency | p50 | p95 | p99 | max | approx req/s | failures |
|---|---|---|---|---|---|---|
| 50 | 581 ms | 732 ms | 747 ms | 747 ms | 81 | 0 |
| 100 | 592 ms | 2633 ms | 2723 ms | 2760 ms | 107 | 0 |
| 200 | 1055 ms | 1131 ms | 1171 ms | 1190 ms | 207 | 0 |
| 400 | 1856 ms | 2250 ms | 2305 ms | 2375 ms | 224 | 0 |

Write path, employee create at concurrency 10 × 5 rounds (50 writes): p95 876 ms, mean 848 ms,
**0 failures**. All 50 rows were deleted afterwards and cleanup was verified by re-querying the tag —
0 remaining.

Other read endpoints at concurrency 1 → 50, all with 0 failures: roles and audit-logs flat at
~570–590 ms; users-search flat at ~580–740 ms; approvals ~1.1–1.3 s; users-list and employees-list
step from ~620 ms at c=1 to a plateau of ~2.6–2.9 s from c=5 upward.

## What the numbers actually say

**The breaking point is ~220 requests/second.** Between concurrency 200 and 400 throughput moves
only from 207 to 224 req/s while p50 latency nearly doubles (1055 ms → 1856 ms). That is saturation:
past this point additional concurrency buys queueing delay, not work done.

**It degrades gracefully rather than failing.** Zero errors at every level tested, including 400
concurrent. Nothing times out, nothing 500s — requests simply wait. That is the good failure mode.

**Latency is dominated by network round-trip, not by this code.** The ~580 ms floor is present at
concurrency 1, where nothing is contended. The application is spending that time waiting on a remote
database, so most of the latency budget is gone before any query runs. This is the single biggest
lever available and it is not a code change — see below.

**The step at c=5 on two endpoints is worth watching.** `users list` and `employees list` jump to a
~2.6 s plateau while roles and audit-logs stay flat. A plateau rather than a climb points at a
connection-pool limit being reached and requests then queueing steadily behind it, not at a slow
query. Worth confirming with pool metrics under real traffic before tuning blind.

## Already done in the code

- `pageSize` clamped to 100 on every list endpoint across all five services. Two Customer 360 proxy
  endpoints previously forwarded an unbounded value to the upstream CRM, and two LeadService paths
  actively returned the **entire table** for an out-of-range page size.
- `AddDbContextPool` in all five services, replacing per-request context construction.
- `(IsDeleted, CreatedAt DESC)` and `Status` indexes on Leads — every lead list query filters and
  sorts on exactly those columns, and the previous `CreatedAt`-only index could not serve it.
- AuthService was already well covered: 29 indexes across its filter and sort columns.

## What cannot be fixed from inside this repository

Ordered by expected impact on the numbers above.

**1. Move the database next to the services (largest single win).** The ~580 ms floor is round-trip
latency to Neon. Nothing in application code can remove it. Co-locating the services and the database
in the same region — or moving to a managed Postgres in the same cloud region as the app servers —
should take the floor to single-digit or low-tens of milliseconds. Expect a multiple-times
improvement in every number in the table above, from one infrastructure decision.

**2. Connection pooling at the database edge.** Neon's connection limits are the likely cause of the
c=5 plateau. Use Neon's pooled connection string (PgBouncer) rather than the direct one, and size
`Maximum Pool Size` in each service's connection string deliberately rather than leaving the default.
Five services each holding their own pool against one database adds up quickly.

**3. Run more than one instance.** Everything above was measured against a single process per
service. Horizontal scaling behind a load balancer is the straightforward path past ~220 req/s.
Requires: a load balancer with health checks (each service already exposes `/health`), and
sticky-session-free request handling — which this stack already satisfies, since JWTs are stateless
and refresh tokens live in the database rather than in memory.

**4. A Redis cache and backplane.** Two distinct uses: caching the permission catalog and module
registry (read constantly, changed rarely), and acting as the backplane when real-time approval
notifications move to SignalR — the invalidation bus added in this pass is already
transport-agnostic, so wiring SignalR to it needs no consumer changes, but multi-instance SignalR
needs a backplane.

**5. Read replicas.** Only worth doing after (1) and (2). The audit log is append-heavy and read for
reporting; pointing audit and dashboard reads at a replica keeps them off the primary.

**6. A CDN for the frontends.** The host and three remotes are static bundles after build. Serving
them from a CDN removes that traffic from the application servers entirely and improves first-load
time for anyone far from the origin.

**7. Real observability before tuning further.** These numbers came from a synthetic test on one
machine. Before optimising anything else, get per-endpoint latency percentiles, database connection
pool utilisation, and slow-query logs from the real deployment. The c=5 plateau above is a specific,
testable hypothesis that production metrics would confirm or kill in minutes.

## How to reproduce

The load-test script is deliberately not committed — it writes to real databases and its cleanup
depends on the tagging scheme it uses. To re-run it, drive the endpoints above at increasing
concurrency, and if you include writes, tag every created row with a unique run id and verify removal
by re-querying that tag rather than trusting the delete responses.
