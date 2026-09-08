import type { PermissionFeatureDto } from '../../../shared/api/permissionsApi'
import type { SidebarAppDto } from '../../../shared/api/moduleRegistryClient'

export type CapabilityTone =
  | 'view'
  | 'create'
  | 'edit'
  | 'delete'
  | 'disable'
  | 'register'
  | 'approve'
  | 'export'
  | 'manage'
  | 'kpi'
  | 'default'

export interface FormattedCapability {
  /** The original raw permission string, e.g. "host.settings.applications:Disable" */
  raw: string
  featureKey: string
  capabilityKey: string
  appKey: string
  appName: string
  appSource: 'Host' | 'RemoteApp'
  moduleName: string
  categoryName: string
  actionTitle: string
  description: string
  verb: string
  tone: CapabilityTone
}

export interface AppPermissionGroup {
  appKey: string
  appName: string
  appSource: 'Host' | 'RemoteApp'
  totalCount: number
  modules: {
    moduleName: string
    categoryName: string
    capabilities: FormattedCapability[]
  }[]
}

/** Pre-defined human-friendly descriptions for core platform capabilities */
const HOST_CAPABILITY_METADATA: Record<
  string,
  Record<string, { title: string; desc: string; tone?: CapabilityTone }>
> = {
  'host.dashboard': {
    View: {
      title: 'View Platform Dashboard',
      desc: 'Access central dashboard overview, operational health, and platform metrics.',
      tone: 'view',
    },
  },
  'host.settings.applications': {
    View: {
      title: 'View Applications',
      desc: 'Browse registered remote micro-frontend applications and deployment status.',
      tone: 'view',
    },
    Register: {
      title: 'Register Application',
      desc: 'Register new remote micro-frontend applications and configure manifest endpoints.',
      tone: 'register',
    },
    Create: {
      title: 'Register Application',
      desc: 'Register new remote micro-frontend applications and configure manifest endpoints.',
      tone: 'register',
    },
    Edit: {
      title: 'Edit Application Details',
      desc: 'Update remote application configuration, display name, icon, and navigation order.',
      tone: 'edit',
    },
    Disable: {
      title: 'Disable / Enable Application',
      desc: 'Deactivate applications or toggle maintenance mode across the platform.',
      tone: 'disable',
    },
    Delete: {
      title: 'Delete Application',
      desc: 'Permanently remove micro-frontend application registrations from the system.',
      tone: 'delete',
    },
  },
  'host.settings.roles': {
    View: {
      title: 'View Roles & RBAC',
      desc: 'Inspect defined user roles, permission matrices, and assigned account counts.',
      tone: 'view',
    },
    Create: {
      title: 'Create Role',
      desc: 'Define new platform roles and configure granular application capability scopes.',
      tone: 'create',
    },
    Edit: {
      title: 'Edit Role Permissions',
      desc: 'Modify granted features, fine-grained capabilities, and role metadata.',
      tone: 'edit',
    },
    Delete: {
      title: 'Delete Role',
      desc: 'Remove custom system roles that have no active users assigned.',
      tone: 'delete',
    },
  },
  'host.settings.users': {
    View: {
      title: 'View User Directory',
      desc: 'Browse platform user accounts, assigned roles, and activity statuses.',
      tone: 'view',
    },
    Create: {
      title: 'Create User Account',
      desc: 'Provision new user identities, set primary roles, and establish access.',
      tone: 'create',
    },
    Edit: {
      title: 'Edit User Profile',
      desc: 'Update account details, role assignments, and individual permission overrides.',
      tone: 'edit',
    },
    Disable: {
      title: 'Disable / Activate User',
      desc: 'Suspend user sign-in access or restore deactivated account status.',
      tone: 'disable',
    },
    Delete: {
      title: 'Delete User',
      desc: 'Permanently remove user accounts and revoke all active sessions.',
      tone: 'delete',
    },
  },
  'host.system.approvals': {
    View: {
      title: 'View Approval Center',
      desc: 'Browse maker-checker change requests, pending items, and approval histories.',
      tone: 'view',
    },
    Approve: {
      title: 'Approve / Reject Requests',
      desc: 'Act as an authorized checker to review, approve, or reject administrative changes.',
      tone: 'approve',
    },
  },
  'host.system.audit-logs': {
    View: {
      title: 'View System Audit Trail',
      desc: 'Inspect immutable records of user logins, data changes, and administrative actions.',
      tone: 'view',
    },
    Export: {
      title: 'Export Audit Logs',
      desc: 'Export filtered audit trail records to CSV files for compliance reporting.',
      tone: 'export',
    },
  },
  'host.system.checker-assignment': {
    View: {
      title: 'View Checker Assignments',
      desc: 'View assigned checkers and maker-checker rules configured for sensitive operations.',
      tone: 'view',
    },
    Manage: {
      title: 'Manage Checker Assignments',
      desc: 'Assign, reconfigure, or remove authorized checkers across protected modules.',
      tone: 'manage',
    },
  },
}

