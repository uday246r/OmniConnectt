import { EMPTY_VALUE } from './formatDate'

/**
 * Particles that are part of a Malay/Indian name's structure rather than a name in their own
 * right. "Nurul Aisyah binti Abdullah" should initialise as NA, not NB.
 */
const NAME_PARTICLES = new Set([
  'bin', 'binti', 'bt', 'bte', 'a/l', 'a/p', 'al', 'ap',
  'van', 'von', 'de', 'del', 'da', 'di', 'du', 'la', 'le',
])

export interface GetInitialsOptions {
  /** Used when there is no usable name — the host's user lists fall back to the email. */
  email?: string | null
  /** Shown when neither a name nor an email yields anything. Defaults to the em dash. */
  fallback?: string
}

/**
 * Two-letter initials for an avatar tile.
 *
 * THERE WERE SIX OF THESE, and they disagreed. "Lee Sook Fern" initialised as **LS** in
 * RecentLeadsCard (first + second word) and **LF** in LeadDetailsDrawer (first + last word) — the
 * same person, two avatars, in the same app. Two host copies ignored name particles entirely, so
 * "Nurul Aisyah binti Abdullah" came out as NB there and NA in the remotes. customer360 returned a
 * hyphen where the others returned "??" or "U".
 *
 * One rule now: drop the particles, then take the FIRST and LAST remaining words. First+last is the
 * convention people expect from an avatar, and it stays stable when a middle name is present in one
 * data source and absent in another — which is exactly the case across CRM and the lead store.
 */
export function getInitials(name?: string | null, options: GetInitialsOptions = {}): string {
  const { email, fallback = EMPTY_VALUE } = options

  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter((w) => w && !NAME_PARTICLES.has(w.toLowerCase()))

  if (words.length >= 2) {
    return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase()
  }

  const mail = (email ?? '').trim()
  if (mail) return mail.slice(0, 2).toUpperCase()

  return fallback
}
