import type { CapabilityDto, PermissionFeatureDto } from '../api/permissionsApi'

/**
 * Turning the permission catalog into something a grid can render, in ONE place.
 *
 * Every permission editor previously derived this itself, and each got it wrong in the same two ways:
 *
 *  1. **Fixed columns.** The grids hardcoded View / Create / Edit / Delete and aliased the leftovers
 *     (Register shown under Create, Disable under Delete). Anything that matched no column had no
 *     checkbox at all, which silently made four seeded capabilities impossible to grant through the
 *     UI: `host.settings.users:Disable`, `host.settings.applications:Register`,
 *     `host.system.audit-logs:Export` and `host.profile:ChangePassword`. A remote declaring anything
 *     outside those four verbs was equally ungrantable, defeating the point of dynamic discovery.
 *
 *  2. **Grants against the parent key.** A remote app whose capabilities live on its sub-modules
 *     declares NOTHING on the parent feature. The live catalog for the Employee app is:
 *
 *         remote.employee                 capabilities: []
 *           remote.employee.department    capabilities: [View]
 *           remote.employee.employee      capabilities: [Create, Delete, Edit, View]
 *
 *     The UI rendered one "Base Access" row against `remote.employee` and emitted
 *     `remote.employee:View`, which the server correctly refuses with
 *     "'remote.employee' does not declare a 'View' capability." The grid has to offer the CHILD keys.
 *
 * Deriving both rows and columns from the catalog means an application that declares only a
 * `department` module shows exactly one row, and a remote that later adds an `Approve` capability
 * gets a column with no frontend change at all.
 */

/** One grantable line in a permission grid. `key` is the feature key a grant is emitted against. */
export interface PermissionRow {
  key: string
  label: string
  /** True for a parent feature that also declares capabilities of its own. */
  isParent: boolean
  capabilities: CapabilityDto[]
}

export interface PermissionGroup {
  /** The top-level feature this group represents. */
  feature: PermissionFeatureDto
  rows: PermissionRow[]
  /**
   * Union of every VERB capability any row declares, in the order the server listed them.
   *
   * Verbs only — see {@link isBusinessCapability}. A business capability belongs to exactly one row
   * and gets a column nothing else can fill, so including them would grow the matrix by one nearly
   * empty column each: Lead's dashboard alone would add ten.
   */
  columns: { key: string; displayName: string }[]
}

/**
 * Whether a capability is a business capability rather than a CRUD-style verb.
 *
 * The distinction is the dotted key — `kpi.total-leads` against `View` — and it decides only how the
 * capability is PRESENTED. Verbs are the same handful repeated across every feature, so a matrix
 * with one column per verb is the compact way to show them. Business capabilities are unique to the
 * feature that declares them, carry a description worth reading, and there can be dozens, so they get
 * a searchable grouped list instead.
 *
 * Nothing about enforcement or grant format depends on this. Both kinds are stored the same way,
 * granted the same way, and produce the same `{featureKey}:{capability}` string.
 */
export function isBusinessCapability(capability: { key: string }): boolean {
  return capability.key.includes('.')
}

/** Splits one row's capabilities into the two presentations. */
export function splitCapabilities(capabilities: CapabilityDto[]): {
  verbs: CapabilityDto[]
  business: CapabilityDto[]
} {
  return {
    verbs: capabilities.filter((c) => !isBusinessCapability(c)),
    business: capabilities.filter(isBusinessCapability),
  }
}

/**
 * A capability key containing the separator itself would produce an ambiguous permission string —
 * `feature:a:b` cannot be split back into a feature and a capability. Nothing emits one, but a
 * malformed sync payload could, and silently granting it would be worse than silently dropping it.
 */
function isWellFormed(capability: { key: string }): boolean {
  return !capability.key.includes(':')
}

/** Standard preferred order for CRUD and common action verbs */
const PREFERRED_CAPABILITY_ORDER: Record<string, number> = {
  view: 10,
  create: 20,
  edit: 30,
  delete: 40,
  disable: 50,
  register: 60,
  export: 70,
}

