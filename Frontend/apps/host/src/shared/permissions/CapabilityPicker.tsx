import { useId, useMemo, useState } from 'react'
import { useDebouncedValue } from '@omniremit/ui'
import { Icon } from '../components/Icon/Icon'
import { isBusinessCapability, type PermissionRow } from './catalog'
import type { CapabilityDto } from '../api/permissionsApi'
import styles from './CapabilityPicker.module.css'

/**
 * The grantable capabilities a matrix cannot show, in one component used by both permission editors.
 *
 * A CRUD verb is the same handful repeated across every feature, so a matrix with one column per verb
 * is the compact way to show them. A business capability is not: it is declared by exactly one
 * feature, it carries a description worth reading, it has a type that says whether granting it
 * refuses a request or merely hides a control, and there can be dozens of them. Given a column each
 * they would widen the matrix by one nearly-empty column apiece — Lead's dashboard alone declares
 * ten — so they get a grouped, searchable list instead.
 *
 * Both editors render this rather than each growing its own copy. The Role editor and the User
 * override editor were already independent 1100- and 1500-line implementations that shared only the
 * catalog helpers, and the last thing that arrangement needed was a second control to keep in sync.
 */

export interface CapabilityPickerProps {
  /** The same rows the matrix renders. Rows with no business capability are skipped. */
  rows: PermissionRow[]
  /** Whether `{featureKey}:{capability}` is currently granted. */
  isGranted: (featureKey: string, capability: string) => boolean
  /** Flip one grant. Not called when `disabled`. */
  onToggle: (featureKey: string, capability: string) => void
  /**
   * Renders read-only. Used for an administrator role, where every capability is implied and there
   * is nothing to configure — the list still shows so it is clear what the role covers.
   */
  disabled?: boolean
  /** Overrides the empty-state text, which otherwise explains that no app declares any. */
  emptyMessage?: string
}

interface PickerEntry {
  featureKey: string
  featureLabel: string
  capability: CapabilityDto
}

interface PickerGroup {
  /** Stable across renders and unique within the picker: the feature key plus the dotted prefix. */
  id: string
  featureLabel: string
  /** "kpi" from `kpi.total-leads`, title-cased for display. */
  groupLabel: string
  entries: PickerEntry[]
}

/** `kpi` reads better as `KPI`, and `bulk` as `Bulk`. Nothing here is a hardcoded capability name. */
function humanizeGroup(groupKey: string): string {
  if (groupKey.length <= 3) return groupKey.toUpperCase()
  return groupKey.charAt(0).toUpperCase() + groupKey.slice(1)
}

/**
 * The dotted prefix, or `other` when a capability is dotted but the server sent no group.
 *
 * `groupKey` is derived server-side at sync time so every consumer groups identically. Deriving it
 * again here as a fallback covers the window before a remote has re-synced, where the key is dotted
 * but the column is still null.
 */
function groupKeyFor(capability: CapabilityDto): string {
  if (capability.groupKey) return capability.groupKey
  const dot = capability.key.indexOf('.')
  return dot > 0 ? capability.key.slice(0, dot) : 'other'
}

function typeClass(type: string | undefined): string {
  switch (type) {
    case 'Widget':
      return styles.typeWidget
    case 'Chart':
      return styles.typeChart
    case 'Export':
      return styles.typeExport
    case 'BulkAction':
      return styles.typeBulkAction
    case 'Ui':
      return styles.typeUi
    default:
      // Including an unrecognised type from a newer server. Rendered plainly rather than dropped —
      // an administrator seeing an unfamiliar label is better served than one shown nothing.
      return ''
  }
}

