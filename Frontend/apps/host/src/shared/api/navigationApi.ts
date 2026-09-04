import { env } from '../../config/env'
import { apiFetch } from './httpClient'

const base = env.authServiceUrl

/**
 * One row in the sidebar, exactly as the server decided it.
 *
 * Nothing here is interpreted or supplemented in the browser: labels, icons, routes, ordering,
 * nesting and state are all server-side decisions. That is the point of the endpoint — the host used
 * to have no idea what a remote contained, so each remote injected its own rows into the host's DOM.
 */
export interface NavNodeDto {
  /** Stable React key and active-route id. Not always a feature key — one feature can own several rows. */
  key: string
  label: string
  /** Resolved through the shared icon registry; unknown or null falls back to a neutral default. */
  iconKey: string | null
  /** Absolute host route, e.g. "/apps/lead/view-lead". */
  routePath: string
  /** The page name handed to the remote as a prop. Null for host rows and for an app's own root. */
  page: string | null
  order: number
  kind: 'host' | 'remote-app' | 'submodule'
  /**
   * There is deliberately no "hidden" or "forbidden": a row the caller must not see is absent from
   * the response entirely, because sending it would ship the product's module list to every browser.
   */
  state: 'visible' | 'maintenance'
  maintenanceMessage: string | null
  remote: RemoteMountDto | null
  /** Always present, never null, so nothing here has to branch on it. */
  children: NavNodeDto[]
}

export interface RemoteMountDto {
  appKey: string
  manifestUrl: string
  containerName: string | null
  /** Where /apps/{key} should land — the first row the caller can actually see. */
  defaultRoutePath: string | null
}

export interface NavSectionDto {
  key: string
  label: string
  order: number
  /** Pins the section to the bottom. A flag, so the browser never has to know a section by name. */
  pinToBottom: boolean
  items: NavNodeDto[]
}

export interface NavigationResponseDto {
  version: string
  generatedAt: string
  sections: NavSectionDto[]
}

export const navigationApi = {
  get: (accessToken: string, signal?: AbortSignal) =>
    apiFetch<NavigationResponseDto>(`${base}/api/navigation`, { accessToken, signal }),
}

/** Depth-first search for a node by its route path. Used by the route guards to resolve a URL. */
export function findNodeByRoute(sections: NavSectionDto[], routePath: string): NavNodeDto | undefined {
  function walk(nodes: NavNodeDto[]): NavNodeDto | undefined {
    for (const node of nodes) {
      if (node.routePath === routePath) return node
      const hit = walk(node.children)
      if (hit) return hit
    }
    return undefined
  }
  return walk(sections.flatMap((s) => s.items))
}

/** The remote-app node for an app key, if the caller can see it at all. */
export function findAppNode(sections: NavSectionDto[], appKey: string): NavNodeDto | undefined {
  return sections
    .flatMap((s) => s.items)
    .find((n) => n.kind === 'remote-app' && n.remote?.appKey === appKey)
}
