/**
 * The single source of truth for Module Federation `shared` dependencies across the host and every
 * remote app.
 *
 * Why this package exists
 * -----------------------
 * The host and each remote must agree, exactly, on which packages are shared singletons. Previously
 * this block was copy-pasted into each app's vite config, which is fine with one remote and a
 * guaranteed source of drift at three. Worse, the duplicated block only listed react and react-dom,
 * which hid a real trap: `react-router-dom` was NOT shared, so the first remote to import it would
 * silently get its own second copy of the router module — with its own, empty Router context. Every
 * `useNavigate()` / `<Link>` inside that remote would throw "useNavigate() may be used only in the
 * context of a <Router>" even though the host clearly has a router mounted. Sharing it as a
 * singleton is what makes host-provided routing usable from inside a remote at all.
 *
 * Rules for adding to this list
 * -----------------------------
 * A package belongs here when two copies of it in one page would be *incorrect*, not merely
 * wasteful — i.e. it holds module-level state that must be shared: React (hooks dispatcher),
 * react-dom (root registry), react-router-dom (Router context), zustand (store instances),
 * @tanstack/react-query (the QueryClient context). Stateless utility libraries do NOT belong here;
 * sharing them only adds coupling.
 *
 * `requiredVersion` is intentionally a caret range on the MINOR version, not an exact pin: remotes
 * are built and deployed independently, so demanding an exact patch match would break a remote the
 * moment the host bumped a patch release. `singleton: true` means one instance wins regardless; the
 * range exists so a genuinely incompatible MAJOR mismatch still surfaces as a console warning
 * instead of silently misbehaving.
 */

/**
 * The full registry of shareable singletons. The HOST declares all of these (it is the provider).
 *
 * A remote declares only the subset it actually imports — see `remoteFederationConfig`. That is not
 * merely an optimisation: the Module Federation vite plugin emits a "prebuild" module for every
 * shared entry, so declaring a package a remote has not installed fails the build outright.
 */
export const sharedDependencies = {
  react: { singleton: true, requiredVersion: '^19.2.0' },
  'react-dom': { singleton: true, requiredVersion: '^19.2.0' },
  'react-router-dom': { singleton: true, requiredVersion: '^7.18.0' },
  zustand: { singleton: true, requiredVersion: '^5.0.0' },
  '@tanstack/react-query': { singleton: true, requiredVersion: '^5.0.0' },
}

/** Every remote renders inside the host's React tree, so these two are always shared. */
export const BASELINE_SHARED = ['react', 'react-dom']

/** Picks a subset of the registry, failing loudly on a typo rather than silently sharing nothing. */
function pickShared(names) {
  return Object.fromEntries(
    names.map((name) => {
      const config = sharedDependencies[name]
      if (!config) {
        throw new Error(
          `[federation-config] Unknown shared dependency "${name}". ` +
            `Known: ${Object.keys(sharedDependencies).join(', ')}. ` +
            'Add it to sharedDependencies first if it genuinely needs to be a singleton.',
        )
      }
      return [name, config]
    }),
  )
}

/**
 * The module every remote must expose, and that the host always resolves. The host calls
 * `loadRemote(`${key}/App`)` where `key` is the registry key — so this string is a hard contract,
 * not a convention. A remote exposing anything else will register fine and then fail at runtime.
 */
export const REMOTE_ENTRY_MODULE = './App'

/**
 * Builds the federation options for a remote app. Remotes should call this rather than hand-writing
 * the block, so the expose path and shared set can never drift from the host's expectations.
 *
 * @param {string} name Module Federation container name. MUST be globally unique across all remote
 *   apps — it becomes a global identifier in the browser, and two remotes sharing one will overwrite
 *   each other. AuthService enforces this at registration time by reading the built manifest, and a unique
 * @param {string} entry Path to the component module exposed as `./App`.
 * @param {string[]} [uses] Extra singletons this remote imports, on top of react/react-dom.
 *
 *   IMPORTANT: if your remote imports `react-router-dom`, you MUST list it here. Sharing requires
 *   BOTH sides to declare it — the host already does. A remote that imports the router without
 *   declaring it silently gets its own second copy, with its own empty Router context, and every
 *   `useNavigate()` / `<Link>` inside it throws "may be used only in the context of a <Router>"
 *   despite the host clearly having one mounted. The same applies to `zustand` and
 *   `@tanstack/react-query` if the remote uses the host's stores or query client.
 *
 *   Only list what you actually install and import: the federation plugin emits a prebuild module
 *   per shared entry, so naming an uninstalled package fails the build.
 */
export function remoteFederationConfig(name, entry, uses = []) {
  return {
    name,
    filename: 'remoteEntry.js',
    manifest: true,
    dts: false,
    exposes: { [REMOTE_ENTRY_MODULE]: entry },
    shared: pickShared([...new Set([...BASELINE_SHARED, ...uses])]),
  }
}

/**
 * Builds the federation options for the host.
 *
 * The host declares ZERO build-time remotes on purpose: every remote is registered at runtime from a
 * manifest URL stored in AuthDb, so which remotes exist is not knowable at
 * build time and adding one never requires rebuilding the host.
 *
 * `provides` defaults to react/react-dom only, and that default is load-bearing — MEASURED, not
 * assumed. Every package listed here gets a Module Federation "loadShare" wrapper in the host's
 * entry graph, and those wrappers are substantially larger than the plain module: adding
 * react-router-dom, zustand and @tanstack/react-query took the host's eagerly-preloaded JavaScript
 * from ~388KB to ~501KB, because react-router-dom's loadShare wrapper alone is 203KB against a 62KB
 * plain chunk.
 *
 * That cost buys nothing until a remote actually imports one of them, and no remote does today. So
 * do NOT pre-emptively widen this list. When a remote genuinely needs host-provided routing or
 * state, add that ONE package here and to that remote's `uses`, and accept the cost then — knowing
 * what it is. The registry in `sharedDependencies` exists so that step is a one-word change rather
 * than a research exercise.
 */
export function hostFederationConfig(name, provides = BASELINE_SHARED) {
  return {
    name,
    shared: pickShared([...new Set([...BASELINE_SHARED, ...provides])]),
  }
}