/** `BulkAction` reads as `Bulk action`. */
function typeLabel(type: string | undefined): string {
  if (!type) return 'Capability'
  const spaced = type.replace(/([a-z])([A-Z])/g, '$1 $2')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

/*
 * Two bounds on how much of this list is ever in the DOM at once, instead of a virtualisation
 * library.
 *
 * Nothing here needs windowing to feel instant at the sizes that exist today — fifteen capabilities
 * across five groups — but the whole point of the design is that a remote can declare hundreds
 * without anyone changing the host, so it has to hold up at a size nobody has reached yet. Groups
 * past the first threshold start collapsed, so the DOM is a handful of headers; and any one group
 * renders at most a page of rows until asked for the rest. Together those keep the node count flat
 * regardless of catalog size, and cost one dependency less than a windowing library would.
 */
const COLLAPSE_ALL_ABOVE = 40
const ROWS_PER_GROUP = 50

export function CapabilityPicker({
  rows,
  isGranted,
  onToggle,
  disabled = false,
  emptyMessage,
}: CapabilityPickerProps) {
  const searchId = useId()
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string> | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const groups = useMemo<PickerGroup[]>(() => {
    const byId = new Map<string, PickerGroup>()

    for (const row of rows) {
      for (const capability of row.capabilities.filter(isBusinessCapability)) {
        const groupKey = groupKeyFor(capability)
        const id = `${row.key}::${groupKey}`

        let group = byId.get(id)
        if (!group) {
          group = {
            id,
            featureLabel: row.label,
            groupLabel: humanizeGroup(groupKey),
            entries: [],
          }
          byId.set(id, group)
        }

        group.entries.push({ featureKey: row.key, featureLabel: row.label, capability })
      }
    }

    return [...byId.values()]
  }, [rows])

  /*
   * The grouped list below IS this box's recommendation — it narrows to matching capabilities as
   * you type, grouped and tickable, so a floating dropdown over it would cover the very rows it is
   * filtering and offer nothing to pick (you tick a capability here, you do not select a search
   * term). What was missing is the debounce: every keystroke re-filtered and re-grouped the whole
   * catalog. 200ms, the platform's convention for narrowing an already-loaded pool.
   */
  const query = useDebouncedValue(search, 200).trim().toLowerCase()

  /*
   * Filtering keeps a group only if something in it matched, so an empty group header never appears
   * over nothing. Searching the description as well as the label matters: an administrator looking
   * for "who can download the audit trail" will type "download", which appears in no key or label.
   */
  const visibleGroups = useMemo(() => {
    if (!query) return groups

    return groups
      .map((group) => ({
        ...group,
        entries: group.entries.filter(
          (entry) =>
            entry.capability.displayName.toLowerCase().includes(query) ||
            entry.capability.key.toLowerCase().includes(query) ||
            (entry.capability.description ?? '').toLowerCase().includes(query) ||
            entry.featureLabel.toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.entries.length > 0)
  }, [groups, query])

  const totals = useMemo(() => {
    let granted = 0
    let total = 0
    for (const group of groups) {
      for (const entry of group.entries) {
        total += 1
        if (disabled || isGranted(entry.featureKey, entry.capability.key)) granted += 1
      }
    }
    return { granted, total }
  }, [groups, isGranted, disabled])

  if (groups.length === 0) {
    return (
      <p className={styles.empty}>
        {emptyMessage ?? 'No application declares capabilities of this kind yet.'}
      </p>
    )
  }

  /*
   * Null means "the user has not decided yet", which is different from "nothing is collapsed". A
   * small catalog opens expanded because seeing everything is the fastest way to work; a large one
   * opens collapsed because a thousand rows is not a list anyone reads. Once the user touches a
   * header the set becomes explicit and their choices are kept.
   */
  const defaultCollapsed = totals.total > COLLAPSE_ALL_ABOVE
  const isCollapsed = (id: string) => (collapsed === null ? defaultCollapsed : collapsed.has(id))

  const toggleGroup = (id: string) => {
    setCollapsed((prev) => {
      const base = prev ?? new Set(defaultCollapsed ? groups.map((g) => g.id) : [])
      const next = new Set(base)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const revealAll = (id: string) => setExpandedGroups((prev) => new Set(prev).add(id))

  /** A page of rows, unless this group was expanded or a search already narrowed it. */
  const visibleEntries = (group: PickerGroup) =>
    expandedGroups.has(group.id) || query.length > 0
      ? group.entries
      : group.entries.slice(0, ROWS_PER_GROUP)

  const grantedInGroup = (group: PickerGroup) =>
    group.entries.filter((e) => isGranted(e.featureKey, e.capability.key)).length

  return (
    <div className={styles.picker}>
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon} aria-hidden="true">
            <Icon.Search width={14} height={14} />
          </span>
          <input
            id={searchId}
            type="search"
            className={styles.search}
            placeholder="Search capabilities…"
            aria-label="Search capabilities"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className={styles.count}>
          {totals.granted} of {totals.total} selected
        </span>
      </div>

      <div className={styles.scroller}>
        {visibleGroups.length === 0 ? (
          <p className={styles.empty}>No capability matches “{search.trim()}”.</p>
        ) : (
          visibleGroups.map((group) => {
            // While searching, groups stay open regardless of what the user collapsed earlier —
            // hiding a match behind a collapsed header makes the search look broken.
            const isOpen = query.length > 0 || !isCollapsed(group.id)
            const granted = grantedInGroup(group)
            const allGranted = granted === group.entries.length

            return (
              <div key={group.id} className={styles.group}>
                {/*
                 * Two sibling buttons in a row, not one button containing another. Nesting them
                 * produces invalid markup that browsers recover from unpredictably, and it leaves a
                 * keyboard user unable to reach the inner control at all.
                 */}
                <div className={styles.groupHeader}>
                  <button
                    type="button"
                    className={styles.groupExpand}
                    aria-expanded={isOpen}
                    onClick={() => toggleGroup(group.id)}
                  >
                    <span
                      className={`${styles.groupChevron} ${isOpen ? styles.groupChevronOpen : ''}`}
                      aria-hidden="true"
                    >
                      <Icon.ChevronRight width={12} height={12} />
                    </span>
                    <span className={styles.groupLabel}>
                      {group.featureLabel} · {group.groupLabel}
                    </span>
                    <span className={styles.groupCount}>
                      {disabled ? group.entries.length : granted} / {group.entries.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.groupToggleAll}
                    disabled={disabled}
                    onClick={() => {
                      for (const entry of group.entries) {
                        const on = isGranted(entry.featureKey, entry.capability.key)
                        if (on === allGranted) onToggle(entry.featureKey, entry.capability.key)
                      }
                    }}
                  >
                    {allGranted ? 'Clear' : 'All'}
                  </button>
                </div>

                {isOpen && (
                  <div className={styles.rows}>
                    {visibleEntries(group).map((entry) => {
                      const checked = disabled || isGranted(entry.featureKey, entry.capability.key)
                      return (
                        <label
                          key={`${entry.featureKey}:${entry.capability.key}`}
                          className={`${styles.row} ${disabled ? styles.rowDisabled : ''}`}
                        >
                          <input
                            type="checkbox"
                            className={styles.checkbox}
                            checked={checked}
                            disabled={disabled}
                            onChange={() => onToggle(entry.featureKey, entry.capability.key)}
                          />
                          <span className={styles.rowText}>
                            <span className={styles.rowTitleLine}>
                              <span className={styles.rowLabel}>{entry.capability.displayName}</span>
                              <span
                                className={`${styles.typeBadge} ${typeClass(entry.capability.type)}`}
                              >
                                {typeLabel(entry.capability.type)}
                              </span>
                            </span>
                            {entry.capability.description && (
                              <span className={styles.rowDescription}>
                                {entry.capability.description}
                              </span>
                            )}
                            <span className={styles.rowKey}>
                              {entry.featureKey}:{entry.capability.key}
                            </span>
                          </span>
                        </label>
                      )
                    })}
                    {group.entries.length > visibleEntries(group).length && (
                      <button
                        type="button"
                        className={styles.showAll}
                        onClick={() => revealAll(group.id)}
                      >
                        Show all {group.entries.length}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
