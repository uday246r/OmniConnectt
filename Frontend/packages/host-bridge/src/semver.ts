/**
 * The part of npm's SemVer range language the platform uses for host-bridge compatibility: `^1.2.0`,
 * `~1.2.0`, `1.2.0`, `=1.2.0`, `>=1.2.0`, `<2.0.0`, `1.x`, `*`, and space-separated conjunctions.
 *
 * The browser twin of AuthService's SemVerRange.cs. Both run
 * `__fixtures__/semver-parity.json`, so the server (which refuses to promote) and the host (which
 * refuses to mount) can never disagree. A malformed version or range is never satisfied — an
 * unreadable compatibility claim must not be read as "compatible".
 */

type Version = [major: number, minor: number, patch: number]

const VERSION = /^v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:[-+].*)?$/

function parse(text: string): { version: Version; specified: number } | null {
  const match = VERSION.exec(text.trim())
  if (!match) return null
  const part = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null)
  const major = part(match[1])
  const minor = part(match[2])
  const patch = part(match[3])
  if (major === null) return null
  return {
    version: [major, minor ?? 0, patch ?? 0],
    specified: minor === null ? 1 : patch === null ? 2 : 3,
  }
}

function compare(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

function satisfiesOne(v: Version, comparator: string): boolean {
  if (comparator === '*' || comparator === 'x' || comparator === 'X') return true

  let op = ''
  let rest = comparator
  if (comparator.startsWith('>=') || comparator.startsWith('<=')) {
    op = comparator.slice(0, 2)
    rest = comparator.slice(2)
  } else if ('^~><='.includes(comparator[0])) {
    op = comparator[0]
    rest = comparator.slice(1)
  }

  const parsed = parse(rest)
  if (!parsed) return false
  const { version: b, specified } = parsed
  const cmp = compare(v, b)

  switch (op) {
    case '>=':
      return cmp >= 0
    case '<=':
      return cmp <= 0
    case '>':
      return cmp > 0
    case '<':
      return cmp < 0
    case '^':
      // The left-most non-zero component (or the last one given) may not change.
      if (cmp < 0) return false
      if (b[0] > 0 || specified === 1) return v[0] === b[0]
      if (b[1] > 0 || specified === 2) return v[0] === 0 && v[1] === b[1]
      return v[0] === 0 && v[1] === 0 && v[2] === b[2]
    case '~':
      return cmp >= 0 && v[0] === b[0] && (specified < 2 || v[1] === b[1])
    default:
      // Bare or "=": a partial version matches everything it leaves open.
      if (specified === 1) return v[0] === b[0]
      if (specified === 2) return v[0] === b[0] && v[1] === b[1]
      return cmp === 0
  }
}

/** True when `version` satisfies `range`. */
export function satisfies(version: string, range: string): boolean {
  const parsed = parse(version)
  if (!parsed) return false
  const parts = range.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return false
  return parts.every((part) => satisfiesOne(parsed.version, part))
}
