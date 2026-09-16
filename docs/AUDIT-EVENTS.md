# Audit events — the complete catalogue

Every row in the platform audit trail, what writes it, and when. The point of this file is to make
"does every meaningful backend event produce a row?" answerable without re-reading the code. When you
add an action key, add it here in the same change.

## The rules every row follows

1. **Only the service performing the action writes the row.** There is no endpoint a browser can
   write free-form audit rows through. `POST /api/audit-logs/activity` (AuthService) and `POST /v1/audit`
   (Customer360Service) were deleted: both accepted a caller-chosen service name with no permission
   check, so the trail could be written by anyone holding a session. They now answer 404/405.
   The single exception is page views (see *Navigation* below): the browser sends only a route, and
   AuthService decides whether it is a page that user can open and what it is called.
2. **The actor comes from the verified token**, never a request body or header. LeadService's old
   defaults (`USR-1001` / `Admin User` / `127.0.0.1`) and Customer360's `X-Staff-User` header are
   gone. Rows written before this change still show them, and are left untouched.
3. **Remote rows land in two places.** LeadService and Customer360Service keep their own local
   `audit_logs` table (which their own Audit Logs screen reads) and push the same event to AuthService
   through `InternalAuditLogsController` (API-key protected). AuthService's `AuditLogs` table is
   therefore the one place that answers "what did this person do, anywhere".
4. **Host rows are fully labelled.** Every in-process write goes through
   `AuditLogAppService.WriteHostAsync`, which requires a module and a category, so the Application,
   Module and Category filters on the Audit Logs screen match host activity too.
5. **One operation, one correlation id.** A gated change's `approval.requested`, the later
   `approval.approved`/`rejected`/`decision_refused`, the replayed mutation and any temp-password row
   all share the correlation id of the original request (`AuditLogAppService.SeedCorrelationId`), so
   the drawer's Related Activity shows the whole story. Remote pushes forward `X-Correlation-Id`.
6. **Refusals are events.** Anything that refuses a security-relevant action records it with
   `Result = Failure` and a `FailureReason`.

## Not events, deliberately

| Former client event | Why it is gone and not replaced |
|---|---|
| `audit_log.details_viewed` | Expanding a row the browser already holds fetches nothing. |
| `VIEW_SENSITIVE_DATA` (Customer 360 masked-field reveal) | `useFieldReveal` unmasks a value the browser already has; no request is made. Making this a real event means masking server-side and adding a reveal endpoint — a change to the Customer 360 data contract, out of scope here. |

Session revocation is not a separate key: when refresh-token reuse kills every session, the count
revoked is part of `auth.refresh_reuse_detected`, because the two are one event.

## AuthService (host) — `ServiceName = AuthService`, `SourceApplication = Host`

### Authentication — module `Authentication`, category `Auth`

| Key | Fires when | Actor | Can fail |
|---|---|---|---|
| `auth.login_succeeded` | Password or Google sign-in succeeds | the user | — |
| `auth.login_failed` | Sign-in refused (bad password, inactive, unknown email) | the account, when known | Failure |
| `auth.logout` | `POST /api/auth/logout` revokes a refresh token | the token's owner | — |
| `auth.refresh_reuse_detected` | An already-revoked refresh token is presented; every session for that user is revoked | the token's owner | Failure |
| `auth.password_changed` | A user changes their own password | the user | — |
| `auth.password_change_failed` | Change-password refused (wrong current password, policy) | the user | Failure |
| `auth.invite_issued` | A set-password invite link is issued | the admin issuing it | — |
| `auth.invite_redeemed` | A user sets their password from an invite | the invited user | — |

### Authorization — module `Authentication`, category `Authorization`

| Key | Fires when | Actor | Can fail |
|---|---|---|---|
| `authz.denied` | `[RequirePermission]` or `[RequiresFineCapability]` refuses a request; `FailureReason` names the missing permission | the caller | always Failure |
| `authz.internal_key_rejected` | `InternalApiKeyFilter` refuses a missing or wrong `X-Internal-Api-Key` | none (service call) | always Failure |

Only denials are written, never the far more numerous successes. The writer runs inside the filter
and swallows its own failures, so an audit outage can never turn a 403 into a 500.

### Users — module `Users`, category `CRUD`

