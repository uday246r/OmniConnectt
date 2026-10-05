import { loadRemote, registerRemotes } from '@module-federation/runtime'
import type { RemoteAppModule } from './types'

// The host's ModuleFederation instance (name: "omniconnect_host") is auto-initialized by the
// @module-federation/vite plugin as part of the app's bootstrap (see vite.config.ts) — we never
// call init() ourselves, only register/load against the instance that's already there.

/**
 * The manifest URL each remote is registered under in this document.
 *
 * A Map, not a Set of keys: a release promotes a remote by moving its manifest URL to a new version
 * folder (/modules/lead/4.7.3/ → /4.7.4/), and the old Set silently ignored the new URL for the life of
 * the tab — the sidebar said 4.7.4, the tab kept loading 4.7.3, and a rollback was likewise invisible.
 */
const registered = new Map<string, string>()

/** Remotes whose code has actually been loaded into this document, and from which URL. */
const loaded = new Map<string, string>()

/**
 * The minimum a remote needs to be mounted. Narrowed from the registry DTO because the navigation
 * tree is what supplies these now, and it carries only what mounting actually requires.
 */
export interface RemoteAppRef {
  key: string
  manifestUrl: string
  displayName?: string
}

/**
 * True when this document already runs a different build of the remote than the one now published.
 *
 * Module Federation can re-register a remote, but it cannot unload one: the old version's modules,
 * its stores and its stylesheet stay in the page. Mounting the new version beside them would run two
 * builds of one app at once. The only clean switch is a page reload, so the caller offers one.
 */
export function needsReloadForNewVersion(app: RemoteAppRef): boolean {
  const current = loaded.get(app.key)
  return current !== undefined && current !== app.manifestUrl
}

/** Registers a remote's manifest URL with the runtime — again only when the URL changed and nothing of it has loaded yet. */
function registerRemoteApp(app: RemoteAppRef) {
  const previous = registered.get(app.key)
  if (previous === app.manifestUrl) {
    return
  }

  // `force` replaces the earlier registration (and its cached manifest) for a remote that was
  // registered but never loaded — e.g. one whose first load failed before a fix was promoted.
  registerRemotes([{ name: app.key, entry: app.manifestUrl }], previous === undefined ? undefined : { force: true })
  registered.set(app.key, app.manifestUrl)
}

/** Registers (if needed) then loads a remote's exposed ./App module. Only call this for mountable apps. */
export async function loadRemoteAppModule(app: RemoteAppRef): Promise<RemoteAppModule> {
  if (needsReloadForNewVersion(app)) {
    throw new Error(`A new version of "${app.displayName ?? app.key}" was published. Reload the page to use it.`)
  }

  registerRemoteApp(app)

  const mod = await loadRemote<RemoteAppModule>(`${app.key}/App`)
  if (!mod?.default) {
    throw new Error(
      `Failed to load "${app.displayName ?? app.key}". Its manifest may be unreachable, or it doesn't expose "./App" as required.`,
    )
  }

  loaded.set(app.key, app.manifestUrl)
  return mod
}

/** Test seam: forget every registration, as a fresh page load would. */
export function resetRemoteLoaderForTests() {
  registered.clear()
  loaded.clear()
}
