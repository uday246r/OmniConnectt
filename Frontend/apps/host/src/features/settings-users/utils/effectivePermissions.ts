import type { RolePermissionGrantDto } from '../../settings-roles/api/rolesApi'
import type { PermissionOverrideDto } from '../api/usersApi'

/**
 * Merges a role's permission grants with a user's own overrides into the flat
 * "featureKey:Capability" string list that `groupPermissionsByApp`/`PermissionMatrixTable`
 * expect. There is no server endpoint for an arbitrary user's effective permissions today —
 * `ProfilePage.tsx` only ever computes the logged-in user's own (from session data) — so this
 * does the same merge for someone else's role + overrides.
 *
 * Overrides win over role grants: `Grant` adds a capability the role doesn't carry, `Revoke`
 * removes one it does — the only reading that matches those DTO names.
 */
export function computeEffectivePermissions(
  roleGrants: RolePermissionGrantDto[] | undefined,
  overrides: PermissionOverrideDto[] | undefined,
): string[] {
  const key = (featureKey: string, capability: string) => `${featureKey}:${capability}`
  const set = new Set((roleGrants ?? []).map((g) => key(g.featureKey, g.capability)))

  for (const o of overrides ?? []) {
    const k = key(o.featureKey, o.capability)
    if (o.effect === 'Grant') set.add(k)
    else set.delete(k)
  }

  return Array.from(set)
}