/** Pre-defined human-friendly descriptions for Lead Management capabilities */
const LEAD_CAPABILITY_METADATA: Record<
  string,
  Record<string, { title: string; desc: string; tone?: CapabilityTone }>
> = {
  'remote.lead.lead': {
    View: {
      title: 'View Leads',
      desc: 'Search, filter, and inspect customer leads and pipeline opportunities.',
      tone: 'view',
    },
    Create: {
      title: 'Create Lead',
      desc: 'Log and register new prospective leads and customer inquiries.',
      tone: 'create',
    },
    Edit: {
      title: 'Edit Lead Details',
      desc: 'Update lead progression, assigned agents, contact notes, and status.',
      tone: 'edit',
    },
    Delete: {
      title: 'Delete Lead',
      desc: 'Permanently remove obsolete lead records from the database.',
      tone: 'delete',
    },
  },
  'remote.lead.auditlog': {
    View: {
      title: 'View Lead Audit Trail',
      desc: 'Review chronological history of lead updates, assignments, and status shifts.',
      tone: 'view',
    },
  },
  'remote.lead.dashboard': {
    View: {
      title: 'View Lead Dashboard',
      desc: 'Access real-time lead analytics, performance graphs, and pipeline summaries.',
      tone: 'view',
    },
    'kpi.total-leads': {
      title: 'KPI Metric: Total Leads',
      desc: 'Display Total Leads count and overview metric on the dashboard.',
      tone: 'kpi',
    },
    'kpi.new-leads': {
      title: 'KPI Metric: New Leads',
      desc: 'Display New Leads registered and recent acquisition metrics.',
      tone: 'kpi',
    },
    'kpi.in-progress': {
      title: 'KPI Metric: In Progress',
      desc: 'Display actively handled leads undergoing follow-up.',
      tone: 'kpi',
    },
    'kpi.converted': {
      title: 'KPI Metric: Converted Leads',
      desc: 'Display successfully converted leads and closed deals.',
      tone: 'kpi',
    },
    'kpi.conversion-rate': {
      title: 'KPI Metric: Conversion Rate',
      desc: 'Display percentage lead-to-customer conversion efficiency metric.',
      tone: 'kpi',
    },
  },
  'remote.lead.fieldsettings': {
    View: {
      title: 'View Field Settings',
      desc: 'View configured custom lead fields, form sections, and validation criteria.',
      tone: 'view',
    },
    Manage: {
      title: 'Manage Field Settings',
      desc: 'Configure, add, or modify custom lead fields and dynamic form layouts.',
      tone: 'manage',
    },
  },
}

/** Pre-defined human-friendly descriptions for Customer 360 capabilities */
const C360_CAPABILITY_METADATA: Record<
  string,
  Record<string, { title: string; desc: string; tone?: CapabilityTone }>
> = {
  'remote.customer360.customer': {
    View: {
      title: 'View Customer 360 Profile',
      desc: 'Search and inspect unified individual and corporate 360 customer profiles.',
      tone: 'view',
    },
  },
  'remote.customer360.products': {
    View: {
      title: 'View Customer Products',
      desc: 'Inspect customer held banking accounts, loans, deposits, and cards.',
      tone: 'view',
    },
  },
  'remote.customer360.auditlog': {
    View: {
      title: 'View Customer Audit Trail',
      desc: 'Review access logs and historical records for customer data inquiries.',
      tone: 'view',
    },
  },
}

