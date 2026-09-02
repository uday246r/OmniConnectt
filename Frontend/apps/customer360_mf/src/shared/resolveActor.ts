import { getCurrentUser } from '../api/hostBridge'

/**
 * Turns whatever the audit row stored in `user` into something worth showing a person.
 *
 * WHY THIS IS NEEDED. Customer360Service used to build the actor from the `sub` claim, because
 * `AuditController` read `ClaimTypes.Name` (the long WS-Security URI) while `Program.cs` sets
 * `MapInboundClaims = false`, which keeps the SHORT claim names — so the name never matched and
 * every row fell through to the subject id. That is fixed in the service, but it only affects rows
 * written from now on: every audit record already in the database still literally contains
 * "User 60892301-eded-47ce-be0b-09a5823bc2bc". No frontend change can invent a name for those.
 *
 * What it can do:
 *  - resolve the id when it is the signed-in user's own (the common case when reading your own
 *    trail), via the host bridge;
 *  - otherwise stop pretending the string is a name. A raw id rendered in the bold dark treatment
 *    reserved for people reads as though the system thinks that IS the person's name. Returning it
 *    as `{ name: null, id }` lets the cell show a muted identifier instead.
 */

/** Matches the exact shape the old code wrote: "User <uuid>". */
const LEGACY_ACTOR_ID = /^User\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

export interface ResolvedActor {
  /** A real display name, or null when only an identifier is known. */
  name: string | null
  /** The raw identifier, when the stored value was one. */
  id: string | null
}

export function resolveActor(stored?: string | null): ResolvedActor {
  const value = (stored ?? '').trim()
  if (!value) return { name: null, id: null }

  const match = LEGACY_ACTOR_ID.exec(value)
  if (!match) {
    // Already a name — which is what the service writes now.
    return { name: value, id: null }
  }

  const id = match[1]
  const me = getCurrentUser()
  if (me && me.id && me.id.toLowerCase() === id.toLowerCase() && me.name) {
    return { name: me.name, id }
  }
  return { name: null, id }
}

/** Short form of an id, for a column that cannot afford 36 characters. */
export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}
