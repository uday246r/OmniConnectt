# OmniRemit Authentication & Authorization — Complete Deep-Dive Guide

A step-by-step map of how authentication and authorization work across the OmniRemit host + remote micro-frontend architecture, with exact file references, organized as a buildable tutorial: what exists, where it lives, why it was built that way, and how to reproduce the same design in a new system. Covers three layers: (1) backend authentication (AuthService), (2) backend authorization/RBAC, (3) frontend + module-federation wiring.

> ⚠️ **Two topology changes postdate this document; the concepts are unchanged.**
>
> 1. **`ModuleRegistry` no longer exists.** Wherever this document describes it fetching a remote's
>    `GET /permissions` and **pushing** the result into AuthService over an internal API-key-protected
>    HTTP call, that is now an in-process call inside AuthService itself
>    (`RemoteAppAppService` → `RemoteCapabilityDiscoveryClient` → `PermissionCatalogAppService`).
>    AuthDb is the single source of truth for remote apps. The permission *model* — dynamic per-feature
>    capabilities, the Api-vs-fine-grained delivery split, the `perms` claim — is exactly as described.
>
>    One rule worth adding: capability discovery distinguishes **null from empty**. Null means the
>    remote could not be read and the stored capability set is left alone; an empty list is a positive
>    answer and deactivates it. Collapsing the two would let one unreachable remote revoke every
>    permission it grants.
>
> 2. **`EmployeeService` / `employee_mf` were removed.** Sections using them as the worked example
>    describe a real design; substitute `lead` / `LeadService` or `customer360` / `Customer360Service`.
>
> Line-number references throughout have drifted. Trust the file names, verify the lines.

---

## 0. The big picture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                          │
│  ┌───────────────┐   window.__omniremitHost__ bridge             │
│  │  Host shell     │──────────────┬──────────────┬───────────────│
│  │  (Vite MF host) │              │              │               │
│  └───────┬─────────┘   ┌──────────▼──┐  ┌────────▼───┐  ┌────────▼───┐
│          │              │ employee_mf │  │  lead_mf    │  │customer360_│
│          │              │  (remote)   │  │  (remote)   │  │mf (remote) │
│          │              └──────┬──────┘  └──────┬──────┘  └──────┬─────┘
└──────────┼─────────────────────┼────────────────┼────────────────┼──────┘
           │ JWT (Authorization header) on every call, each to a DIFFERENT backend
           ▼                     ▼                ▼                ▼
   ┌───────────────┐     ┌─────────────┐  ┌─────────────┐  ┌────────────────┐
   │  AuthService   │     │EmployeeSvc  │  │  LeadSvc    │  │Customer360Svc  │
   │ (issues JWTs,  │     │(validates   │  │(validates   │  │(validates      │
   │  owns RBAC,    │     │ JWT w/ same │  │ JWT w/ same │  │ JWT w/ same    │
   │  audit, appro- │     │ public key) │  │ public key) │  │ public key)    │
   │  vals)         │     └─────────────┘  └─────────────┘  └────────────────┘
   └───────┬────────┘
           │ RSA private key signs; public key distributed to every backend
           │
   ┌───────▼────────┐
   │ ModuleRegistry  │  aggregates each remote's /permissions endpoint →
   │                 │  pushes into AuthService's PermissionFeature catalog
   └─────────────────┘