/** Converts a string like 'checker-assignment' or 'customer_service' into 'Checker Assignment' */
export function humanizeKey(str: string): string {
  if (!str) return ''
  return str
    .replace(/[._-]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (word.toLowerCase() === 'kpi') return 'KPI'
      if (word.toLowerCase() === 'rbac') return 'RBAC'
      if (word.toLowerCase() === 'csv') return 'CSV'
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

/** Determines badge tone based on capability verb */
export function resolveVerbTone(verb: string): CapabilityTone {
  const lower = verb.toLowerCase()
  if (lower.startsWith('kpi')) return 'kpi'
  if (lower.includes('view') || lower.includes('read')) return 'view'
  if (lower.includes('register')) return 'register'
  if (lower.includes('create') || lower.includes('add')) return 'create'
  if (lower.includes('edit') || lower.includes('update')) return 'edit'
  if (lower.includes('disable') || lower.includes('suspend')) return 'disable'
  if (lower.includes('delete') || lower.includes('remove')) return 'delete'
  if (lower.includes('approve') || lower.includes('reject')) return 'approve'
  if (lower.includes('export') || lower.includes('download')) return 'export'
  if (lower.includes('manage') || lower.includes('admin')) return 'manage'
  return 'default'
}

/**
 * Parses any raw capability string (e.g. `host.settings.applications:Disable`)
 * into a rich, human-readable structure.
 */
export function formatSinglePermission(
  rawPermission: string,
  catalog?: PermissionFeatureDto[],
  registryApps?: SidebarAppDto[],
): FormattedCapability {
  const [featureKey = '', capabilityKey = ''] = rawPermission.split(':')
  const isHost = featureKey.startsWith('host.') || featureKey === 'host'
  const isRemote = featureKey.startsWith('remote.')

  // 1. Determine App Key & Name
  let appKey = 'host'
  let appName = 'Host Platform'
  let appSource: 'Host' | 'RemoteApp' = 'Host'

  if (isRemote) {
    appSource = 'RemoteApp'
    const parts = featureKey.split('.')
    // parts[0] is 'remote', parts[1] is appKey (e.g. 'lead', 'customer360')
    const extractedAppKey = parts[1] || 'remote'
    appKey = `remote.${extractedAppKey}`

    // Check if registryApps has this app's official displayName
    const matchedApp = registryApps?.find(
      (a) => a.key.toLowerCase() === extractedAppKey.toLowerCase(),
    )
    if (matchedApp?.displayName) {
      appName = matchedApp.displayName
    } else if (extractedAppKey === 'lead') {
      appName = 'Lead Management'
    } else if (extractedAppKey.includes('customer360')) {
      appName = 'Customer 360'
    } else if (extractedAppKey === 'employee') {
      appName = 'Employee Management'
    } else {
      appName = `${humanizeKey(extractedAppKey)} App`
    }
  }

  // 2. Determine Module Name & Category
  let moduleName = ''
  let categoryName = ''

  if (isHost) {
    if (featureKey.includes('settings.')) {
      categoryName = 'Setup & Settings'
      const mod = featureKey.split('settings.')[1]
      moduleName = humanizeKey(mod)
    } else if (featureKey.includes('system.')) {
      categoryName = 'System Governance'
      const mod = featureKey.split('system.')[1]
      moduleName = humanizeKey(mod)
    } else if (featureKey.includes('dashboard')) {
      categoryName = 'Platform Overview'
      moduleName = 'Dashboard'
    } else {
      categoryName = 'Core Platform'
      moduleName = humanizeKey(featureKey.replace(/^host\./, ''))
    }
  } else {
    // Remote features: e.g. remote.lead.auditlog -> Module: Audit Log
    const parts = featureKey.split('.')
    if (parts.length >= 3) {
      moduleName = humanizeKey(parts.slice(2).join(' '))
      categoryName = appName
    } else {
      moduleName = appName
      categoryName = 'Application'
    }
  }

  // 3. Match from metadata dictionaries (Host, Lead, C360)
  const hostMeta = HOST_CAPABILITY_METADATA[featureKey]?.[capabilityKey]
  const leadMeta = LEAD_CAPABILITY_METADATA[featureKey]?.[capabilityKey]
  const c360Meta = C360_CAPABILITY_METADATA[featureKey]?.[capabilityKey]
  const knownMeta = hostMeta || leadMeta || c360Meta

  // 4. Check live catalog if available
  let catalogTitle: string | undefined
  let catalogDesc: string | undefined

  if (catalog && catalog.length > 0) {
    // Walk catalog to find feature and capability
    const findInCatalog = (features: PermissionFeatureDto[]): boolean => {
      for (const f of features) {
        if (f.key === featureKey) {
          if (f.displayName) moduleName = f.displayName
          const cap = f.capabilities.find((c) => c.key === capabilityKey)
          if (cap) {
            catalogTitle = cap.displayName
            catalogDesc = cap.description ?? undefined
            return true
          }
        }
        if (f.children && f.children.length > 0) {
          if (findInCatalog(f.children)) return true
        }
      }
      return false
    }
    findInCatalog(catalog)
  }

  // 5. Generate human-readable Action Title, Description, and Verb
  let actionTitle = knownMeta?.title || catalogTitle || ''
  let description = knownMeta?.desc || catalogDesc || ''
  let verb = capabilityKey

  if (!actionTitle) {
    if (capabilityKey.startsWith('kpi.')) {
      const metric = capabilityKey.replace(/^kpi\./, '')
      actionTitle = `KPI: ${humanizeKey(metric)}`
      verb = 'KPI'
      description = `Authorized to view the ${humanizeKey(metric)} metric on the dashboard.`
    } else {
      actionTitle = `${capabilityKey} ${moduleName}`
      description = `Grants permission to ${capabilityKey.toLowerCase()} ${moduleName.toLowerCase()} resources.`
    }
  }

  const tone = knownMeta?.tone || resolveVerbTone(verb)

  return {
    raw: rawPermission,
    featureKey,
    capabilityKey,
    appKey,
    appName,
    appSource,
    moduleName: moduleName || 'General',
    categoryName: categoryName || appName,
    actionTitle,
    description: description || 'Active capability authorized for your account.',
    verb,
    tone,
  }
}

/**
 * Groups an array of permission strings by Application, then by Module.
 */
export function groupPermissionsByApp(
  permissions: string[],
  catalog?: PermissionFeatureDto[],
  registryApps?: SidebarAppDto[],
): AppPermissionGroup[] {
  if (!permissions || permissions.length === 0) return []

  const formatted = permissions.map((p) => formatSinglePermission(p, catalog, registryApps))

  // Group by appKey
  const appMap = new Map<string, FormattedCapability[]>()
  for (const cap of formatted) {
    const list = appMap.get(cap.appKey) || []
    list.push(cap)
    appMap.set(cap.appKey, list)
  }

  const result: AppPermissionGroup[] = []

  // Ensure Host Platform is sorted first, then others alphabetically
  const sortedAppKeys = Array.from(appMap.keys()).sort((a, b) => {
    if (a === 'host') return -1
    if (b === 'host') return 1
    return a.localeCompare(b)
  })

  for (const appKey of sortedAppKeys) {
    const items = appMap.get(appKey) || []
    const first = items[0]

    // Group items within this app by moduleName
    const moduleMap = new Map<string, FormattedCapability[]>()
    for (const item of items) {
      const mList = moduleMap.get(item.moduleName) || []
      mList.push(item)
      moduleMap.set(item.moduleName, mList)
    }

    const modules = Array.from(moduleMap.entries()).map(([mName, caps]) => ({
      moduleName: mName,
      categoryName: caps[0]?.categoryName || mName,
      capabilities: caps.sort((a, b) => a.actionTitle.localeCompare(b.actionTitle)),
    }))

    result.push({
      appKey,
      appName: first?.appName || humanizeKey(appKey),
      appSource: first?.appSource || 'Host',
      totalCount: items.length,
      modules,
    })
  }

  return result
}
