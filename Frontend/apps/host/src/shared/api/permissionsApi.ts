import { env } from '../../config/env'
import { apiFetch } from './httpClient'

const base = env.authServiceUrl

/**
 * What kind of thing a capability guards. Metadata only — nothing in the browser enforces on it.
 *
 * It matters here for two reasons. The editor groups and labels by it instead of showing one
 * undifferentiated list, and it says where the capability arrives from: only `Api` capabilities ride
 * in the token, everything else comes from the fine-grained set. An unrecognised value from a newer
 * server should be rendered, not dropped, hence the open string arm.
 */
export type CapabilityType =
  | 'Api'
  | 'Ui'
  | 'Widget'
  | 'Chart'
  | 'Export'
  | 'BulkAction'
  | 'Action'
  | (string & {})

export interface CapabilityDto {
  key: string
  displayName: string
  /** What granting it actually lets someone do. Null for capabilities discovered from an attribute, which have no prose. */
  description?: string | null
  type?: CapabilityType
  /** The key's dotted prefix — `kpi` from `kpi.total-leads` — so a long list can be grouped without parsing keys here. Null when the key has no prefix. */
  groupKey?: string | null
}

export interface PermissionFeatureDto {
  id: string
  key: string
  displayName: string
  source: 'Host' | 'RemoteApp'
  sortOrder: number
  /** This feature's own declared action set — e.g. Employee only has Create+Edit today. Never a shared global list: what a feature doesn't declare, it can't be granted. */
  capabilities: CapabilityDto[]
  /**
   * Sub-modules of this feature, each grantable in its own right with its own capability set — e.g.
   * Employee Management -> Employee / Department.
   *
   * This field was missing from the type while the API had been returning it for some time, so every
   * editor was blind to sub-modules and instead offered the PARENT key. For an app like
   * `remote.employee`, whose parent declares no capabilities at all, that produced grants such as
   * `remote.employee:View` which the server rejects with
   * "'remote.employee' does not declare a 'View' capability."
   *
   * Empty for host features and for any remote still reporting the flat discovery contract.
   */
  children: PermissionFeatureDto[]
}

/** The permission catalog — shared by settings-users (override editor) and settings-roles (matrix editor). Always fetched, never hardcoded; each feature carries its own capability set. */
export const permissionsApi = {
  catalog: (accessToken: string, activeOnly = true) =>
    apiFetch<PermissionFeatureDto[]>(`${base}/api/permissions/catalog?activeOnly=${activeOnly}`, { accessToken }),
}
