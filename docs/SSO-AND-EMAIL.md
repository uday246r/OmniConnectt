# Google SSO and email: how they work and how to set them up

This guide covers two AuthService features that stay off until you configure them:

- **Google single sign-on (SSO).** Users click "Continue with Google" instead of typing a password.
- **Email.** A new user gets a single-use link to set their own password, and an admin can resend it.

Both are configured only in `Backend/AuthService/.env`. Neither needs a frontend rebuild. Only
AuthService sends mail or checks Google sign-ins; Lead, Customer 360 and Products never do.

**Status on 2026-09-17**

| Feature | Code | Configured locally | Notes |
|---|---|---|---|
| Google SSO | Complete (backend + login page) | **No**: `Google__ClientId` / `Google__AllowedDomains` are not in `.env`, so `GET /api/auth/sso-config` returns `googleEnabled: false` | The Create User form has **no** Local/Google choice; see [2.6](#26-known-gap-no-google-option-in-the-create-user-form) |
| Email invites | Complete | **Yes**: SMTP host `mail.rma.my`, port 465; login tested OK | |

---

## 1. Background: how sign-in works

AuthService is the only service that signs people in. Every sign-in (password or Google) ends in the
same place, `AuthAppService.IssueSessionAsync`. It returns an RS256 access token (JWT) and sets a
refresh-token cookie. The other services only check that JWT with the public key.

A user row stores **how** that person signs in, in `User.AuthProvider`:

| `AuthProvider` | `PasswordHash` | Signs in with | Gets a set-password email? |
|---|---|---|---|
| `Local` (0) | Set by the invite link | Email + password | Yes |
| `Google` (1) | Always `null` | Google button only | No |

- The provider is chosen when the user is created and **cannot be changed later**
  ([UserDtos.cs:59](../Backend/AuthService/Application/DTOs/UserDtos.cs)).
- A Google user can never sign in with a password. The null-hash check in
  [AuthAppService.cs:54](../Backend/AuthService/Application/Services/AuthAppService.cs) blocks it.
- A Local user can never use the Google button. The Google lookup only matches `AuthProvider == Google`.

Enum: [AuthProvider.cs](../Backend/AuthService/Domain/Enums/AuthProvider.cs).
Entity: [User.cs](../Backend/AuthService/Domain/Entities/User.cs).

---

## 2. Google SSO

### 2.1 How it is built

This uses **Google Identity Services (GIS)** with ID tokens. It is not the OAuth redirect flow:
there is no redirect URI and no client secret. The browser gets a signed ID token from Google, and
AuthService checks that token against Google's public keys.

```
Login page                         AuthService                          Google
──────────                         ───────────                          ──────
1. GET /api/auth/sso-config  ───►  returns {googleEnabled, allowedDomains, clientId}
   (disabled → no button, no script, no "OR" divider)
2. load https://accounts.google.com/gsi/client
3. google.accounts.id.initialize({client_id}) + renderButton
4. user clicks, picks account  ◄──────────────────────────────────────  signed ID token (JWT)
5. POST /api/auth/google {idToken} ─►
                                   6. GoogleJsonWebSignature.ValidateAsync(idToken,
                                        Audience = Google__ClientId)  ── verifies signature/expiry/aud
                                   7. email domain ∈ Google__AllowedDomains ?
                                   8. user exists with this email AND AuthProvider = Google ?
                                   9. user.Status == Active ?
                                  10. IssueSessionAsync → access token + refresh cookie
                                  11. audit auth.login_succeeded (authMethod "Google")
◄──────────────────────────────── LoginResponse (same shape as password login)
```

**SSO never creates accounts.** An admin must create the user first, with `AuthProvider = Google`.
Google only proves who the person is; OmniConnect still decides whether they can get in and what
their role allows.

### 2.2 Code reference

**Backend** (`Backend/AuthService`)

| File | What it does |
|---|---|
| [Options/GoogleAuthOptions.cs](../Backend/AuthService/Options/GoogleAuthOptions.cs) | Reads the `Google` config section: `ClientId`, `AllowedDomains` (comma-separated). `IsConfigured` is true only when both are set |
| [Program.cs:52](../Backend/AuthService/Program.cs) | `Configure<GoogleAuthOptions>(…GetSection("Google"))` |
| [Controllers/AuthController.cs:46](../Backend/AuthService/Controllers/AuthController.cs) | `POST /api/auth/google`: anonymous, rate-limited; turns each failure into an HTTP status (see 2.5) |
| [Controllers/AuthController.cs:80](../Backend/AuthService/Controllers/AuthController.cs) | `GET /api/auth/sso-config`: public; the page uses it to decide whether to show the button |
| [Application/Services/AuthAppService.cs:88](../Backend/AuthService/Application/Services/AuthAppService.cs) | `GoogleLoginAsync`: token check, domain allowlist, account lookup, status check, session, audit |
| [Application/Services/AuthAppService.cs:148](../Backend/AuthService/Application/Services/AuthAppService.cs) | `GetSsoConfig`: returns the Client ID only when fully configured |
| [Application/Services/AuthAppService.cs:16-18](../Backend/AuthService/Application/Services/AuthAppService.cs) | `SsoNotConfiguredException`, `SsoDomainNotAllowedException`, `SsoAccountNotFoundException` |
| [Application/DTOs/AuthDtos.cs](../Backend/AuthService/Application/DTOs/AuthDtos.cs) | `GoogleLoginRequest(IdToken)`, `SsoConfigDto(GoogleEnabled, AllowedDomains, ClientId)` |
| [Application/Services/UserAppService.cs:214-320](../Backend/AuthService/Application/Services/UserAppService.cs) | `CreateAsync`: reads `AuthProvider`; Google users get no password and no invite |
| [AuthService.csproj](../Backend/AuthService/AuthService.csproj) | NuGet package `Google.Apis.Auth` (token checking) |

**Frontend** (`Frontend/apps/host/src`)

| File | What it does |
|---|---|
| [features/auth/hooks/useGoogleSignIn.ts](../Frontend/apps/host/src/features/auth/hooks/useGoogleSignIn.ts) | Calls `sso-config`, loads the GIS script once, runs `initialize` + `renderButton`, and passes the credential back |
| [features/auth/components/GoogleSignInButton.tsx](../Frontend/apps/host/src/features/auth/components/GoogleSignInButton.tsx) | The whole SSO block (divider, button, "Available for … accounts", error); renders nothing when disabled |
| [pages/LoginPage/LoginPage.tsx:162](../Frontend/apps/host/src/pages/LoginPage/LoginPage.tsx) | Places `<GoogleSignInButton>` under the password form |
| [App.tsx:125](../Frontend/apps/host/src/App.tsx) | Passes `authStore.loginWithGoogle` to the login page |
| [features/auth/store/authStore.ts:163](../Frontend/apps/host/src/features/auth/store/authStore.ts) | `loginWithGoogle(idToken)`: same session setup as password login |
| [shared/api/authServiceClient.ts:51-54](../Frontend/apps/host/src/shared/api/authServiceClient.ts) | `loginWithGoogle` → `POST /api/auth/google`, `ssoConfig` → `GET /api/auth/sso-config` |
| [features/profile/pages/ProfilePage.tsx:85](../Frontend/apps/host/src/features/profile/pages/ProfilePage.tsx) | Hides Change Password for Google users |

`VITE_GOOGLE_CLIENT_ID` in `Frontend/apps/host/.env` and `config/env.ts` is **no longer used**. The
Client ID comes from AuthService when the page loads.

### 2.3 Step-by-step: turn Google SSO on

**A. Create the Google OAuth client**

1. Open <https://console.cloud.google.com/> and select or create a project.
2. **APIs & Services → OAuth consent screen**: set up the consent screen.
   - **Internal** (Google Workspace only): limits sign-in to your organisation.
   - **External**: needs test users added until the app is published.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: add every frontend origin exactly, with no path and no trailing
     slash, e.g. `http://localhost:5173` and later `https://app.yourcompany.com`.
   - **Authorized redirect URIs**: leave empty (GIS doesn't use a redirect).
4. Copy the **Client ID** (`xxxxxxxx.apps.googleusercontent.com`). You don't need the client secret.

**B. Configure AuthService**

Add to `Backend/AuthService/.env`:

```env
Google__ClientId=xxxxxxxx.apps.googleusercontent.com
Google__AllowedDomains=yourcompany.com,yourcompany.co.in
```

- Set **both**. If either is empty, SSO stays off, and an empty domain list means nobody can sign in.
- The domain check is an exact match on the part after `@`, ignoring case. A plain `@gmail.com`
  account works only if you list `gmail.com`, which isn't recommended for production.
- On a server, set the same keys as environment variables (`Google__ClientId`, …) or in
  `appsettings.{Environment}.json` under `"Google": { "ClientId": "", "AllowedDomains": "" }`.

**C. Restart and check**

1. Restart AuthService (`node scripts/dev-backends.mjs auth`, or the `backends-all` launch entry).
2. `GET http://localhost:5155/api/auth/sso-config` should return `googleEnabled: true`, your domains
   and the Client ID.
3. Reload the login page. "Continue with Google" appears, with "Available for yourcompany.com accounts".

**D. Create the Google user**

The user must exist with `AuthProvider = "Google"` (see 2.6 for why the form can't do this yet):

```http
POST http://localhost:5155/api/users
Authorization: Bearer <admin access token>
Content-Type: application/json

{
  "name": "Jane Doe",
  "email": "jane@yourcompany.com",
  "roleId": "<role id>",
  "isActive": true,
  "authProvider": "Google"
}
```

- If maker-checker is on for **Users**, this creates a pending approval, not the user. It takes effect
  when a checker approves it (the approval keeps `AuthProvider`).
- No email is sent; Google users have no password to set.

**E. Test**: sign in with that Google account. Every attempt is recorded in **System → Audit Logs** as
`auth.login_succeeded` or `auth.login_failed` with auth method `Google` and the failure reason.

### 2.4 Rotating or disabling

- **Rotate the Client ID:** create a new client, update `Google__ClientId`, restart AuthService.
  No frontend rebuild.
- **Disable:** clear either value and restart. The button disappears. Google users then can't sign
  in at all, since they have no password.

### 2.5 Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| No Google button | `sso-config` returns `googleEnabled:false` (a value is missing, or AuthService wasn't restarted) | Set both values and restart |
| Button area shows "Google sign-in failed to load." | Browser can't load `accounts.google.com/gsi/client` (ad-blocker, network, CSP) | Allow the script or domain |
| Google popup: `origin_mismatch` / "not a valid origin" | Page origin isn't in **Authorized JavaScript origins** | Add the exact origin (scheme + host + port); may take a few minutes |
| 503 "Google Sign-In is not configured…" | `IsConfigured` is false on the server | Same as the first row |
| 401 "Invalid or expired Google sign-in" | Token failed checks: wrong `aud` (Client ID mismatch between Google project and `.env`), expired, or server clock skew | Check the Client ID; sync the server clock |
| 401 "The domain 'x' is not allowed…" | Email domain not in `Google__AllowedDomains` | Add the domain |
| 401 "No active account is provisioned…" | No user with that email **and** `AuthProvider = Google` (a Local user with the same email doesn't count) | Create the user as Google (2.3 D) |
| 403 inactive | User exists but isn't Active | Reactivate the user |

### 2.6 Known gap: no Google option in the Create User form

The backend supports `authProvider: "Google"` on `POST /api/users`, and the frontend type has it
(`CreateUserRequest.authProvider` in
[usersApi.ts:58](../Frontend/apps/host/src/features/settings-users/api/usersApi.ts)). But
[UserFormLayer.tsx](../Frontend/apps/host/src/layout/SettingsDrawer/UserFormLayer.tsx) has no
Authentication Method field and never sends it, so every user created from the UI is `Local`.
Until that field is added, create Google users through the API (2.3 D). Adding it means a
Local/Google select in the create form (not edit, since the provider can't change) that sets
`authProvider` in the request, and hiding the "invite emailed" message for Google users.

---

## 3. Email (set-password invites)

### 3.1 What we use

- **Library:** [MailKit](https://github.com/jstedfast/MailKit) 4.x (`MailKit` NuGet in
  `AuthService.csproj`), sending over **SMTP**. There's no third-party email API such as SendGrid or SES.
- **Transport security:** always encrypted. Port **465** uses TLS from the start (`SslOnConnect`). Any
  other port **must** upgrade with STARTTLS (`StartTls`) or sending fails. It never falls back to
  plain text.
- **Authentication:** username/password (PLAIN/LOGIN), skipped when `Smtp__Username` is empty (for an
  internal relay that trusts the server).
- **Current local setup:** `mail.rma.my:465`, TLS, login verified on 2026-09-17.

### 3.2 When email is sent

Only one kind of email exists today: the **set-password invite**.

| Trigger | Where | Subject |
|---|---|---|
| Admin creates a **Local** user (or a checker approves a gated create) | `UserAppService.CreateAsync` → `SetPasswordInviteService.IssueAsync` | "You've been invited to OmniConnect — Set your password to get started" |
| Admin clicks **Resend invite** on the Users page | `POST /api/users/{id}/resend-invite` → `ResendAsync` | "Your new OmniConnect set-password link" |

No other emails exist: no approval notifications, security alerts or password-reset emails.
**There is no forgot-password or admin password-reset feature yet.** Once a user has set a password,
the only way to change it is **Profile → Change Password** while signed in.

### 3.3 Flow

```
Admin: Settings → Users → Create (Local user)
  │
  ▼
UserAppService.CreateAsync
  ├─ validate, maker-checker gate (pending approval → email is sent on approve)
  ├─ create User (a random unusable password; the user never sees it)
  └─ SetPasswordInviteService.IssueAsync(user)
        ├─ IEmailSender.IsEnabled?  no → return false (user still created; UI says "not emailed")
        ├─ revoke any earlier unused invites for this user
        ├─ raw token = 32 random bytes (base64url); DB stores only SHA-256(token)
        ├─ ExpiresAt = now + Smtp__InviteValidHours
        ├─ link = Smtp__AppBaseUrl + "/set-password?token=" + token
        ├─ BuildInviteEmail → subject + inline-styled HTML + plain-text body
        ├─ SmtpEmailSender.SendAsync → MailKit connect / auth / send / disconnect
        │     failure is logged and returns false; it never throws, never undoes the user
        └─ audit auth.invite_issued (Success or Failure)
  │
  ▼
Response CreateUserResponse { user, inviteEmailed } → form shows "invite emailed" or "not emailed"

User opens the link  →  /set-password?token=…  (SetPasswordPage)
  ├─ GET  /api/auth/set-password/validate?token=…  → { valid, email }  (checked before showing the form)
  └─ POST /api/auth/set-password { token, newPassword }
        └─ RedeemAsync: valid & unexpired & unused? → password policy → set hash,
           UsedAt = now, MustChangePassword = false → audit auth.invite_redeemed
User signs in with email + new password.
```

Security properties:

- The raw link token exists **only in the email**; the database stores only its SHA-256 hash.
- A link works **once**, **expires** after `Smtp__InviteValidHours`, and a new invite **revokes** the
  old one.
- Resend is refused when:
  - the user is a Google user;
  - the user is inactive;
  - the user already set a password (a new link would let whoever sends it take over the account);
  - email isn't configured;
  - the last invite went out less than **1 minute** ago (so a double-click can't cancel the mail
    already on its way).
- The invite endpoints are anonymous but rate-limited, and they give the same message for "no such
  token", "expired" and "used".
- The link is built from `Smtp__AppBaseUrl`, never from the request's `Host` header, which an
  attacker could change.

### 3.4 Code reference

**Backend** (`Backend/AuthService`)

| File | What it does |
|---|---|
| [Options/SmtpOptions.cs](../Backend/AuthService/Options/SmtpOptions.cs) | Reads the `Smtp` section; `ResolvedFromAddress` falls back to Username; `IsConfigured` = Host + sender + AppBaseUrl |
| [Infrastructure/Email/IEmailSender.cs](../Backend/AuthService/Infrastructure/Email/IEmailSender.cs) | The interface to swap providers: `IsEnabled`, `SendAsync(to, name, subject, html, text)`; must never throw |
| [Infrastructure/Email/EmailSender.cs](../Backend/AuthService/Infrastructure/Email/EmailSender.cs) | `SmtpEmailSender`: MailKit send, TLS choice, optional auth, logging |
| [Program.cs:53](../Backend/AuthService/Program.cs) | `Configure<SmtpOptions>(…GetSection("Smtp"))` |
| [Program.cs:100-101](../Backend/AuthService/Program.cs) | `AddScoped<IEmailSender, SmtpEmailSender>()`, `AddScoped<SetPasswordInviteService>()` |
| [Program.cs:455](../Backend/AuthService/Program.cs) | Startup warning `Smtp__* is not configured…` when email is off |
| [Application/Services/SetPasswordInviteService.cs](../Backend/AuthService/Application/Services/SetPasswordInviteService.cs) | `IssueAsync`, `ResendAsync`, `FindRedeemableAsync`, `RedeemAsync`, `BuildInviteEmail` (**edit the email wording/HTML here**), token generation and hashing |
| [Domain/Entities/SetPasswordInvite.cs](../Backend/AuthService/Domain/Entities/SetPasswordInvite.cs) | Table `SetPasswordInvites`: `TokenHash`, `ExpiresAt`, `UsedAt`, `RevokedAt`, `CreatedBy` |
| [Application/Services/UserAppService.cs:306-322](../Backend/AuthService/Application/Services/UserAppService.cs) | Sends the invite after creating a Local user; returns `InviteEmailed` |
| [Controllers/UsersController.cs:87](../Backend/AuthService/Controllers/UsersController.cs) | `POST /api/users/{id}/resend-invite` |
| [Controllers/AuthController.cs:97](../Backend/AuthService/Controllers/AuthController.cs) | `GET /api/auth/set-password/validate` |
| [Controllers/AuthController.cs:111](../Backend/AuthService/Controllers/AuthController.cs) | `POST /api/auth/set-password` |
| `appsettings.json` → `PasswordPolicy` | Rules a new password must meet |

**Frontend** (`Frontend/apps/host/src`)

| File | What it does |
|---|---|
| [pages/SetPasswordPage/SetPasswordPage.tsx](../Frontend/apps/host/src/pages/SetPasswordPage/SetPasswordPage.tsx) | The page the link opens: checks the token, then the password + confirm form |
| [App.tsx:355](../Frontend/apps/host/src/App.tsx) | Route `/set-password` (public) |
| [shared/api/authServiceClient.ts:65-70](../Frontend/apps/host/src/shared/api/authServiceClient.ts) | `validateInvite`, `setPassword` |
| [layout/SettingsDrawer/UserFormLayer.tsx:762](../Frontend/apps/host/src/layout/SettingsDrawer/UserFormLayer.tsx) | After create: "invite emailed" or "not emailed, resend later" message |
| [features/settings-users/pages/UsersPage.tsx:91](../Frontend/apps/host/src/features/settings-users/pages/UsersPage.tsx) | **Resend invite** button (only for Local users who haven't set a password) |
| [features/settings-users/api/usersApi.ts:200](../Frontend/apps/host/src/features/settings-users/api/usersApi.ts) | `resendInvite` |

### 3.5 Step-by-step: turn email on (or change provider settings)

1. Get SMTP details from your mail provider:

   | Provider | Host | Port | Username / Password |
   |---|---|---|---|
   | Google Workspace / Gmail | `smtp.gmail.com` | 587 | Full address / **App Password** (needs 2-Step Verification; the normal password is rejected) |
   | Microsoft 365 | `smtp.office365.com` | 587 | Full address / password (tenant must allow SMTP AUTH for that mailbox) |
   | cPanel / hosting mail (current) | e.g. `mail.yourdomain.com` | 465 (or 587) | Full mailbox address / mailbox password |
   | Internal relay | relay host | 587 | Leave both empty |

2. Set in `Backend/AuthService/.env`:

   ```env
   Smtp__Host=mail.yourdomain.com
   Smtp__Port=465
   Smtp__Username=noreply@yourdomain.com
   Smtp__Password=<mailbox password or app password>
   Smtp__FromAddress=noreply@yourdomain.com
   Smtp__FromName=OmniConnect
   Smtp__AppBaseUrl=http://localhost:5173
   Smtp__InviteValidHours=48
   ```

   - `Smtp__AppBaseUrl` is **required**: the public URL of the host frontend, no trailing path. In
     production use the real HTTPS URL, or links will point to localhost.
   - `Smtp__FromAddress` should normally be the same mailbox as `Smtp__Username`. Many servers reject
     or spam-flag a different sender.
   - Values are read by DotNetEnv. Don't wrap them in quotes, and avoid `$` in unquoted values (it is
     read as a variable reference).
   - Never commit `.env`. Only `.env.example` is tracked.

3. Restart AuthService. The startup warning `Smtp__* is not configured` should **not** appear.

4. Test it: create a Local user with an email address you control (or click **Resend invite** on an
   existing one). Then check:
   - the UI says the invite was emailed;
   - the AuthService log shows `Email 'You've been invited…' sent to …`;
   - **System → Audit Logs** shows `auth.invite_issued` with result Success;
   - the email arrives, the link opens `/set-password`, and signing in with the new password works.

5. Deliverability for production:
   - Set up **SPF**, **DKIM** and **DMARC** DNS records for the sending domain; otherwise invites
     go to spam.
   - Use a dedicated sender such as `noreply@`.

### 3.6 Troubleshooting

Delivery failures never fail the request. Look in the AuthService log for `Failed to send email` (it
includes the MailKit exception) and in Audit Logs for `auth.invite_issued` / `auth.invite_resent` with
result **Failure**.

| Log / symptom | Cause | Fix |
|---|---|---|
| Startup: `Smtp__* is not configured` | Host, sender or `AppBaseUrl` empty | Fill them and restart |
| `AuthenticationException: 535` | Wrong username/password; Gmail without App Password; M365 SMTP AUTH disabled | Fix credentials / enable SMTP AUTH |
| `SslHandshakeException` | Port and TLS mode don't match (465 ↔ implicit TLS, 587 ↔ STARTTLS) or bad certificate | Use 465 or 587 correctly |
| `NotSupportedException: STARTTLS` | Server on that port doesn't offer STARTTLS; code refuses plain text | Use port 465, or a port that supports STARTTLS |
| `SocketException` / timeout | Firewall or ISP blocks outbound 465/587; wrong host | Check with `Test-NetConnection host -Port 465` |
| `5.7.x sender not allowed` | `FromAddress` differs from the logged-in mailbox | Make them the same |
| Link opens localhost in production | `Smtp__AppBaseUrl` still local | Set the public URL |
| "This link is invalid, has already been used, or has expired." | Link used, superseded by a resend, or older than `InviteValidHours` | Admin clicks **Resend invite** |
| Resend: "already set their password" | Invite already redeemed | The user signs in normally; there is no email-based reset for a forgotten password yet |

### 3.7 Adding a new kind of email

1. Inject `IEmailSender` into the service that needs to send.
2. Check `IsEnabled`, build the subject plus HTML (inline styles only) and plain-text bodies, then call
   `SendAsync`. Treat `false` as "not delivered", never as an error that undoes the operation.
3. Write an audit row for anything security-relevant, as `SetPasswordInviteService` does.
4. To move from SMTP to an API provider (SendGrid, SES, …): write a class that implements
   `IEmailSender` and change the one registration at [Program.cs:100](../Backend/AuthService/Program.cs).
   Nothing that calls it needs to change.