```

Key architectural decisions to internalize before the details:

- **One identity provider, many resource servers.** AuthService is the only thing that authenticates users and issues tokens. Every other backend (EmployeeService, LeadService, Customer360Service, ModuleRegistry) independently *validates* the same JWT using an **RSA public key** — no shared secret, no network call back to AuthService per request.
- **Permissions are computed once, server-side, and shipped inside the JWT** as a flat `"featureKey:Capability"` string array. Enforcement everywhere else is pure in-memory string matching against that claim — zero DB/network calls per authorization check.
- **The permission catalog is dynamic, not hardcoded.** Each remote backend declares its own permissions via attributes on its controllers; ModuleRegistry discovers them and pushes them into AuthService's catalog, so the host's Role editor and every enforcement point "just knows" about new remote capabilities without code changes in AuthService or the host.
- **The frontend token never touches localStorage.** It lives in memory in a Zustand store; a `window.__omniremitHost__` bridge object exposes it (live-read, not copied) to every mounted remote micro-frontend.

---

## 1. Backend Authentication (AuthService)

### 1.1 Data model

- [`Backend/AuthService/Domain/Entities/User.cs`](Backend/AuthService/Domain/Entities/User.cs) — `PasswordHash` is **nullable** (null for Google-provisioned accounts), `AuthProvider` enum, `MustChangePassword` flag, single `RoleId`.
- [`Backend/AuthService/Domain/Entities/RefreshToken.cs`](Backend/AuthService/Domain/Entities/RefreshToken.cs) — `TokenHash` (SHA-256; raw value never persisted), `ExpiresAt`, `AbsoluteExpiresAt` (session cap, inherited across rotations), `RevokedAt`, `ReplacedByTokenId`.
- [`Backend/AuthService/Domain/Entities/SetPasswordInvite.cs`](Backend/AuthService/Domain/Entities/SetPasswordInvite.cs) — same hash-only-storage pattern as refresh tokens, for invite links.

### 1.2 Login endpoint and password verification

- [`Backend/AuthService/Controllers/AuthController.cs`](Backend/AuthService/Controllers/AuthController.cs) `POST /api/auth/login` (lines 25-44) — `[AllowAnonymous]`, rate-limited (`RateLimitPolicies.Authentication`), delegates to `AuthAppService.LoginAsync`.
- [`Backend/AuthService/Application/Services/AuthAppService.cs`](Backend/AuthService/Application/Services/AuthAppService.cs) `LoginAsync` (lines 43-76):
  - Loads `User` + `Role` with EF Core `Include`.
  - Line 54: `user is null || user.PasswordHash is null || !passwordHasher.Verify(...)` → **one generic `InvalidCredentialsException`** for "no such user," "wrong password," and "Google-only account" alike — deliberately avoids leaking which case occurred.
  - Line 60: checks `UserStatus.Active`.
  - Every failure path writes to the audit log (`LogLoginFailureAsync`, lines 156-160) without exposing the reason in the HTTP response.
- Password hashing: [`Backend/AuthService/Infrastructure/Security/PasswordHasher.cs`](Backend/AuthService/Infrastructure/Security/PasswordHasher.cs) — wraps ASP.NET Core Identity's `PasswordHasher<User>` (PBKDF2), not BCrypt.

**To build this yourself:** never let login return different error codes/messages for "user not found" vs "wrong password" — that's a user-enumeration vector. Always hash with a vetted KDF (PBKDF2/Argon2/bcrypt), never roll your own.

### 1.3 JWT issuance (RS256, asymmetric)

- [`Backend/AuthService/Infrastructure/Security/JwtTokenService.cs`](Backend/AuthService/Infrastructure/Security/JwtTokenService.cs) `CreateAccessToken` (lines 31-71):
  - **RS256**, not HS256 — AuthService holds the private key; every other service only ever needs the public key. This is the design choice that lets remote backends validate tokens offline without trusting AuthService with a shared secret.
  - Claims: `sub` (user id), `email`, `name`, `jti`, `administrator` ("true"/"false"), `perms` (JSON array of `"featureKey:Capability"` strings), `mustChangePassword`, and `role` (confusingly holds the **role id GUID**, not a name).
  - Expiry: short-lived, `AccessTokenMinutes` (default 15) from [`Backend/AuthService/Options/JwtOptions.cs`](Backend/AuthService/Options/JwtOptions.cs).
- Keys loaded from PEM via [`Backend/AuthService/Infrastructure/Security/RsaKeyLoader.cs`](Backend/AuthService/Infrastructure/Security/RsaKeyLoader.cs).
- Permissions are computed fresh on every login/refresh by [`Backend/AuthService/Infrastructure/Security/PermissionClaimsBuilder.cs`](Backend/AuthService/Infrastructure/Security/PermissionClaimsBuilder.cs) `BuildAsync` — unions role grants with per-user `UserPermissionOverride` rows (Grant/Revoke), restricted to active features. **Never cached** — this is what makes "edit a role → the affected user sees it immediately after a refresh" possible (see §4.5).

**To build this yourself:** use RS256 (or ES256) when multiple independent services must validate tokens — it lets you distribute a public key freely while the private key stays in exactly one service. Keep access tokens short (10-15 min) and put a snapshot of authorization data (permissions) directly in the token so downstream services don't need a network round-trip to check "can this user do X."

### 1.4 Token validation middleware (repeated per-service)

Both AuthService and every resource server ([`Backend/AuthService/Program.cs`](Backend/AuthService/Program.cs) lines 119-166, [`Backend/EmployeeService/Program.cs`](Backend/EmployeeService/Program.cs) line ~77, similarly LeadService/Customer360Service/ModuleRegistry) configure:

```csharp
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false; // CRITICAL — see below
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true, ValidIssuer = jwtIssuer,
            ValidateAudience = true, ValidAudience = jwtAudience,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
            IssuerSigningKey = new RsaSecurityKey(validationRsa), // PUBLIC key only, outside AuthService
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    });
```

Two gotchas worth remembering for next time:
1. **`MapInboundClaims = false` is mandatory.** Without it, ASP.NET Core silently remaps short claim names like `sub` to long `ClaimTypes` URIs, and any code reading `User.FindFirst(JwtRegisteredClaimNames.Sub)` gets `null` with no error.
2. Each service falls back to generating an **ephemeral in-memory RSA key** if `Jwt__SigningKeyPublic` isn't configured, purely so the DI pipeline can wire up at boot — real tokens then fail signature validation until the real key is set. Good defensive pattern for making a missing-config problem loud (auth failures) rather than silent (app crash at startup).

### 1.5 Refresh tokens — rotate-on-use with theft detection

Full mechanism in [`Backend/AuthService/Infrastructure/Security/RefreshTokenService.cs`](Backend/AuthService/Infrastructure/Security/RefreshTokenService.cs):

- `IssueAsync` (24-58): 64 random bytes → base64url token; **only the SHA-256 hash is persisted**, the raw value exists only in the outgoing httpOnly cookie.
- `RotateAsync` (67-107): looks up by hash. **If the matched row is already `RevokedAt`-set, this is a replay/theft signal** — every active token for that user is revoked (`RevokeAllForUserAsync`) and the rotation is refused. Otherwise, issue a new token, mark the old one `RevokedAt` + `ReplacedByTokenId`.
- Cookie config: [`Backend/AuthService/Options/AuthCookieOptions.cs`](Backend/AuthService/Options/AuthCookieOptions.cs) + `SetRefreshCookie`/`ClearRefreshCookie` in `AuthController.cs` (lines 244-309) — `HttpOnly=true`, `Secure` outside dev, `Path="/api/auth"` (scopes the cookie so it's never sent to unrelated endpoints), `SameSite=None` requires `Secure` or the app throws.
- Cleanup: [`Backend/AuthService/Infrastructure/Security/RefreshTokenCleanupService.cs`](Backend/AuthService/Infrastructure/Security/RefreshTokenCleanupService.cs) — a `BackgroundService` purging expired rows.

**To build this yourself:** rotate-on-use + reuse detection is the standard defense against a stolen refresh token being used silently alongside the legitimate one — the moment either party uses an already-consumed token, you know something's wrong and can kill every session for that user.

### 1.6 Absolute session cap (distinct from token expiry)

[`Backend/AuthService/Options/JwtOptions.cs`](Backend/AuthService/Options/JwtOptions.cs): `AbsoluteSessionHours` (default 8). A fresh login sets `RefreshToken.AbsoluteExpiresAt = now + 8h`; every subsequent rotation **inherits** the original deadline rather than extending it (`RefreshTokenService.IssueAsync` lines 35-38). So no matter how often the token silently refreshes, the session hard-ends 8 hours after the original login. `RotateAsync` also double-checks this server-side (lines 94-97) as a belt-and-braces measure.

### 1.7 Password reset / invite flow (MailKit, single-use links)

- [`Backend/AuthService/Application/Services/SetPasswordInviteService.cs`](Backend/AuthService/Application/Services/SetPasswordInviteService.cs):
  - `IssueAsync` (45-79): revokes any earlier live invite, generates a 256-bit random token, persists only its hash, builds `"{AppBaseUrl}/set-password?token={token}"`, emails it. Never throws on mail failure.
  - `RedeemAsync` (104-123): validates password policy, sets `PasswordHash`, clears `MustChangePassword`.
- Mail transport: [`Backend/AuthService/Infrastructure/Email/EmailSender.cs`](Backend/AuthService/Infrastructure/Email/EmailSender.cs) — MailKit SMTP client; `IsEnabled` reflects whether SMTP is configured at all (feature degrades gracefully if unconfigured).
- Endpoints: `GET /api/auth/set-password/validate`, `POST /api/auth/set-password` in `AuthController.cs` — both anonymous and rate-limited (brute-forcing a 256-bit token must stay impractical even without auth).

### 1.8 Google SSO

Backend ([`Backend/AuthService/Application/Services/AuthAppService.cs`](Backend/AuthService/Application/Services/AuthAppService.cs) `GoogleLoginAsync`, lines 86-142) does **real cryptographic verification** via `GoogleJsonWebSignature.ValidateAsync` against Google's own public keys, enforces an email-domain allowlist, and requires an **already-provisioned** `User` row with `AuthProvider == Google` — SSO never auto-creates accounts. This was always solid.

The gap (now fixed, documented in code comments as history) was purely frontend: [`Frontend/apps/host/src/features/auth/hooks/useGoogleSignIn.ts`](Frontend/apps/host/src/features/auth/hooks/useGoogleSignIn.ts) previously rendered a button that only showed a static "contact your administrator" message and called nothing. It now probes `GET /api/auth/sso-config`, loads the Google Identity Services script, and wires `google.accounts.id.initialize/renderButton` through to `POST /api/auth/google`.

**Lesson for future features:** a backend can be 100% complete and still be invisible to users if nothing on the frontend calls it — always trace the full path from UI control to backend endpoint before declaring a feature "done."

### 1.9 Bootstrap admin — why the password is unrecoverable if missed

[`Backend/AuthService/Infrastructure/Seed/AuthDbSeeder.cs`](Backend/AuthService/Infrastructure/Seed/AuthDbSeeder.cs) `SeedSuperAdminUserAsync` (336-381), run on every startup but guarded by `if (await db.Users.AnyAsync(ct)) return;` — fires exactly once, against a genuinely empty database.

- Generates a cryptographically random 14-char temp password ([`Backend/AuthService/Infrastructure/Security/TemporaryPasswordGenerator.cs`](Backend/AuthService/Infrastructure/Security/TemporaryPasswordGenerator.cs)).
- Persists **only its hash**. The plaintext appears exactly once, in a single startup log line (`logger.LogWarning(...)`, lines 376-380), and nowhere else — not in the DB, not emailed (no user exists yet to receive it). Once any user row exists, the seed guard means it never runs again.

**To build this yourself:** this is a legitimate pattern for "day-zero" bootstrap secrets — generate randomly, log once loudly, store only the hash, never make the seeding path re-runnable. Just make sure your deployment process actually captures startup logs, or document a documented recovery path (e.g., a `--reset-admin` CLI flag) since this design has no other way in.

---

## 2. Backend Authorization / RBAC (AuthService is the source of truth)

### 2.1 Data model — the two-level module→submodule design

- [`Backend/AuthService/Domain/Entities/Role.cs`](Backend/AuthService/Domain/Entities/Role.cs) — `IsAdministrator` flag short-circuits to "unrestricted," roles are entirely admin-authored (not a hardcoded enum).
- [`Backend/AuthService/Domain/Entities/PermissionFeature.cs`](Backend/AuthService/Domain/Entities/PermissionFeature.cs) — the module/submodule node: `Key, DisplayName, Source (Host|RemoteApp), ParentFeatureId, Children[], Capabilities[]`. **Self-referencing tree** — a top-level feature (`remote.employee`) can have child features (`remote.employee.department`), each a first-class row. This keeps the `"featureKey:capability"` JWT claim shape flat and uniform regardless of nesting.
- [`Backend/AuthService/Domain/Entities/PermissionFeatureCapability.cs`](Backend/AuthService/Domain/Entities/PermissionFeatureCapability.cs) — **no global capability enum**; each feature declares its own capability vocabulary (e.g. `["View","Create","Edit","Delete"]` for CRUD modules, `["View","Approve"]` for approvals).
- [`Backend/AuthService/Domain/Entities/RolePermission.cs`](Backend/AuthService/Domain/Entities/RolePermission.cs) — Role↔Feature↔Capability join, unique on the triple.
- [`Backend/AuthService/Domain/Entities/UserPermissionOverride.cs`](Backend/AuthService/Domain/Entities/UserPermissionOverride.cs) — per-user Grant/Revoke exceptions layered on top of role grants.

Effective permissions = `(role grants ∪ user Grant overrides) − user Revoke overrides`, restricted to active features, computed once at login/refresh time by `PermissionClaimsBuilder` (§1.3) and serialized as `"{feature.Key}:{capability}"` strings into the `perms` JWT claim.

**To build this yourself:** modeling permissions as `(Feature, Capability)` pairs where both feature tree and capability vocabulary are data (DB rows), not code (enums), is what lets you add a whole new module — including new action verbs — without redeploying the identity service. The tradeoff is you lose compile-time safety on permission strings; this repo accepts that tradeoff deliberately.

### 2.2 Enforcement — hand-rolled `IAsyncAuthorizationFilter`, not ASP.NET policies

There is **no** custom `IAuthorizationPolicyProvider` or `AuthorizationHandler` anywhere in this codebase — `AddAuthorization()` is registered bare, with no policies. All real enforcement is a hand-rolled attribute per service:

- [`Backend/AuthService/Infrastructure/Security/RequirePermissionAttribute.cs`](Backend/AuthService/Infrastructure/Security/RequirePermissionAttribute.cs) (AuthService's own endpoints)
- [`Backend/EmployeeService/Infrastructure/Security/RequiresCapabilityAttribute.cs`](Backend/EmployeeService/Infrastructure/Security/RequiresCapabilityAttribute.cs)
- [`Backend/LeadService/Infrastructure/Security/RequiresCapabilityAttribute.cs`](Backend/LeadService/Infrastructure/Security/RequiresCapabilityAttribute.cs)
- [`Backend/Customer360Service/Infrastructure/Security/RequiresCapabilityAttribute.cs`](Backend/Customer360Service/Infrastructure/Security/RequiresCapabilityAttribute.cs)

Each implements `OnAuthorizationAsync` (from `IAsyncAuthorizationFilter`): checks the `administrator` claim for bypass, deserializes the `perms` claim (fail-closed to `[]` on any parse error), then does **exact string equality** against `RequiredPermission = $"{FeatureKey}.{Module.ToLowerInvariant()}:{Capability}"`. Zero DB/network calls — everything is already on the token.

#### The critical bug (and why it matters for any future attribute you write)

These attributes **must** be authorization filters (`IAsyncAuthorizationFilter`), not action filters (`IActionFilter`/`IAsyncActionFilter`). The XML doc `<remarks>` on each attribute documents a real, previously-shipped bug:

> It was previously an action filter, which runs *after* model binding. `[ApiController]` registers its automatic ModelState-invalid 400 response as an action filter at `Order = -2000` — earlier in the action-filter pipeline than a custom action filter would run. So an unauthorized POST with a malformed body returned **400 before the permission check ever ran** — effectively leaking "this endpoint exists and validates input" to an unauthorized caller, and returning the wrong status code (400 instead of 403) for what is actually an authorization failure.

**Fix:** implement `IAsyncAuthorizationFilter`. ASP.NET Core runs the authorization stage strictly before model binding, so a 403 always wins over a 400 for an unauthorized request, regardless of body validity.

**To build this yourself:** any time you write a custom "can this caller do X" check in ASP.NET Core, make it an authorization filter (or a real `AuthorizationHandler` via the policy system), never an action filter — the pipeline ordering bug above is easy to introduce and easy to miss in testing if your tests always send valid bodies.

#### The wildcard-matching bug (and its fix)

LeadService and Customer360Service's attributes previously matched permissions with `p.StartsWith($"{FeatureKey}.")` — since **every** permission a service can grant starts with its own `FeatureKey`, this collapsed the check into "does the caller hold *any* permission anywhere in this app," letting a read-only user hit destructive endpoints. Fixed to exact string equality:

```csharp
var hasMatch = permissions.Any(p =>
    string.Equals(p, RequiredPermission, StringComparison.OrdinalIgnoreCase));