/**
 * Rows for one feature:
 * - If the feature has child sub-modules (e.g. Department, Employee), render ONLY the child sub-modules as rows.
 * - If the feature has no children, render the feature itself (if it declares capabilities).
 */
export function rowsForFeature(feature: PermissionFeatureDto): PermissionRow[] {
  const rows: PermissionRow[] = []

  // If there are sub-modules (children), render each sub-module as its own row (skip redundant parent base access)
  if (feature.children && feature.children.length > 0) {
    for (const child of feature.children) {
      rows.push({
        key: child.key,
        label: child.displayName,
        isParent: false,
        capabilities: (child.capabilities || []).filter(isWellFormed),
      })
      // Recurse: the model is self-referencing, so a sub-module may itself have sub-modules.
      for (const grandchild of rowsForFeature(child)) {
        if (grandchild.key !== child.key) rows.push(grandchild)
      }
    }
  } else if (feature.capabilities && feature.capabilities.length > 0) {
    rows.push({
      key: feature.key,
      label: feature.displayName,
      isParent: true,
      capabilities: feature.capabilities.filter(isWellFormed),
    })
  }

  return rows
}

/** The union of capabilities across rows, sorted cleanly (CREATE, VIEW, EDIT, DELETE first, then others). */
export function columnsForRows(rows: PermissionRow[]): { key: string; displayName: string }[] {
  const columns: { key: string; displayName: string }[] = []
  for (const row of rows) {
    // Verbs only. A business capability is declared by exactly one row, so giving it a column would
    // add one that every other row renders as "—": Lead's dashboard alone would widen this by ten.
    // They are rendered as a searchable list instead — see CapabilityPicker.
    for (const cap of row.capabilities.filter((c) => !isBusinessCapability(c))) {
      if (!columns.some((c) => c.key.toLowerCase() === cap.key.toLowerCase())) {
        columns.push({ key: cap.key, displayName: cap.displayName })
      }
    }
  }

  return columns.sort((a, b) => {
    const orderA = PREFERRED_CAPABILITY_ORDER[a.key.toLowerCase()] ?? 100
    const orderB = PREFERRED_CAPABILITY_ORDER[b.key.toLowerCase()] ?? 100
    if (orderA !== orderB) return orderA - orderB
    return a.displayName.localeCompare(b.displayName)
  })
}

/** Rows + columns for one feature, ready to render. */
export function groupForFeature(feature: PermissionFeatureDto): PermissionGroup {
  const rows = rowsForFeature(feature)
  return { feature, rows, columns: columnsForRows(rows) }
}

/** Groups for every feature from a given source, skipping any that declare nothing at all. */
export function groupsFromCatalog(
  catalog: PermissionFeatureDto[],
  source: 'Host' | 'RemoteApp',
): PermissionGroup[] {
  return catalog
    .filter((f) => f.source === source)
    .map(groupForFeature)
    .filter((g) => g.rows.length > 0)
}

/**
 * Every (featureKey, capability) pair the catalog contains, walked recursively.
 *
 * This is the universe the user-override editor diffs against.
 */
export function allGrantablePairs(
  catalog: PermissionFeatureDto[],
): { featureKey: string; capability: string }[] {
  const pairs: { featureKey: string; capability: string }[] = []
  const seen = new Set<string>()

  const walk = (features: PermissionFeatureDto[]) => {
    for (const f of features) {
      if (f.children && f.children.length > 0) {
        walk(f.children)
      } else {
        for (const cap of f.capabilities) {
          // Dotted business capabilities belong here too. They used to be skipped alongside
          // malformed ones, which meant "grant everything" quietly granted only the verbs — and in
          // the user editor, which diffs against this list, a business capability could never be
          // represented as an override at all.
          if (!isWellFormed(cap)) continue
          const id = `${f.key}:${cap.key}`
          if (!seen.has(id)) {
            seen.add(id)
            pairs.push({ featureKey: f.key, capability: cap.key })
          }
        }
      }
    }
  }

  walk(catalog)
  return pairs
}

/** `featureKey:capability` — the id form used for set membership in the editors. */
export function pairId(featureKey: string, capability: string): string {
  return `${featureKey}:${capability}`
}
