# Products & Marketplace (remote app)

The bank's product catalogue: **Category → Sub-category → Product**, plus the Setup that defines what a
product carries. A Module Federation *remote* — it is loaded by the host shell at runtime and never runs
its own sign-in. Backend: `Backend/ProductsService`. Port **5004**, container `products_mf`, app key
`products`.

## The model

| Level | Is | Example |
|---|---|---|
| Category | A line of business | Loans |
| Sub-category | A *type* of product. Owns the attributes and documents every product of that type shares | Home Loan |
| Product | A specific *offering* | Home Loan – Salaried |

**What the catalogue shows is derived, never written.** A product is visible only when its own status, its
sub-category's and its category's are all *live*. Setting a category to a non-live status hides everything
beneath it without touching those records, so switching it back restores each exactly as it was. Which
statuses are live is set in Setup → Statuses; **nothing in this app compares a status to a word like
"Active"** — it asks the status store (`useStatus`, `resolveStatus`).

**Nothing about a product's attributes is compiled in.** The product form renders one control per field
definition of the chosen sub-category (`ProductFieldInput`), validates it the way the server does
(`utils/productForm.ts`), and the card shows whichever attributes the definitions marked for it. Adding an
attribute in Setup → Fields adds it to the form and the card with no change to this code.

## Screens

Routed by the host from the URL (`/apps/products/<page>` → the `page` prop); the keys are in `src/App.tsx`
and match the sidebar the backend publishes.

| `page` | Screen |
|---|---|
| `dashboard` (default) | KPI tiles, products-by-category chart, status donut, recent products and activity |
| `products` | Category tabs with counts, filters, the card grid, add/edit form, details, status change, delete, CSV |
| `categories` | List, add/edit, reorder, delete |
| `sub-categories` | The same, filed under a category |
| `setup` | Fields (per sub-category), Documents, Statuses |
| `audit-logs` | The trail of changes, with a live feed and CSV download |

## Running it

```bash
pnpm dev:products          # or: pnpm -C Frontend --filter products-mf dev
```

That builds and serves the remote (`vite build --watch` + `vite preview`; there is no HMR — Module
Federation needs a real build). It needs a host to show anything: the API refuses every call without a
platform token, so opened on its own the screens show their empty and error states. Run it through the
platform (`node scripts/dev-backends.mjs` and `pnpm dev:host`), or see `docs/design/products/PROGRESS.md`
for how to look at it with a stand-in host and a throwaway Postgres.

Configuration (`.env`, see `.env.example`): `VITE_API_BASE_URL` (default `http://localhost:5266/api`),
`VITE_APP_KEY` (`products`; permissions are `remote.<key>.<module>:<Capability>`), `VITE_PREVIEW_PORT`.

## How it is built

```
src/
  App.tsx            page registry, permission provider, toasts
  api/hostBridge.ts  the only line to the host: token, user, capabilities (window.__omniconnectHost__)
  services/          httpClient (token, 401 refresh, approval handling, ApiError with per-field
                     messages, request cache) and one small module per resource
  stores/            Zustand. createPagedStore is the shared list logic (query, cancel, stale-response);
                     useStatusConfigStore is the source of what a status means
  pages/             one folder per screen; page.module.css is the shared frame
  components/        StatusBadge, RowMenu, ConfirmDialog, ListToolbar, KpiTile, charts, form fields
  hooks/useSaveAction  applied / refused / held-for-approval, handled the same in every form
  permissions/       PERMISSIONS: the exact module:Capability strings the server enforces
  utils/             catalogForm and productForm (client twins of the server's rules), format
```

Conventions worth keeping:

- **Build on `@omniconnect/ui`.** Tables, drawers, modals, tabs, pagination, badges and inputs come from it.
  Styles are CSS modules using the `--omni-*` tokens (`@omniconnect/ui/tokens.css` is imported first in
  `App.tsx`); there is no global stylesheet, so nothing can leak into the host or another remote.
- **Read stores through a selector** (`useStore((s) => s.x)` or `useShallow`), never `useStore()` — a
  whole-store subscription re-renders on every write.
- **Every GET goes through `httpClient`**, which shares identical in-flight reads and briefly reuses
  successes; any write clears the cache. Keys include the signed-in user.
- **Permissions** are checked with `usePermissions().has(PERMISSIONS.X)` and are the server's own strings.
  A button hidden under any other name would show to people the server refuses.
- **A change may be held for approval** (maker-checker). `useSaveAction` and `ConfirmDialog` treat that as
  neither success nor failure: they close, and the interceptor's toast says who has to approve it.
- **No hardcoded catalogue data.** Icons are typed against the shared icon set (`catalogIcons.ts`),
  status tones against the badge's own, and currency/units come from the field's `unit`.

## Tests

```bash
pnpm test                       # vitest run
pnpm exec vitest run src/utils/productForm.test.ts -t "dropdown"
```

`vitest.config.ts` is separate from `vite.config.ts` (which wires Module Federation and needs a live
remote), so tests never depend on one. Files must be named `*.test.ts(x)` — `.spec.*` is not collected.
`userEvent.type` treats `{` and `[` as key syntax; use `fireEvent.change` for literal text containing them.

## Known gaps

- Formats defined in **Manage Formats** (AuthService) cannot be picked in the field editor — only built-in
  formats. The server still enforces any that a field uses.
- The mockups' row checkboxes are not built: there is no bulk action for them to drive.