| Key | Fires when | Details carry |
|---|---|---|
| `user.created` | A user is created (direct, or replayed on approval — attributed to the **maker**) | email |
| `user.updated` | A user is edited | each changed field `old → new`, role change called out |
| `user.activated` / `user.deactivated` | Status toggled | — |
| `user.deleted` | A user is deleted | — |
| `user.permission_overrides_replaced` | Per-user overrides change (direct or replay). Skipped when nothing changed | headline counting the direction access moved, then `{added, removed}` JSON |

### Roles — module `Roles`, category `CRUD`

| Key | Fires when | Details carry |
|---|---|---|
| `role.created` | A role is created | grants as `{added}` JSON |
| `role.updated` | A role is edited | `{added, removed}` grant diff, or "no permission changes" |
| `role.deleted` | A role is deleted | holders unassigned, grants lost |

The headline's granted/revoked counts follow the direction **access** moved, per capability. For a
per-user override that is not the same as which list a row is in: adding a `Revoke` override is a
revocation, and lifting one is a grant (`PermissionDiffDto.Summarise`, pinned by
`PermissionDiffSummaryTests`).

### Maker-Checker — module `Approvals`, category `Approval`

| Key | Fires when | Actor | Can fail |
|---|---|---|---|
| `approval.requested` | A gated mutation is queued instead of applied | maker | — |
| `approval.submit_conflicted` | A second request against a record that already has one pending is refused | maker | Failure |
| `approval.approved` | A checker approves and the replay commits | checker | — |
| `approval.rejected` | A checker rejects, with the reason | checker | — |
| `approval.decision_refused` | A decision is refused: the maker deciding their own request, someone other than the assigned checker (and not an administrator), or a request already decided | whoever tried | Failure |
| `approval.replay_failed` | Approving fails because the replay throws; the request stays Pending. Written outside the rolled-back transaction | checker | Failure |
| `approval.reassigned` | Pending requests move off a departing checker | the admin deactivating them | — |
| `user.temp_password_issued` | Approving a Create-User generates a one-time password for the maker to collect. The password itself is never logged | checker | — |
| `user.temp_password_revealed` | The maker collects it (succeeds once) | maker | — |

### Configuration — category `Configuration`

| Key | Module | Fires when |
|---|---|---|
| `checker_assignment.created` / `.deleted` | Checker Assignment | A module is gated or un-gated |
| `user_field_schema.updated` | User Schema | Manage Fields saved |
| `validation_preset_catalog.updated` | User Schema | Manage Formats saved |
| `salutation_catalog.updated` | User Schema | Salutations added or removed — "Added 'Prof.'. Removed 'Mrs.'." |
| `salutation_catalog.renamed` | User Schema | A salutation renamed; every profile holding it (deleted ones included) and pending user approvals change in the same transaction — "Renamed the salutation 'Mr' to 'Mr.'. 12 user profiles now show 'Mr.'." One row per rename |
| `remoteapp.permissions_resynced` | Applications | A remote's capability catalogue is re-read and rewritten |

### Navigation — category `Navigation`