```

A related fix in the same files: the admin bypass previously also accepted role-shaped claims (`user.IsInRole("Admin")` etc.) — a full bypass for anyone who could smuggle a role-shaped claim into a token. Fixed to check exactly one claim, `administrator == "true"`.

**To build this yourself:** never use prefix/`StartsWith` matching for permission strings unless you have a real, intentional wildcard syntax with its own tests — plain prefix matching on a hierarchical-looking string almost always ends up matching more than intended. Prefer exact equality against a fully-qualified permission string, and keep your admin-bypass check to a single, unambiguous claim.

### 2.3 Dynamic permission discovery — how remote apps "just show up" in the host

This is the mechanism from your memory about capabilities auto-propagating into the host's Role editor.

1. **Each remote backend self-declares** its permissions by reflecting over its own controllers at runtime — e.g. [`Backend/EmployeeService/Controllers/PermissionsController.cs`](Backend/EmployeeService/Controllers/PermissionsController.cs) `DiscoverModules()`: walks every `[RequiresCapability(...)]` attribute via `Assembly.GetTypes()`, groups by `Module`, and exposes an **anonymous** `GET /permissions` endpoint returning `{ modules: [{key, displayName, capabilities}] }`.
2. **ModuleRegistry aggregates.** [`Backend/ModuleRegistry/Infrastructure/AuthServiceClient.cs`](Backend/ModuleRegistry/Infrastructure/AuthServiceClient.cs) `FetchRemoteCapabilitiesAsync` GETs each registered remote app's `PermissionsSourceUrl`, then `UpsertAsync`/`ResyncAsync` push the result into AuthService via an internal, API-key-protected endpoint (`POST internal/permission-features/upsert`).
3. **AuthService persists it** as parent+child `PermissionFeature` rows (the module→submodule tree from §2.1).
4. **The host's Role editor reads only AuthService's catalog** (`GET /api/permissions/catalog`) — it never talks to ModuleRegistry or the remote directly. So a new action added to, say, EmployeeService shows up in the Role editor after the next sync/resync, with **zero code changes** in AuthService or the host frontend.

Triggered from [`Backend/ModuleRegistry/Application/Services/RemoteAppAppService.cs`](Backend/ModuleRegistry/Application/Services/RemoteAppAppService.cs) whenever an admin registers/edits/resyncs a remote app in Settings → Applications, or via `resyncPermissions()` ([`Frontend/apps/host/src/features/settings-applications/api/remoteAppsApi.ts`](Frontend/apps/host/src/features/settings-applications/api/remoteAppsApi.ts) line ~101).

**To build this yourself:** this "self-declare + central aggregator + single source-of-truth catalog" pattern is a clean way to let a plugin/module system grow without a central registry file that every module has to edit. The API-key-protected internal endpoint is important — this upsert path must never be reachable by a normal user token.

### 2.4 Role editor UI — assembling the two-level grid

- [`Frontend/apps/host/src/shared/permissions/catalog.ts`](Frontend/apps/host/src/shared/permissions/catalog.ts) is the pure function turning the flat/tree catalog into rows/columns:
  - `rowsForFeature()`: if a feature has children, render **only the children as rows**, skipping the parent (parents with sub-modules declare zero capabilities of their own — e.g. `remote.employee` → children `department`, `employee`).
  - `columnsForRows()`: union of capability keys across rows, sorted into a preferred CRUD order.
  - `groupsFromCatalog(catalog, 'Host'|'RemoteApp')`: splits host vs. remote-app groups for separate UI tabs.
- [`Frontend/apps/host/src/layout/SettingsDrawer/RoleFormLayer.tsx`](Frontend/apps/host/src/layout/SettingsDrawer/RoleFormLayer.tsx) — the actual 4-step editor (`basic | host | apps | users`); maintains a flat `{featureKey, capability}[]` grant list in local state; `isAdministrator` short-circuits everything to "always granted"; saves via `rolesApi.create`/`update`.

### 2.5 Maker-Checker (approval) system — four invariants

All approval state is centralized in AuthService, even for remote services' mutations.

- Entities: [`Backend/AuthService/Domain/Entities/ApprovalRequest.cs`](Backend/AuthService/Domain/Entities/ApprovalRequest.cs), [`CheckerAssignment.cs`](Backend/AuthService/Domain/Entities/CheckerAssignment.cs).
- **Invariant 1 — one open request per record**: a partial unique index on `(Module, EntityKey) WHERE Status = 'Pending'`, backed up in application code by [`ApprovalGatingService.EnsureNoOpenRequestAsync`](Backend/AuthService/Application/Services/ApprovalGatingService.cs) (lines 143-175), with a `DbUpdateException`/unique-violation catch-and-retry in `SubmitAsync` to handle the race between the check and the insert.
- **Invariant 2 — DB-identity-based admin checks**: [`RoleAppService.IsActorAdministratorAsync`](Backend/AuthService/Application/Services/RoleAppService.cs) (lines 20-41) deliberately re-queries the **maker's** identity from the database rather than trusting the ambient JWT `administrator` claim — during a replay, the HTTP context belongs to the checker approving the request, not the maker who submitted it, so the ambient claim would be the wrong user's.
- **Invariant 3 — claim-before-replay**: [`ApprovalAppService.ApproveAsync`](Backend/AuthService/Application/Services/ApprovalAppService.cs) (lines 68-151) flips `Status = Approved` and saves (using an `xmin` EF Core concurrency token as "the claim") **inside a transaction, before** calling `ReplayAsync` (the actual mutation). A concurrency exception on the claim means someone else already decided it. If the replay itself throws, the whole transaction — including the status flip — rolls back, so a request can never be left half-decided.
- **Invariant 4 — reassign-or-refuse**: [`ApprovalGatingService.ReassignPendingRequestsForDepartingCheckerAsync`](Backend/AuthService/Application/Services/ApprovalGatingService.cs) (lines 216-277) moves pending requests off a checker being deactivated onto another eligible checker (least-current-workload selection), or **refuses the deactivation outright** (`ConflictAppException`) if no eligible replacement exists.
- Concrete gated caller example: [`Backend/EmployeeService/Services/EmployeeService.cs`](Backend/EmployeeService/Services/EmployeeService.cs) `TrySubmitForApprovalAsync` — checks `IsGatedAsync`, submits with a `CallbackUrl` pointing at its own internal replay endpoint ([`Backend/EmployeeService/Controllers/InternalApprovalsController.cs`](Backend/EmployeeService/Controllers/InternalApprovalsController.cs), API-key protected, always passes `bypassApproval: true` on replay so the replayed write doesn't recursively trigger gating).

**To build this yourself:** these four invariants generalize to any approval/workflow engine: (1) prevent duplicate in-flight requests on the same entity with a DB constraint, not just application logic; (2) never trust ambient request identity for "who is the original actor" once you're processing someone else's decision; (3) treat "decided" and "applied" as one atomic transaction so a failed apply can't leave a ghost "approved" record; (4) never let removing a reviewer silently orphan their queue — reassign or block the removal.

### 2.6 Audit log — single sink for host and every remote

- [`Backend/AuthService/Domain/Entities/AuditLog.cs`](Backend/AuthService/Domain/Entities/AuditLog.cs) — one table, `ServiceName` column distinguishes origin. Doc comment: "AuthService is the single sink every service writes to... so 'show me every audit, host or remote' is one query against one table."
- Remote services push via their own internal client (e.g. `Backend/ModuleRegistry/Infrastructure/AuthServiceClient.cs` `PushAuditLogAsync`) to [`Backend/AuthService/Controllers/InternalAuditLogsController.cs`](Backend/AuthService/Controllers/InternalAuditLogsController.cs), API-key protected — same pattern as the approvals internal endpoints.

**To build this yourself:** centralizing audit logging in the identity/security service (rather than per-service tables) makes cross-cutting security review tractable — one query answers "what did this user do everywhere," instead of joining N services' logs.

---

## 3. Frontend: Host app auth state and API plumbing

### 3.1 Auth store (Zustand, not React Context)

[`Frontend/apps/host/src/features/auth/store/authStore.ts`](Frontend/apps/host/src/features/auth/store/authStore.ts) — the single source of truth for client-side session state.

- `accessToken` is **kept in memory only** — line 10's comment is explicit: "never written to localStorage/sessionStorage." The refresh token never reaches JS at all; it's an httpOnly cookie the browser manages automatically.
- `login`/`loginWithGoogle` (136-160), `logout` (162-171), `hydrate` (173-186 — silently calls `/api/auth/refresh` on page load using the cookie, to restore a session after a hard reload with no in-memory token yet), `ensureFreshAccessToken` (188-204 — refreshes only if <30s of life left), `refreshSession` (206-220 — force-refreshes regardless of expiry, used after permission-affecting saves), `hasCapability` (222-227).
- Cross-tab logout sync via `BroadcastChannel('omniremit-auth')`.
- Refresh is deduped within a tab and **serialized across tabs** via the Web Locks API (`navigator.locks.request('omniremit-token-refresh', ...)`) — necessary because the server rotates the refresh cookie on every use, so two tabs racing the same refresh call would trip the reuse-detection kill-switch from §1.5.

**To build this yourself:** in-memory-only access tokens + httpOnly-cookie refresh tokens is the standard mitigation against XSS-stolen tokens (an XSS payload can read `localStorage` but not an httpOnly cookie). The Web Locks cross-tab serialization is a subtle but important detail once you add rotate-on-use refresh tokens to a multi-tab SPA.

### 3.2 HTTP client — the single fetch wrapper

[`Frontend/apps/host/src/shared/api/httpClient.ts`](Frontend/apps/host/src/shared/api/httpClient.ts) `apiFetch()` (81-117):
- `credentials: 'include'` always (carries the httpOnly cookie).
- Attaches `Authorization: Bearer <token>` when given.
- On a 401: refreshes once (deduped) and retries with `_isRetry: true`; if the refresh itself fails, calls `authHooks.onSessionExpired(...)`.
- `registerAuthHooks()` (43-67) is a small indirection so `httpClient.ts` doesn't have to import `authStore.ts` directly (avoids a circular import) — the store registers its own `refresh`/`onSessionExpired` implementations at module load.

### 3.3 Proactive refresh and idle timeout

- [`Frontend/apps/host/src/features/auth/hooks/useSilentRefresh.ts`](Frontend/apps/host/src/features/auth/hooks/useSilentRefresh.ts) — schedules a refresh 60s before token expiry, mounted once near the app root.
- [`Frontend/apps/host/src/features/auth/hooks/useIdleTimeout.ts`](Frontend/apps/host/src/features/auth/hooks/useIdleTimeout.ts) + `IdleWarningModal.tsx` — warns then auto-signs-out after inactivity. Added deliberately because the proactive refresh alone would otherwise keep an idle tab's session alive forever.

### 3.4 Route/UI gating (three tiers)

- [`Frontend/apps/host/src/features/auth/components/RequireAuth.tsx`](Frontend/apps/host/src/features/auth/components/RequireAuth.tsx) — gates the entire authenticated tree, redirects to `/login` when unauthenticated.
- [`Frontend/apps/host/src/features/auth/components/RequirePasswordChange.tsx`](Frontend/apps/host/src/features/auth/components/RequirePasswordChange.tsx) — sits inside `RequireAuth`, above the app shell, so **no remote micro-frontend mounts at all** while `mustChangePassword` is true. Mirrors the server-side `MustChangePasswordFilter` (§1 — an `IAsyncAuthorizationFilter` registered globally in AuthService's `Program.cs`, 403s every endpoint except ones explicitly opted out via `[AllowWhenPasswordChangeRequired]`).
- [`Frontend/apps/host/src/features/auth/components/RequireCapability.tsx`](Frontend/apps/host/src/features/auth/components/RequireCapability.tsx) — route-level: `isAdministrator || hasCapability(featureKey, capability)`, else redirect to `/404`.
- [`Frontend/apps/host/src/shared/components/PermissionGate/PermissionGate.tsx`](Frontend/apps/host/src/shared/components/PermissionGate/PermissionGate.tsx) — same check, but for gating individual buttons/controls inline rather than whole routes.

**To build this yourself:** always enforce the important rule (e.g. "must change password") on the server too — the frontend gate is a UX nicety, not the security boundary. This repo does both, and the two are independently implemented (comment threads note this explicitly).

### 3.5 "Refresh-after-save" — why editing your own role takes effect immediately

`authStore.refreshSession()` bypasses the near-expiry skip and always calls `/api/auth/refresh`. Because `AuthAppService.RefreshAsync` (§1.3) always reloads the `User`/`Role` from the database and recomputes permissions fresh (never copies claims from the old token), this makes any permission change to the *currently logged-in* user visible immediately rather than waiting up to 15 minutes for natural token expiry. Called after: a forced password change succeeds, a role is saved (in case the acting admin edited their own role), a user is saved (in case the acting admin edited their own account).

---

## 4. Frontend: Module Federation — how the host and remotes share auth

### 4.1 Workspace layout

pnpm workspace (`Frontend/pnpm-workspace.yaml`, `packages: ["apps/*", "packages/*"]`):
- `Frontend/apps/host` — shell app (React 19 + Vite + `@module-federation/vite`)
- `Frontend/apps/employee_mf`, `Frontend/apps/lead_mf`, `Frontend/apps/customer360_mf` — remotes, each a self-contained app with its own backend
- `Frontend/packages/federation-config` — shared MF contract package (`@omniremit/federation-config`)

### 4.2 The shared MF contract

[`Frontend/packages/federation-config/index.js`](Frontend/packages/federation-config/index.js):
- Registers shareable singletons (`react`, `react-dom`, `react-router-dom`, `zustand`, `@tanstack/react-query`) so host and remotes don't each ship their own copy.
- Every remote exposes `./App` (`REMOTE_ENTRY_MODULE`); the host `loadRemote(`${key}/App`)`s it.
- The host declares **zero build-time remotes** — remotes are registered at *runtime* from ModuleRegistry, not baked into the host's Vite config. This is what lets you add a new remote app without rebuilding the host.

### 4.3 The host bridge — how the token crosses the MF boundary

Not a prop, not localStorage. A global object, installed once at host boot, **live-read** (not snapshotted) by every remote:

- [`Frontend/apps/host/src/shared/federation/hostBridge.ts`](Frontend/apps/host/src/shared/federation/hostBridge.ts) — `OmniRemitHostBridge` interface: `getAccessToken()`, `ensureFreshAccessToken()`, `hasCapability(featureKey, capability)`, `getUser()`, `apiBaseUrls`, `theme.token()`. `installHostBridge()` sets `window.__omniremitHost__`, reading straight from `useAuthStore.getState()` on each call.
- Installed in [`Frontend/apps/host/src/main.tsx`](Frontend/apps/host/src/main.tsx) (line 15) — **before** `createRoot(...).render(<App/>)`, guaranteeing the bridge exists before any remote can possibly mount.
- Each remote has its own thin accessor mirroring the contract, e.g. [`Frontend/apps/employee_mf/src/api/hostBridge.js`](Frontend/apps/employee_mf/src/api/hostBridge.js), [`Frontend/apps/customer360_mf/src/api/hostBridge.ts`](Frontend/apps/customer360_mf/src/api/hostBridge.ts).

**To build this yourself:** a `window`-global "bridge" object is a pragmatic way to share live, frequently-changing state (a token that rotates every 15 minutes) across Module Federation boundaries without wiring every remote into the host's state management library. The key discipline is: the bridge exposes **functions** (`getAccessToken()`), not a snapshotted value — so remotes always read the current token, never a stale copy captured at mount time.

### 4.4 Each remote calls its own backend directly

Every remote has its own API base URL and its own axios/fetch client that pulls the token from the bridge on each call:
- [`Frontend/apps/employee_mf/src/api/employeeApi.js`](Frontend/apps/employee_mf/src/api/employeeApi.js) — axios instance, request interceptor calls the bridge's `ensureFreshAccessToken()` and sets `Authorization`.
- [`Frontend/apps/lead_mf/src/api/apiClient.ts`](Frontend/apps/lead_mf/src/api/apiClient.ts) — same pattern, `getAuthHeaders()`.
- Customer360 equivalent under `Frontend/apps/customer360_mf/src/api/`.

Backend-side, each service's `AddJwtBearer` (§1.4) validates the token itself with the shared public key — no call back to AuthService per request. This is the same "one issuer, many independent validators" design as §0, now visible from the frontend's perspective: **the frontend also treats each remote as talking to a fully independent backend**, just all trusting the same token.

### 4.5 Sidebar sub-navigation — the "portal trap" pattern

For remotes needing an expandable second-level menu (Customer360, Lead), the host's own sidebar data model does **not** carry that structure. Instead:
1. The remote's own component polls the DOM for its `<a>` in the host's sidebar (by href/text match).
2. It `appendChild`s a chevron toggle directly onto that anchor.
3. It inserts a portal container `afterend` the anchor and `ReactDOM.createPortal`s its own sub-nav items into it, gated by its own `hasCapability()` bridge calls.

Example: [`Frontend/apps/customer360_mf/src/components/layout/HostSidebarCustomer360Nav.tsx`](Frontend/apps/customer360_mf/src/components/layout/HostSidebarCustomer360Nav.tsx). Host-side counterpart in [`Frontend/apps/host/src/layout/Sidebar/Sidebar.tsx`](Frontend/apps/host/src/layout/Sidebar/Sidebar.tsx) forwards clicks to whichever chevron a remote has injected, since the host has no direct handle on a remote's expand/collapse state.

This is a workaround, not something to imitate proudly — it exists because the host's sidebar model is flat and modifying it per-remote wasn't in scope. **If you build this from scratch, prefer giving the host sidebar a real nested-items data contract from the start** so remotes can declare sub-nav items data-first instead of DOM-poking.

### 4.6 Permission catalog resync vs. own-session refresh — two different "refresh" concepts

Don't conflate these:
- **Catalog resync** (§2.3) — an admin action, `POST /api/remote-apps/resync-permissions` against ModuleRegistry, re-pulls each remote's `/permissions` endpoint into AuthService's durable catalog. This changes what permissions *exist*.
- **Session refresh** (§3.5) — `authStore.refreshSession()`, re-issues the *current user's own* JWT with recomputed claims. This changes what permissions the *logged-in browser tab* currently has.

A role can be edited (assigning a newly-discovered permission to it) without anyone needing a catalog resync, and a catalog resync doesn't itself change any user's live session — they're independent axes.

### 4.7 CSS isolation between remotes

Each remote's `postcss.config.cjs` (e.g. [`Frontend/apps/employee_mf/postcss.config.cjs`](Frontend/apps/employee_mf/postcss.config.cjs)) prefixes every selector with a unique `#<scope-id>` and renames every `@keyframes` to `<scope>-<name>` (keyframe names live in a separate global CSS namespace that selector-prefixing alone can't reach). Not part of the auth flow directly, but part of the same "many independently-built apps sharing one page" discipline — relevant if you extend the RBAC UI into a new remote.

