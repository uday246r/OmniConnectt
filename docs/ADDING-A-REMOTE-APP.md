# Adding a New Remote App

How to stand up a new micro-frontend on OmniRemit without colliding with the host or any existing
remote. Most of the steps exist because of a collision that has actually happened here.

> ⚠️ **This document names files that no longer exist.** It was written against an
> `employee_mf` / `EmployeeService` pair that has since been removed, and against a separate
> `ModuleRegistry` service whose job now lives inside AuthService. Copy
> **`Frontend/apps/customer360_mf`** (or `lead_mf`) instead — both are current, both are `.tsx`, and
> both already follow the contract below. Wherever the text says ModuleRegistry fetches a remote's
> `GET /permissions`, that is AuthService doing it now; nothing about the contract a remote must meet
> has changed. The condensed, current version of that contract is in
> [README.md](../README.md#contract-for-future-remote-apps).

The host never needs rebuilding or redeploying to gain a new app. Everything below ends at an
administrator pasting two URLs into **Setup → Applications**.

---

## The five things that must be unique per app

| Thing | Where it lives | What happens if it collides |
|---|---|---|
| Registry **key** (`employee`) | Setup → Applications | Rejected at registration — unique index on `RemoteApp.Key`. |
| MF **container name** (`employee_mf`) | `vite.config.js` → `remoteFederationConfig(name, …)` | Two apps overwrite each other's container on `window`; the wrong app renders. **Now rejected at registration** — the registry reads the built manifest and checks it. |
| **Port** | the app's own `.env` → `VITE_PREVIEW_PORT` | Startup crash (`strictPort`), or worse, a manifest served on a port the registry doesn't know about. |
| **CSS scope id** (`#employee-mf-scope`) | `postcss.config.cjs` → `SCOPE_ID`, and the root element in `App.jsx` | Styles leak between apps. |
| Backend **path base** (`/api/employee-service`) | that service's `Program.cs` → `UsePathBase` | Route ambiguity between services. |

---

## 1. Scaffold the frontend

Copy `Frontend/apps/employee_mf` to `Frontend/apps/<your_app>_mf`. Then, in order:

**`package.json`** — set a unique `name`. Keep `@omniremit/federation-config` as a
`workspace:*` dependency. Keep the `dev` script as-is (`vite build --watch` + `vite preview`
together); do **not** add `--port` flags back, the port comes from `.env` now.

> There is no Vite dev server with HMR here, by design. The host consumes `dist/mf-manifest.json`,
> which only a build produces. `pnpm dev` runs a watching build alongside the preview server so
> edits still land automatically.

**`vite.config.js`** — one call does the whole federation block:

```js
federation(remoteFederationConfig("<your_app>_mf", "./src/App.jsx"))
```

If your app imports `react-router-dom`, `zustand`, or `@tanstack/react-query`, you **must** declare
them:

```js
federation(remoteFederationConfig("<your_app>_mf", "./src/App.jsx", ["react-router-dom"]))
```

Sharing requires *both* sides to declare a package. The host already declares all of them. A remote
that imports `react-router-dom` without listing it here silently gets its **own second copy of the
router**, with its own empty context — and every `useNavigate()` / `<Link>` inside your app throws
`useNavigate() may be used only in the context of a <Router>` even though the host obviously has a
router mounted. This is the single most confusing failure mode in the whole system.

Only list packages you actually installed: the federation plugin emits a prebuild module per shared
entry, so naming an uninstalled one fails the build outright.

**`postcss.config.cjs`** — change `SCOPE_ID` to `<your-app>-mf-scope`. Leave both plugins in place.
`postcss-prefix-selector` scopes selectors; the local `scopeKeyframes` plugin scopes `@keyframes`
*names*, which selector prefixing cannot reach. Without the second one, two remotes each defining
`@keyframes fadeIn` overwrite each other globally and animations break in whichever app's stylesheet
was injected first.

**`src/App.jsx`** — the root element carries the scope id and nothing else:

```jsx
<div id="<your-app>-mf-scope">
```

Do not also put a class there and write rules against it. The prefixer rewrites `.your-class` into
the *descendant* selector `#<scope> .your-class`, which cannot match the element that carries the
scope id. Root-element styles go under `:root` in your CSS — the config maps `:root` / `html` /
`body` onto the scope element itself.

**`src/index.css`** — keep the `:root` block. Element selectors (`h1`, `button`, `*`) are safe here
*only* because the prefixer scopes them.

**`.env`** and **`.env.example`** — set `VITE_PREVIEW_PORT` to an unused port and point the API vars
at your backend.

**Contract:** every remote must default-export a React component from `./src/App.jsx`. The host
always resolves `<key>/App` — this is enforced by `REMOTE_ENTRY_MODULE` in the shared config, not by
convention.

---

## 2. Add it to the launcher

In `.claude/launch.json`:

```json
{
  "name": "<your-app>-mf-dev",
  "runtimeExecutable": "pnpm",
  "runtimeArgs": ["-C", "Frontend", "--filter", "<your-app>-mf", "dev"],
  "port": 5002
}
```

`-C Frontend` is **required**, not cosmetic. The pnpm workspace root is `Frontend/`, and the repo
root has no `package.json`. Without `-C`, pnpm walks *up past the repository* looking for a
workspace and can latch onto an unrelated `package.json` in your home directory — which is exactly
what happened here, producing a baffling `ERR_PNPM_MALFORMED_METADATA` about a package this project
has never depended on.

---

## 3. Stand up the backend (if it has one)

Copy `Backend/EmployeeService`. Then:

- Give it a **unique `UsePathBase`** segment and a unique port.
- Add its origin to every relevant `Cors__AllowedOrigins__*`.
- Reuse the **same** `Jwt__SigningKeyPublic` and `AuthService__InternalApiKey` as the other services.
  Only AuthService ever holds the private key.
- Gate **every** endpoint with `[RequiresCapability("…")]`, including reads. The discovery endpoint
  reflects over these attributes, so whatever you declare automatically becomes assignable in the
  host's Role editor — nothing is hand-registered. Conversely, an endpoint with no attribute is
  invisible to the permission system *and* ungated: EmployeeService shipped a `GET /api/employees`
  with only `[Authorize]`, which meant any signed-in user could read every employee record including
  salaries.

---

## 4. Register it

**Setup → Applications → + Register App**:

| Field | Value |
|---|---|
| Key | `<your-app>` (lowercase, unique) |
| Display name | anything |
| Manifest URL | `http://localhost:<port>/mf-manifest.json` |
| Permissions source URL | `http://localhost:<backend-port>/<path-base>/permissions` |

Registration now **fetches the manifest** and will reject the app if it is unreachable, isn't a real
Module Federation manifest, or claims a container name another app already uses. If it succeeds, the
app's capabilities are pulled from the permissions endpoint and pushed into AuthService immediately;
grant them per role in **Setup → Role → Application Access**.

---

## 5. Verify

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:<port>/mf-manifest.json
```

Then confirm, in the host:

- The app appears in the sidebar and renders.
- Its capabilities appear under **Application Access** in the Role editor.
- Stop the app's server — within a probe interval the sidebar shows an **Unavailable** badge and the
  dashboard health panel turns red *before* anyone clicks it. Start it again and both recover.
- Open a page in both this app and another remote and confirm neither one's styling shifted.
