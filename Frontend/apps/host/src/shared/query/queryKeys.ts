/**
 * Typed query keys, in one place.
 *
 * THE RULE: a query key describes WHAT is being fetched, never WHO is asking or with which
 * credential. The access token must never appear in a key.
 *
 * This is not stylistic. The old hand-rolled fetches all listed `accessToken` in their effect
 * dependencies, so every silent token refresh — which happens roughly every 14 minutes, and again
 * on every wake-from-sleep — changed the dependency and re-fired *every query on the current page*.
 * Putting the token in a query key would reproduce that exactly: each refresh would mint a brand
 * new cache entry, orphan the old one, and refetch everything. The token belongs in the fetcher
 * function, which reads it fresh at call time.
 */
export const queryKeys = {
  dashboard: {
    stats: () => ['dashboard', 'stats'] as const,
    health: () => ['dashboard', 'health'] as const,
  },

  users: {
    all: () => ['users'] as const,
    list: (params: { page: number; pageSize: number; search?: string; status?: string }) =>
      ['users', 'list', params] as const,
    detail: (id: string) => ['users', 'detail', id] as const,
  },

  roles: {
    all: () => ['roles'] as const,
    list: (params: { page: number; pageSize: number; search?: string }) => ['roles', 'list', params] as const,
    detail: (id: string) => ['roles', 'detail', id] as const,
    users: (id: string) => ['roles', 'users', id] as const,
  },

  applications: {
    all: () => ['applications'] as const,
    list: (params: { page: number; pageSize: number; search?: string }) =>
      ['applications', 'list', params] as const,
    detail: (id: string) => ['applications', 'detail', id] as const,
  },

  /*
   * The list pages below take the page's own filter-params object as part of the key. A params object
   * describes WHAT is shown, so it satisfies the rule above; live updates reach these queries through
   * shared/query/invalidationBridge.ts rather than a revision number in the key.
   */
  auditLogPages: {
    list: (params: object) => ['auditLogs', 'list', params] as const,
    summary: (params: object) => ['auditLogs', 'summary', params] as const,
    facets: (params: object) => ['auditLogs', 'facets', params] as const,
  },

  systemLogs: {
    all: () => ['systemLogs'] as const,
    list: (params: object) => ['systemLogs', 'list', params] as const,
    summary: (params: object) => ['systemLogs', 'summary', params] as const,
  },

  approvals: {
    all: () => ['approvals'] as const,
    list: (params: object) => ['approvals', 'list', params] as const,
    facets: (params: object) => ['approvals', 'facets', params] as const,
    summary: () => ['approvals', 'summary'] as const,
    mine: (params: object) => ['approvals', 'mine', params] as const,
    mineFacets: (params: object) => ['approvals', 'mine-facets', params] as const,
    detail: (id: string) => ['approvals', 'detail', id] as const,
  },

  /** The Users directory page: a server-filtered page, the whole-directory counts, role options, type-ahead. */
  userDirectory: {
    page: (params: object) => ['users', 'directory', 'page', params] as const,
    summary: () => ['users', 'directory', 'summary'] as const,
    facets: (params: object) => ['users', 'directory', 'facets', params] as const,
    suggest: (field: 'search' | 'name' | 'phone', needle: string) => ['users', 'directory', 'suggest', field, needle] as const,
  },

  auditLogs: {
    all: () => ['auditLogs'] as const,
    /**
     * `tab` is part of the key on purpose: it is what makes each tab read a DIFFERENT cache entry.
     * The reported bug — switching to "Login Successes" and briefly seeing the Login Errors rows
     * under the new tab's column headers — happened because a single `logs` state was shared by all
     * three tabs and was never cleared when the tab changed. With the tab in the key there is no
     * shared slot for stale rows to sit in.
     */
    list: (params: {
      tab: string
      page: number
      pageSize: number
      service?: string
      from?: string
      to?: string
    }) => ['auditLogs', 'list', params] as const,
    summary: (params: { from?: string; to?: string }) => ['auditLogs', 'summary', params] as const,
  },

  permissions: {
    catalog: () => ['permissions', 'catalog'] as const,
  },

  sso: {
    config: () => ['sso', 'config'] as const,
  },
} as const