### 4.8 Remote app health and the sidebar

ModuleRegistry runs a background health sweep; the host polls it adaptively (10s while any app is unhealthy, 60s otherwise — [`Frontend/apps/host/src/App.tsx`](Frontend/apps/host/src/App.tsx)) and shows an "Unreachable" badge in the sidebar without blocking navigation — if a remote is actually down, Module Federation's own loader failure is caught by a `FederationErrorBoundary` with a retry button. This is a UX nicety layered on top of the auth flow, not a security gate.

---

## 5. Build-it-yourself checklist (condensed recipe)

If you were building this system from scratch, in order:

1. **Pick one identity service.** It owns `User`, `Role`, password hashing, and JWT issuance. Nothing else issues tokens.
2. **Use asymmetric signing (RS256).** Identity service keeps the private key; every resource server gets only the public key, via config/secret, and validates independently (`AddJwtBearer` with `MapInboundClaims = false`).
3. **Model permissions as data, not code**: a `Feature` tree (self-referencing for module→submodule) × a per-feature `Capability` list × a `Role↔Feature↔Capability` join, plus optional per-user Grant/Revoke overrides.
4. **Compute effective permissions once, server-side, at login/refresh**, and embed them as a flat claim in the JWT. Every downstream authorization check becomes an in-memory string comparison — no DB hit per request.
5. **Enforce with an `IAsyncAuthorizationFilter`** (or a real ASP.NET Core `AuthorizationHandler`), never an `IActionFilter` — authorization must run before model binding.
6. **Match permission strings by exact equality.** Resist the temptation to prefix/wildcard-match — it silently over-grants.
7. **Refresh tokens: rotate-on-use, hash-only storage, httpOnly cookie, reuse detection that kills all sessions.** Add an absolute session cap independent of the sliding refresh window.
8. **Let modules self-declare their permissions** (a discovery endpoint reflecting over authorization attributes) and have one aggregator push them into the identity service's catalog — new modules require zero changes to the identity service or the admin UI.
9. **Maker-checker, if you need it:** DB-level uniqueness for "one open request per record," re-verify actor identity from the database rather than ambient claims during replay, make "decide" and "apply" one transaction, and never let a reviewer's removal silently strand their queue.
10. **Frontend: keep the access token in memory only**, never localStorage; let the refresh token live purely as an httpOnly cookie. Gate both routes and individual controls off a `hasCapability()` check backed by the JWT's permission claim, and enforce the same rule server-side independently — the frontend gate is UX only.
11. **Micro-frontend/module-federation specific:** if remotes need the live token, expose it via a small `window`-global bridge of functions (not a copied value) installed before any remote mounts, and let each remote's own backend validate the same JWT independently rather than proxying through a central gateway.