| Key | Fires when | Written as |
|---|---|---|
| `page.viewed` | A signed-in person opens a page, host or remote (`POST /api/audit-logs/page-views`, sent by the host's `usePageViewTracking`) | `SourceApplication` = `Host` or the remote app's display name; `Module` = the sidebar label; `Details` = "Opened Lead Management → Create Lead." A user's profile is recorded with `EntityType = User` and "Opened the profile of Priya Nair.", so it appears on that user's audit tab too |

How it stays trustworthy and cheap:

- **The body is only a route.** `PageViewResolver` matches it against the caller's own navigation tree
  (built from their token, exactly as the sidebar is) plus the host pages reached outside the sidebar —
  `/profile`, `/settings/users`, `/settings/users/{id}`, and the settings drawer tabs — each with the
  permission its route requires. Anything else — a page the caller cannot open, a made-up app, a full
  URL, `..` — is refused with 400 and writes nothing.
- **One row per person per page per 30 seconds** (`PageViewAuditService.DedupeWindow`, held in
  `IPlatformCache`, so it holds across replicas with Redis).
- **Per-user rate limit** `RateLimitPolicies.PageViews` (`RateLimiting:PageViewPermitLimit`, default 60 per minute).
- **No live push.** Navigation rows skip the "audit log changed" broadcast and the KPI recompute, so an
  open Audit Logs screen does not refetch on every click anyone makes.
- The host skips addresses that are not visits: `/apps/{app}` before it redirects, `/settings` before it
  picks a tab, forms stacked on a drawer, apps showing their maintenance notice, and a route left within 800 ms.

### Applications — module `Applications`, category `CRUD`

`remoteapp.created`, `remoteapp.updated`, `remoteapp.status_changed`, `remoteapp.deleted`.

### Exports — category `Export`

Data leaving the platform is an event. Each row records the row count **and the filter set that
produced the file**, so the export can be reproduced.

| Key | Module | Endpoint |
|---|---|---|
| `audit_log.exported` | Audit Logs | `GET /api/audit-logs/export` (also the per-user Activity export, via `actorUserId`) |
| `system_log.exported` | System Logs | `GET /api/system-logs/export` |
| `approval.exported` | Approvals | `GET /api/approvals/export` (needs the `Export` capability on approvals) |

## LeadService — `SourceApplication = Lead Management`

Written locally and pushed centrally.

| Key | Fires when | Notes |
|---|---|---|
| `lead.created` / `lead.updated` / `lead.deleted` | Lead CRUD, direct or replayed on approval | On replay, `AuditActorContext` attributes the row to the **maker** |
| `lead.viewed` | A lead's full record is opened (`POST /api/leads/{id}/view-audit`, a real request the server handles) | |
| `leadfieldconfig.updated` | Lead field settings saved | category `Configuration` |
| `lead.audit_log.exported` | `GET /api/lead-service/api/audit-logs/export` | category `Export` |

## Customer360Service — `SourceApplication = Customer 360`

Written locally (its own vocabulary, shown second) and pushed centrally by `Customer360AuditWriter`,
except where marked.

| Central key | Local action | Fires when | Can fail |
|---|---|---|---|
| `customer360.profile_viewed` | `VIEW_PROFILE` | An individual or corporate profile loads | — |
| `customer360.profile_searched` | `SEARCH` | A profile lookup runs, including one the CRM answers with an error | Failure |
| `customer360.audit_log.exported` | `EXPORT` | `GET /v1/audit/export` | — |
| `fieldconfig.updated` | *(central only)* | Customer 360 field settings saved | — |

Customer 360's local `Timestamp` is a UTC `timestamptz` (migration
`AuditLogTimestampToUtcInstant`). It used to be a local wall-clock **string**, which made range
filtering impossible. The migration reads legacy text as UTC — see `LegacyTimestampZone` in that
migration for the assumption and how to change it.

## Filtering and export — the same on every log screen

All five log screens (host Audit Logs, System Logs, Approval Center, Lead Audit Logs, Customer 360
Audit Trail) and the per-user Activity tab use one date-range control from `@omniremit/ui`
(`DateRangeColumnFilter` / `DateRangeFilterButton`, backed by `resolveDateRange`):

- **Local-time semantics.** Presets snap to calendar-day boundaries in the viewer's timezone. The
  upper bound is inclusive at `23:59:59.999`. The browser sends UTC `from`/`to` instants, and every
  service filters on a real instant.
- **One filter object for list and export.** Each service builds its list query and its export query
  from the same filter — `AuditLogFilter` and `ApprovalFilter` in AuthService, `AuditQuery` in
  Customer360Service, one shared query builder in LeadService — so a CSV always answers the same
  question as the table it was launched from.
- **Every filter is a server-side predicate, and paging is the server's.** No log screen filters
  the rows it happens to have fetched any more: host Audit Logs (actor, record, IP, device, sign-in
  method), the Approval Center (action, maker, checker, record, assignment, and Processed as one
  `Approved,Rejected` query), Lead audit (actor, outcome) and Customer 360 audit (outcome, actor,
  customer, description) all send them as query parameters. Dropdown options for bounded columns come
  from `facets` endpoints under the filters already applied; suggestions for unbounded free text
  (names, IPs, record labels) still come from the rows on screen, while the filter they feed is
  complete.
- **One export helper** (`downloadCsv`): sends the token, refreshes once on a 401, and reports
  truncation. Every export endpoint returns `X-Export-Row-Count`, `X-Export-Match-Count`,
  `X-Export-Row-Limit` and `X-Export-Truncated` (exposed through CORS). A capped file says so instead
  of arriving silently incomplete.
- **Formula-injection safe.** CSV fields starting with `= + - @` are neutralised (`CsvBuilder`).
