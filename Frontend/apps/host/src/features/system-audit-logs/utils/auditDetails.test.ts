import { describe, expect, it } from 'vitest'
import type { PermissionFeatureDto } from '../../../shared/api/permissionsApi'
import { buildPermissionLabels, describePermission, parseAuditDetails } from './auditDetails'

/**
 * Reading an access change in words.
 *
 * A permission change is recorded as a headline plus a JSON list of raw grant keys, and the detail
 * drawer printed both in a code box. The people who review access changes are not the people who
 * read JSON, so these pin that the headline and the list come apart cleanly, that the keys become the
 * platform's own names, and that ordinary details are left exactly as written.
 */

const roleEdit = `Updated role 'Branch Manager' — 1 permission granted, 1 permission revoked

{
  "added": [
    "remote.lead.lead:Create"
  ],
  "removed": [
    "host.settings.users:Delete"
  ]
}`

const catalog = [
  {
    id: '1', key: 'remote.lead', displayName: 'Lead Management', source: 'RemoteApp', sortOrder: 1, capabilities: [],
    children: [
      { id: '2', key: 'remote.lead.lead', displayName: 'Leads', source: 'RemoteApp', sortOrder: 1, capabilities: [{ key: 'Create', displayName: 'Create leads' }], children: [] },
    ],
  },
] as PermissionFeatureDto[]

describe('parseAuditDetails', () => {
  it('separates the headline from the permission list', () => {
    const parsed = parseAuditDetails(roleEdit)

    expect(parsed.headline).toBe("Updated role 'Branch Manager' — 1 permission granted, 1 permission revoked")
    expect(parsed.added).toEqual(['remote.lead.lead:Create'])
    expect(parsed.removed).toEqual(['host.settings.users:Delete'])
    expect(parsed.hasPermissionChanges).toBe(true)
  })

  it('leaves ordinary details untouched, braces and all', () => {
    const text = "Renamed the salutation 'Mr' to 'Mr.' {3 users}"

    expect(parseAuditDetails(text)).toEqual({ headline: text, added: [], removed: [], hasPermissionChanges: false })
    expect(parseAuditDetails('Opened Lead Management → Create Lead.').hasPermissionChanges).toBe(false)
    expect(parseAuditDetails(null).headline).toBe('')
  })
})

describe('describePermission', () => {
  it('uses the platform names, with the app in front of its module', () => {
    expect(describePermission('remote.lead.lead:Create', buildPermissionLabels(catalog))).toBe('Lead Management › Leads: Create leads')
  })

  it('says what an override does to the user', () => {
    expect(describePermission('host.settings.users:Delete (Revoke)')).toBe('Users: Delete (blocked for this user)')
    expect(describePermission('host.settings.users:View (Grant)')).toBe('Users: View (granted to this user)')
  })

  it('still turns an unknown key into words', () => {
    expect(describePermission('host.system.audit-logs:Export')).toBe('Audit Logs: Export')
  })
})
