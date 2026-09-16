# Product Marketplace — Frontend

React + TypeScript + Vite SPA for the Product Marketplace admin (Dashboard, Products, Categories,
Promotions, Applications, Setup, Audit Logs).

## Getting started

Everything runs from **this folder**:

```bash
npm install
```

```bash
npm run dev
```

The app runs at `http://localhost:5173`. Start the backend too — see `../backend/README.md`.

No other setup is needed: `.env` is committed and already points at the local API.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Typecheck (`tsc -b`) then production build |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Oxlint |

## Configuration

`.env` sets the API base URL:

```
VITE_API_BASE_URL=http://localhost:5266/api
```

It contains no secrets, which is why it is committed — a fresh clone runs without extra steps. For a
machine-specific override, create `.env.local` (gitignored); it takes precedence.

npm is the package manager for this project (pinned via `packageManager` in `package.json`), with
`package-lock.json` as the single lockfile.

## Structure

```
src/
├── pages/         route-level pages
├── components/    shared and feature components
├── stores/        Zustand state, one per domain area
├── services/      API clients (all through services/httpClient.ts)
├── permissions/   permission checks + the current-user seam
├── layouts/       StandaloneShell — local dev shell only
└── types/         shared domain types
```

## Host App integration

This app is a **remote**, designed to be mounted inside the Host App. It never authenticates anyone:
the Host App owns identity, roles and permissions.

- `src/permissions/currentUser.ts` exposes `setCurrentUser()` for the Host App to call at mount.
  Until it does, a clearly-labelled development identity is used.
- `src/layouts/StandaloneShell.tsx` is a local-dev shell only — the Host App supplies the real
  header, navigation, notifications and global search.
- Requests carry the current actor to the API for audit logging (`services/httpClient.ts`). The
  backend trusts those headers only in development; an authenticated Host principal always wins.
