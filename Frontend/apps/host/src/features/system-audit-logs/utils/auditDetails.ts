import type { PermissionFeatureDto } from '../../../shared/api/permissionsApi'

/**
 * An audit row's `details`, split into what a person reads and what a machine wrote.
 *
 * Permission changes are recorded as a plain headline ("2 permissions granted, 1 permission revoked")
 * followed by a JSON block listing the raw grants (`remote.lead.lead:Create (Grant)`). The detail
 * drawer used to print all of it in a code box — accurate, and unreadable to the people who review
 * access changes. This separates the two so the list can be shown in words.
 */
export interface ParsedAuditDetails {
  headline: string
  added: string[]
  removed: string[]
  /** True when the row carried a permission list at all, even an empty one. */
  hasPermissionChanges: boolean
}

export function parseAuditDetails(details: string | null | undefined): ParsedAuditDetails {
  const text = (details ?? '').trim()
  const empty: ParsedAuditDetails = { headline: text, added: [], removed: [], hasPermissionChanges: false }
  const start = text.indexOf('{')
  if (start < 0 || !text.endsWith('}')) return empty

  try {
    const payload = JSON.parse(text.slice(start)) as { added?: unknown; removed?: unknown }
    const added = Array.isArray(payload.added) ? payload.added.map(String) : null
    const removed = Array.isArray(payload.removed) ? payload.removed.map(String) : null
    if (!added && !removed) return empty

    return {
      headline: text.slice(0, start).trim(),
      added: added ?? [],
      removed: removed ?? [],
      hasPermissionChanges: true,
    }
  } catch {
    // Details that merely contain a brace are ordinary text.
    return empty
  }
}

const RAW_PERMISSION = /^(?<feature>[^:\s]+):(?<capability>[^\s(]+)(?:\s*\((?<effect>[A-Za-z]+)\))?$/

function words(key: string): string {
  return key
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

interface FeatureLabel {
  name: string
  capabilities: Map<string, string>
}

/** Feature and capability display names from the catalog, children named under their app. */
export function buildPermissionLabels(catalog: PermissionFeatureDto[]): Map<string, FeatureLabel> {
  const labels = new Map<string, FeatureLabel>()
  const visit = (feature: PermissionFeatureDto, parentName: string | null) => {
    const name = parentName ? `${parentName} › ${feature.displayName}` : feature.displayName
    labels.set(feature.key.toLowerCase(), {
      name,
      capabilities: new Map(feature.capabilities.map((c) => [c.key.toLowerCase(), c.displayName])),
    })
    for (const child of feature.children ?? []) visit(child, feature.displayName)
  }
  for (const feature of catalog) visit(feature, null)
  return labels
}

/**
 * "remote.lead.lead:Create (Grant)" → "Lead Management › Leads: Create (granted to this user)".
 *
 * Uses the platform's own names when the catalog is available, and otherwise turns the key into words
 * ("host.settings.users:View" → "Users: View") rather than showing it raw.
 */
export function describePermission(raw: string, labels?: Map<string, FeatureLabel>): string {
  const match = RAW_PERMISSION.exec(raw.trim())
  if (!match?.groups) return raw

  const { feature, capability, effect } = match.groups
  const known = labels?.get(feature.toLowerCase())
  const featureName = known?.name ?? words(feature.slice(feature.lastIndexOf('.') + 1))
  const capabilityName = known?.capabilities.get(capability.toLowerCase()) ?? words(capability)

  const suffix =
    effect?.toLowerCase() === 'revoke'
      ? ' (blocked for this user)'
      : effect?.toLowerCase() === 'grant'
        ? ' (granted to this user)'
        : ''
  return `${featureName}: ${capabilityName}${suffix}`
}
