import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuthStore } from '../../auth/store/authStore'
import { Badge, type BadgeTone } from '../../../shared/components/Badge/Badge'
import { SkeletonBlock } from '../../../shared/components/Skeleton'
import { ApiError } from '../../../shared/api/httpClient'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue'
import {
  approvalsApi,
  type ApprovalRequestListItemDto,
  type ApprovalRequestDetailDto,
  type ApprovalSummaryDto,
  type ApprovalStatus,
} from '../api/approvalsApi'
import { checkerAssignmentsApi, type AssignableModuleDto } from '../api/checkerAssignmentsApi'
import { useApprovalRequests } from '../hooks/useApprovalRequests'
import { Icon } from '../../../shared/components/Icon/Icon'
// Same drawer shell Audit Logs / Settings use — the whole point of "keep the design language" is
// not building a fourth right-side-panel implementation.
import drawerStyles from '../../../layout/SettingsDrawer/SettingsDrawer.module.css'
import styles from './ApprovalCenterPage.module.css'
import { TOPICS, invalidate, useDataRevision } from '../../../shared/stores/invalidationStore'

const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = [5, 10, 15, 20] as const

const STATUS_TONES: Record<ApprovalStatus, BadgeTone> = {
  Pending: 'warning',
  Approved: 'success',
  Rejected: 'danger',
}

const ACTION_LABELS: Record<string, string> = {
  Create: 'Create',
  Update: 'Update',
  Delete: 'Delete',
  Enable: 'Enable',
  Disable: 'Disable',
}

/** The Overview row's Action icon shown a generic pencil regardless of the actual action — a
 * Delete request looked identical to an Update one. Shape now matches the real action. */
const ACTION_ICONS: Record<string, typeof Icon.User> = {
  Create: Icon.Plus,
  Update: Icon.Edit,
  Delete: Icon.Trash,
  Enable: Icon.CheckCircle,
  Disable: Icon.X,
}

/** Why the "Requested Change" section has nothing to show — was a single static "No change
 * payload recorded." for every action, which read as a technical error even for a Delete request,
 * where having no "after" state is the entirely expected, correct outcome. */
function requestedChangeEmptyMessage(action: string): string {
  if (action === 'Delete') return 'No new data — this record is being deleted, not changed.'
  return 'No change details available for this request.'
}

const SHORT_MODULE_MAP: Record<string, string> = {
  'host.settings.users': 'User',
  'settings.users': 'User',
  'setup-user': 'User',
  'setup-users': 'User',
  'setup_user': 'User',
  'setup_users': 'User',
  'users': 'User',
  'user': 'User',
  'user management': 'User',
  'host.settings.roles': 'Role',
  'settings.roles': 'Role',
  'setup-role': 'Role',
  'setup-roles': 'Role',
  'setup_role': 'Role',
  'setup_roles': 'Role',
  'roles': 'Role',
  'role': 'Role',
  'roles & permissions': 'Role',
  'host.settings.applications': 'App',
  'settings.applications': 'App',
  'setup-application': 'App',
  'setup-applications': 'App',
  'applications': 'App',
  'application': 'App',
  'apps': 'App',
  'app': 'App',
  'host.settings.fields': 'Field',
  'settings.fields': 'Field',
  'setup-field': 'Field',
  'fields': 'Field',
  'field': 'Field',
  'host.settings.security': 'Security',
  'settings.security': 'Security',
  'security': 'Security',
  'host.settings.audit': 'Audit',
  'settings.audit': 'Audit',
  'audit': 'Audit',
  'audit.logs': 'Audit',
  'system.audit': 'Audit',
  'lead.management': 'Lead',
  'lead_management': 'Lead',
  'lead': 'Lead',
  'leads': 'Lead',
  'setup-lead': 'Lead',
  'setup_lead': 'Lead',
  'remittance': 'Remittance',
  'remittance.transactions': 'Transaction',
  'transactions': 'Transaction',
  'transaction': 'Transaction',
  'checker.assignments': 'Checker',
  'checker': 'Checker',
}

function formatModuleName(rawModule: string | null | undefined, _customMap?: Map<string, string>): string {
  if (!rawModule) return '—'
  const normalized = rawModule.toLowerCase().trim()
  if (SHORT_MODULE_MAP[normalized]) return SHORT_MODULE_MAP[normalized]
  
  let cleaned = rawModule
    .replace(/^host\.settings\./i, '')
    .replace(/^settings\./i, '')
    .replace(/^setup[-_]/i, '')

  if (cleaned.includes('.')) {
    const parts = cleaned.split('.').filter(Boolean)
    cleaned = parts[parts.length - 1] ?? cleaned
  }

  cleaned = cleaned.replace(/[-_]management$/i, '').replace(/[-_]settings$/i, '')
  const result = humanizeKey(cleaned.replace(/[-_]/g, ' ')).trim()
  return SHORT_MODULE_MAP[result.toLowerCase()] ?? result
}

function formatDateOnly(iso: string | null | undefined) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Splits a PascalCase/camelCase key into readable words — "PhoneNumber" -> "Phone Number". */
function humanizeKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

/**
 * Pretty-prints a JSON snapshot as a key/value list, falling back to raw text if it isn't valid JSON.
 *
 * Generic XId/XName convention: any key ending in "Id" (e.g. "RoleId") is paired with a sibling
 * "XName" key (e.g. "RoleName") in the SAME object, if one exists — the raw id is hidden and a single
 * friendly row ("Role: Tech Lead") renders in its place. No module gets special-cased by name here;
 * any backend snapshot that wants a friendly display just needs to include that sibling field. Falls
 * back to the raw id when no sibling is present, so older/other snapshots degrade gracefully instead
 * of breaking. "Overrides" is always excluded — it gets its own dedicated Permission Changes section.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A snapshot's per-field row list, given an already-parsed flat object. Shared by renderDataFields
 * (top-level object snapshots, e.g. Users/Roles) and renderArrayItemRows (each element of an array
 * snapshot, e.g. Field Settings' array of field-config rows) so both go through the same
 * XId/XName-collapsing + humanizing + value-formatting logic. */
function objectToRows(parsed: Record<string, unknown>): { label: string; value: unknown }[] {
  const keys = Object.keys(parsed)
  const nameSiblingOf = new Set(
    keys.filter((k) => /Id$/.test(k) && keys.includes(`${k.slice(0, -2)}Name`)),
  )
  const consumedNameKeys = new Set([...nameSiblingOf].map((k) => `${k.slice(0, -2)}Name`))

  const rows: { label: string; value: unknown }[] = []
  for (const key of keys) {
    const lower = key.toLowerCase()
    if (lower === 'permissions' || lower === 'overrides' || lower === 'id') continue
    if (consumedNameKeys.has(key)) continue // shown via its XId row instead
    if (nameSiblingOf.has(key)) {
      rows.push({ label: humanizeKey(key.slice(0, -2)), value: parsed[`${key.slice(0, -2)}Name`] })
    } else {
      rows.push({ label: humanizeKey(key), value: parsed[key] })
    }
  }
  return rows
}

/**
 * Formats a single field's value for display. Was a bare `String(value)` — harmless for the
 * strings/numbers every OTHER module's snapshot happens to store, but a boolean read as "true"/
 * "false" instead of "Yes"/"No", and — the actual reported bug — a nested object or array (as in a
 * Field Settings row's own sub-values) stringified to the literal, meaningless text "[object Object]".
 */
function renderValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    if (value.every((item) => !isPlainObject(item))) return value.map((item) => String(item)).join(', ')
    return (
      <div className={styles.nestedRows}>
        {value.map((item, i) => (
          <div key={i} className={styles.nestedRow}>
            {isPlainObject(item) ? renderRowList(objectToRows(item)) : String(item)}
          </div>
        ))}
      </div>
    )
  }
  if (isPlainObject(value)) return renderRowList(objectToRows(value))
  return String(value)
}

function renderRowList(rows: { label: string; value: unknown }[]) {
  if (rows.length === 0) return null
  return (
    <dl className={styles.dataFieldList}>
      {rows.map(({ label, value }) => {
        const isEmpty = value === null || value === undefined || value === ''
        return (
          <div key={label} className={styles.dataFieldRow}>
            <dt>{label}</dt>
            <dd className={isEmpty ? styles.emptyValue : undefined}>{renderValue(value)}</dd>
          </div>
        )
      })}
    </dl>
  )
}

/**
 * Picks an icon + tint for a field card, matched by keyword against the field's (already humanized)
 * label. This component renders snapshots from ANY module (Users, Roles, Applications, Field
 * Settings, ...), so field names are dynamic — a fixed per-field-name icon map can't cover every
 * possible field, and guessing wrong would be misleading. Common, recognizable concepts get a
 * real matching icon; anything unrecognized falls back to a neutral document icon rather than a
 * forced, potentially-wrong guess.
 */
const FIELD_ICON_RULES: { test: RegExp; Icon: typeof Icon.User; bg: string; color: string }[] = [
  { test: /email/i, Icon: Icon.Mail, bg: '#eff6ff', color: '#2563eb' },
  { test: /phone|mobile|contact/i, Icon: Icon.Headset, bg: '#ecfeff', color: '#0891b2' },
  { test: /name/i, Icon: Icon.User, bg: '#eff6ff', color: '#2563eb' },
  { test: /role/i, Icon: Icon.Shield, bg: '#f5f3ff', color: '#7c3aed' },
  { test: /(active|status|enabled?|disabled?)/i, Icon: Icon.CheckCircle, bg: '#ecfdf5', color: '#059669' },
  { test: /(auth|password|provider|key|secret)/i, Icon: Icon.Key, bg: '#fff7ed', color: '#d97706' },
  { test: /(date|time)$/i, Icon: Icon.Calendar, bg: '#eff6ff', color: '#2563eb' },
]
const DEFAULT_FIELD_ICON = { Icon: Icon.FileText, bg: '#f8fafc', color: '#64748b' }

function getFieldIconMeta(label: string) {
  return FIELD_ICON_RULES.find((r) => r.test.test(label)) ?? DEFAULT_FIELD_ICON
}

/** Top-level Before/Requested-Change fields as a 2-per-row grid of bordered cards — was a plain
 * label/value list (still is, via renderRowList, for nested/array-item content) which read as flat
 * and unstructured next to the rest of the app's card-based presentation. Card visual language
 * (border/radius/background/hover) copied verbatim from ProfilePage.module.css's
 * .capabilitiesGrid/.capItem, the app's own existing 2-per-row bordered-card convention. */
function renderFieldCardGrid(rows: { label: string; value: unknown }[]) {
  if (rows.length === 0) return null
  return (
    <dl className={styles.fieldCardGrid}>
      {rows.map(({ label, value }) => {
        const isEmpty = value === null || value === undefined || value === ''
        const { Icon: FieldIcon, bg, color } = getFieldIconMeta(label)
        return (
          <div key={label} className={styles.fieldCard}>
            <span className={styles.fieldCardIcon} style={{ background: bg, color }}>
              <FieldIcon width={15} height={15} />
            </span>
            <div className={styles.fieldCardBody}>
              <dt className={styles.fieldCardLabel}>{label}</dt>
              <dd className={`${styles.fieldCardValue} ${isEmpty ? styles.emptyValue : ''}`}>
                {renderValue(value)}
              </dd>
            </div>
          </div>
        )
      })}
    </dl>
  )
}

/** One array-snapshot element (e.g. a single field-config row) as a labeled mini-card — its own
 * name/label picked from whichever of these properties it actually has, then its remaining fields
 * rendered as a compact row list underneath. */
function renderArrayItem(item: unknown, index: number) {
  if (!isPlainObject(item)) {
    return <div className={styles.arrayItemCard}>{String(item)}</div>
  }
  const labelKeys = ['displayLabel', 'DisplayLabel', 'name', 'Name', 'label', 'Label', 'apiField', 'ApiField', 'key', 'Key']
  const heading = labelKeys.map((k) => item[k]).find((v): v is string => typeof v === 'string' && v.trim() !== '') ?? `Item ${index + 1}`
  const rows = objectToRows(item).filter(({ label }) => !labelKeys.some((k) => humanizeKey(k) === label))
  return (
    <div className={styles.arrayItemCard}>
      <div className={styles.arrayItemHeading}>{heading}</div>
      {renderRowList(rows)}
    </div>
  )
}

/**
 * Pretty-prints a JSON snapshot as a key/value list, falling back to raw text if it isn't valid JSON.
 *
 * Generic XId/XName convention: any key ending in "Id" (e.g. "RoleId") is paired with a sibling
 * "XName" key (e.g. "RoleName") in the SAME object, if one exists — the raw id is hidden and a single
 * friendly row ("Role: Tech Lead") renders in its place. No module gets special-cased by name here;
 * any backend snapshot that wants a friendly display just needs to include that sibling field. Falls
 * back to the raw id when no sibling is present, so older/other snapshots degrade gracefully instead
 * of breaking. "Overrides" is always excluded — it gets its own dedicated Permission Changes section.
 *
 * Field Settings (and any future module) can snapshot an ARRAY of records instead of one flat object
 * — this used to render as literal "0 [object Object]", "1 [object Object]" rows (Object.keys() on an
 * array yields its indices, and a raw object stringifies to that exact text). Each element now renders
 * as its own labeled mini-card instead.
 */
function renderDataFields(json: string | null, emptyLabel: string) {
  if (!json) return <p className={styles.mutedText}>{emptyLabel}</p>
  try {
    const parsed = JSON.parse(json) as unknown

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return <p className={styles.mutedText}>{emptyLabel}</p>
      return (
        <div className={styles.arrayItemList}>
          {parsed.map((item, i) => <div key={i}>{renderArrayItem(item, i)}</div>)}
        </div>
      )
    }

    const rows = isPlainObject(parsed) ? objectToRows(parsed) : []
    if (rows.length === 0) return <p className={styles.mutedText}>{emptyLabel}</p>
    return renderFieldCardGrid(rows)
  } catch {
    return <p className={styles.wrapText}>{json}</p>
  }
}

interface OverrideEntry {
  featureKey: string
  capability: string
  effect: string
}

/** Extracts the Overrides array from a snapshot's JSON — tolerant of both the PascalCase shape the
 * backend actually stores ("Overrides"/"FeatureKey") and a lowercase fallback. Returns null (distinct
 * from an empty array) when the key is absent/JSON-null, meaning this mutation never touched overrides
 * at all — as opposed to an explicit empty array, which means "set to zero overrides." Collapsing that
 * distinction here would make an ordinary core-field-only edit look like it wipes every permission. */
function extractOverrides(json: string | null): OverrideEntry[] | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    const raw = (parsed.Overrides ?? parsed.overrides) as unknown
    if (raw == null || !Array.isArray(raw)) return null
    return raw.map((o: any) => ({
      featureKey: o.FeatureKey ?? o.featureKey,
      capability: o.Capability ?? o.capability,
      effect: o.Effect ?? o.effect,
    }))
  } catch {
    return null
  }
}

function overrideKey(o: OverrideEntry) {
  return `${o.featureKey}::${o.capability}`
}

/** Diffs the old vs new Overrides arrays for a Permission Changes section — added, removed, or
 * changed-effect grants. Null when the new snapshot never touched overrides at all (every module besides
 * Users today, or a Users edit that only changed core fields), so this section simply doesn't render
 * rather than showing a misleading "everything removed" box. */
function diffOverrides(oldJson: string | null, newJson: string | null) {
  const newOverrides = extractOverrides(newJson)
  if (newOverrides === null) return null
  const oldOverrides = extractOverrides(oldJson) ?? []

  const oldMap = new Map(oldOverrides.map((o) => [overrideKey(o), o]))
  const newMap = new Map(newOverrides.map((o) => [overrideKey(o), o]))

  const added: OverrideEntry[] = []
  const removed: OverrideEntry[] = []
  const changed: { key: string; from: OverrideEntry; to: OverrideEntry }[] = []

  for (const [key, entry] of newMap) {
    const prior = oldMap.get(key)
    if (!prior) added.push(entry)
    else if (prior.effect !== entry.effect) changed.push({ key, from: prior, to: entry })
  }
  for (const [key, entry] of oldMap) {
    if (!newMap.has(key)) removed.push(entry)
  }

  if (added.length === 0 && removed.length === 0 && changed.length === 0) return { unchanged: true as const }
  return { unchanged: false as const, added, removed, changed }
}

const TAB_IDS = { pending: 'pending', processed: 'processed', all: 'all' } as const
type TabId = (typeof TAB_IDS)[keyof typeof TAB_IDS]
const TAB_STATUS_FILTER: Record<TabId, ApprovalStatus | undefined> = {
  [TAB_IDS.pending]: 'Pending',
  [TAB_IDS.processed]: undefined, // handled specially (Approved OR Rejected)
  [TAB_IDS.all]: undefined,
}

type DateFilterMode = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'

const DATE_RANGES: { key: DateFilterMode; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'Last 7 Days' },
  { key: 'month', label: 'Last 30 Days' },
]

function computeRangeWithCustom(preset: DateFilterMode, customFrom?: string, customTo?: string): { from?: string; to?: string } {
  if (preset === 'custom') {
    return {
      from: customFrom ? new Date(customFrom + 'T00:00:00.000Z').toISOString() : undefined,
      to: customTo ? new Date(customTo + 'T23:59:59.999Z').toISOString() : undefined,
    }
  }
  const now = new Date()
  switch (preset) {
    case 'today': {
      const start = new Date(now)
      start.setHours(0, 0, 0, 0)
      return { from: start.toISOString() }
    }
    case 'yesterday': {
      const start = new Date(now)
      start.setDate(start.getDate() - 1)
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setHours(23, 59, 59, 999)
      return { from: start.toISOString(), to: end.toISOString() }
    }
    case 'week': {
      const start = new Date(now)
      start.setDate(start.getDate() - 7)
      return { from: start.toISOString() }
    }
    case 'month': {
      const start = new Date(now)
      start.setDate(start.getDate() - 30)
      return { from: start.toISOString() }
    }
    default:
      return {}
  }
}

function matchesDateRange(dateStr: string | null | undefined, preset: DateFilterMode, customFrom?: string, customTo?: string): boolean {
  if (preset === 'all') return true
  if (!dateStr) return false
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return false

  if (preset === 'custom') {
    if (customFrom && d < new Date(customFrom + 'T00:00:00.000Z')) return false
    if (customTo && d > new Date(customTo + 'T23:59:59.999Z')) return false
    return true
  }
  const now = new Date()
  if (preset === 'today') {
    return d.toDateString() === now.toDateString()
  }
  if (preset === 'yesterday') {
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    return d.toDateString() === y.toDateString()
  }
  if (preset === 'week') {
    const w = new Date(now)
    w.setDate(w.getDate() - 7)
    return d >= w
  }
  if (preset === 'month') {
    const m = new Date(now)
    m.setDate(m.getDate() - 30)
    return d >= m
  }
  return true
}

/**
 * The centralized Approval Center — one source of truth across the whole platform (Phase 1: Users and
 * Roles; every future gated module lands in this same table, same page, no separate flow per module).
 */
export function ApprovalCenterPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const currentUserId = useAuthStore((s) => s.user?.id)

  const [activeTab, setActiveTab] = useState<TabId>(TAB_IDS.pending)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [isCustomPageSize, setIsCustomPageSize] = useState(false)
  const [customPageSizeInput, setCustomPageSizeInput] = useState('')
  const [activeHeaderFilter, setActiveHeaderFilter] = useState<string | null>(null)

  // Requested date filter
  const [dateRange, setDateRange] = useState<DateFilterMode>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [customDraftFrom, setCustomDraftFrom] = useState('')
  const [customDraftTo, setCustomDraftTo] = useState('')

  // Decided date filter
  const [decidedRange, setDecidedRange] = useState<DateFilterMode>('all')
  const [decidedCustomFrom, setDecidedCustomFrom] = useState('')
  const [decidedCustomTo, setDecidedCustomTo] = useState('')
  const [decidedDraftFrom, setDecidedDraftFrom] = useState('')
  const [decidedDraftTo, setDecidedDraftTo] = useState('')

  // Module filter with live search
  const [module, setModule] = useState('')
  const [moduleSearch, setModuleSearch] = useState('')
  const [modules, setModules] = useState<AssignableModuleDto[]>([])

  // Action filter
  const [actionFilter, setActionFilter] = useState('')

  // Entity search
  const [entitySearch, setEntitySearch] = useState('')

  // Maker search & user selection
  const [makerSearch, setMakerSearch] = useState('')

  // Checker search & user selection & assigned to me
  const [checkerSearch, setCheckerSearch] = useState('')
  const [assignedToMeOnly, setAssignedToMeOnly] = useState(false)

  // Status filter ('Pending' | 'Approved' | 'Rejected' | '')
  const [statusFilter, setStatusFilter] = useState<'' | 'Pending' | 'Approved' | 'Rejected'>('')

  // In-memory cache pool to derive unique makers, checkers, and modules with 0 extra API calls
  const [cachedPool, setCachedPool] = useState<ApprovalRequestListItemDto[]>([])

  const debouncedMaker = useDebouncedValue(makerSearch, 200)
  const debouncedEntity = useDebouncedValue(entitySearch, 200)
  const debouncedChecker = useDebouncedValue(checkerSearch, 200)

  const range = useMemo(() => computeRangeWithCustom(dateRange, customFrom, customTo), [dateRange, customFrom, customTo])
  const moduleLabelsByKey = useMemo(() => new Map(modules.map((m) => [m.key, m.label])), [modules])

  // Zero extra API call: extract unique makers from all loaded items
  const availableMakers = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    for (const r of cachedPool) {
      if (r.makerName) map.set(r.makerName.toLowerCase(), { id: r.makerId, name: r.makerName })
    }
    return Array.from(map.values())
  }, [cachedPool])

  // Zero extra API call: extract unique checkers from all loaded items
  const availableCheckers = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    for (const r of cachedPool) {
      if (r.checkerName) map.set(r.checkerName.toLowerCase(), { id: r.checkerId, name: r.checkerName })
    }
    return Array.from(map.values())
  }, [cachedPool])

  // Zero extra API call: combine API modules + modules found in data
  const availableModules = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of modules) map.set(m.key, formatModuleName(m.key || m.label))
    for (const r of cachedPool) {
      if (r.module && !map.has(r.module)) {
        map.set(r.module, formatModuleName(r.module))
      }
    }
    const list = Array.from(map.entries()).map(([key, label]) => ({ key, label }))
    if (!moduleSearch.trim()) return list
    const q = moduleSearch.toLowerCase()
    return list.filter((m) => m.label.toLowerCase().includes(q) || m.key.toLowerCase().includes(q))
  }, [modules, cachedPool, moduleSearch])

  const [summary, setSummary] = useState<ApprovalSummaryDto | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  // Invalidated whenever a Settings-drawer mutation (users/roles/applications/checker
  // assignments) happens elsewhere, so this list doesn't go stale without a manual reload —
  // mirrors MyRequestsPage's identical use of the same signal.
  const dataRevision = useDataRevision(TOPICS.approvals)

  const [viewingId, setViewingId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ApprovalRequestDetailDto | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest(`.${styles.filterPopover}`) && !target.closest(`.${styles.thFilterBtn}`)) {
        setActiveHeaderFilter(null)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setActiveHeaderFilter(null)
    }
    if (activeHeaderFilter) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeHeaderFilter])

  const loadSummary = useCallback(async () => {
    if (!accessToken) return
    try {
      setSummary(await approvalsApi.summary(accessToken))
    } catch {
    }
  }, [accessToken])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    checkerAssignmentsApi
      .listModules(accessToken)
      .then((res) => {
        if (!cancelled) setModules(res)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [accessToken])

  const fetcher = useCallback(
    async (token: string) => {
      let allItems: ApprovalRequestListItemDto[] = []

      // If statusFilter is explicitly set to 'Approved' or 'Rejected', query that directly:
      const effectiveStatus = statusFilter || TAB_STATUS_FILTER[activeTab]

      if (effectiveStatus === 'Approved') {
        const res = await approvalsApi.list(token, {
          page: 1, pageSize: 200, module: module || undefined, status: 'Approved',
          assignedToMe: assignedToMeOnly || undefined, from: range.from, to: range.to,
        })
        allItems = res.items
      } else if (effectiveStatus === 'Rejected') {
        const res = await approvalsApi.list(token, {
          page: 1, pageSize: 200, module: module || undefined, status: 'Rejected',
          assignedToMe: assignedToMeOnly || undefined, from: range.from, to: range.to,
        })
        allItems = res.items
      } else if (activeTab === TAB_IDS.processed && !statusFilter) {
        const [approved, rejected] = await Promise.all([
          approvalsApi.list(token, {
            page: 1, pageSize: 200, module: module || undefined, status: 'Approved',
            assignedToMe: assignedToMeOnly || undefined, from: range.from, to: range.to,
          }),
          approvalsApi.list(token, {
            page: 1, pageSize: 200, module: module || undefined, status: 'Rejected',
            assignedToMe: assignedToMeOnly || undefined, from: range.from, to: range.to,
          }),
        ])
        allItems = [...approved.items, ...rejected.items].sort(
          (a, b) => new Date(b.decidedAt ?? b.requestedAt).getTime() - new Date(a.decidedAt ?? a.requestedAt).getTime(),
        )
      } else {
        const res = await approvalsApi.list(token, {
          page: 1, pageSize: 200, module: module || undefined,
          status: effectiveStatus,
          assignedToMe: assignedToMeOnly || undefined,
          from: range.from, to: range.to,
        })
        allItems = res.items
      }

      // Merge into in-memory cache pool so unique makers, checkers, and modules are always up to date
      setCachedPool((prev) => {
        const map = new Map<string, ApprovalRequestListItemDto>()
        for (const item of prev) map.set(item.id, item)
        for (const item of allItems) map.set(item.id, item)
        return Array.from(map.values())
      })

      // Client-side precision filtering
      if (statusFilter) {
        allItems = allItems.filter((r) => r.status === statusFilter)
      }
      if (assignedToMeOnly && currentUserId) {
        allItems = allItems.filter((r) => r.checkerId === currentUserId)
      }
      if (actionFilter) {
        allItems = allItems.filter((r) => r.action === actionFilter)
      }
      if (debouncedMaker) {
        allItems = allItems.filter((r) => r.makerName?.toLowerCase().includes(debouncedMaker.toLowerCase()))
      }
      if (debouncedChecker) {
        allItems = allItems.filter((r) => r.checkerName?.toLowerCase().includes(debouncedChecker.toLowerCase()))
      }
      if (debouncedEntity) {
        allItems = allItems.filter((r) => r.entityLabel?.toLowerCase().includes(debouncedEntity.toLowerCase()))
      }
      if (decidedRange !== 'all') {
        allItems = allItems.filter((r) => matchesDateRange(r.decidedAt, decidedRange, decidedCustomFrom, decidedCustomTo))
      }

      const totalCount = allItems.length
      const start = (page - 1) * pageSize
      return { items: allItems.slice(start, start + pageSize), total: totalCount }
    },
    [
      activeTab, page, pageSize, module, actionFilter, assignedToMeOnly,
      debouncedMaker, debouncedEntity, debouncedChecker, statusFilter,
      range.from, range.to, decidedRange, decidedCustomFrom, decidedCustomTo, currentUserId,
    ],
  )
  const { items, total, error } = useApprovalRequests(accessToken, fetcher, [
    activeTab, page, pageSize, module, actionFilter, assignedToMeOnly,
    debouncedMaker, debouncedEntity, debouncedChecker, statusFilter,
    refreshKey, range.from, range.to, decidedRange, decidedCustomFrom, decidedCustomTo, dataRevision,
  ])

  // Handler for the page-size preset or custom selection
  function handlePageSizeSelect(value: string) {
    if (value === 'custom') {
      setIsCustomPageSize(true)
      setCustomPageSizeInput(String(pageSize))
    } else {
      const size = Number(value)
      setIsCustomPageSize(false)
      setCustomPageSizeInput('')
      setPageSize(size)
      setPage(1)
    }
  }

  function handleCustomPageSizeChange(val: string) {
    setCustomPageSizeInput(val)
    const parsed = parseInt(val, 10)
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 500) {
      setPageSize(parsed)
      setPage(1)
    }
  }

  useEffect(() => {
    setPage(1)
  }, [
    activeTab, module, actionFilter, assignedToMeOnly,
    debouncedMaker, debouncedEntity, debouncedChecker, statusFilter,
    dateRange, customFrom, customTo, decidedRange, decidedCustomFrom, decidedCustomTo,
    pageSize,
  ])

  useEffect(() => {
    if (!viewingId || !accessToken) return
    let cancelled = false
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    setRejectReason('')

    approvalsApi
      .get(accessToken, viewingId)
      .then((res) => {
        if (!cancelled) setDetail(res)
      })
      .catch((err) => {
        if (!cancelled) setDetailError(err instanceof ApiError ? err.message : 'Could not load this request.')
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [viewingId, accessToken])

  const isMyDecisionToMake = Boolean(detail && currentUserId && detail.checkerId === currentUserId && detail.status === 'Pending')

  async function handleApprove() {
    if (!detail || !accessToken) return
    setDeciding(true)
    setDetailError(null)
    try {
      const updated = await approvalsApi.approve(accessToken, detail.id)
      setDetail(updated)
      setRefreshKey((k) => k + 1)
      void loadSummary()
      invalidate()
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : 'Could not approve this request.')
    } finally {
      setDeciding(false)
    }
  }

  async function handleReject() {
    if (!detail || !accessToken || !rejectReason.trim()) return
    setDeciding(true)
    setDetailError(null)
    try {
      const updated = await approvalsApi.reject(accessToken, detail.id, rejectReason.trim())
      setDetail(updated)
      setRejecting(false)
      setRefreshKey((k) => k + 1)
      void loadSummary()
      invalidate()
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : 'Could not reject this request.')
    } finally {
      setDeciding(false)
    }
  }

  const totalPages = total !== null ? Math.max(1, Math.ceil(total / pageSize)) : 1

  function handleRowClick(r: ApprovalRequestListItemDto) {
    setViewingId(r.id)
  }

  function handleCloseDetail() {
    setViewingId(null)
    setDetail(null)
    setDetailError(null)
    setRejecting(false)
    setRejectReason('')
  }

  function clearAllFilters() {
    setModule('')
    setModuleSearch('')
    setActionFilter('')
    setMakerSearch('')
    setEntitySearch('')
    setCheckerSearch('')
    setAssignedToMeOnly(false)
    setStatusFilter('')
    setDateRange('all')
    setCustomFrom('')
    setCustomTo('')
    setCustomDraftFrom('')
    setCustomDraftTo('')
    setDecidedRange('all')
    setDecidedCustomFrom('')
    setDecidedCustomTo('')
    setDecidedDraftFrom('')
    setDecidedDraftTo('')
  }

  const hasActiveFilters = Boolean(
    module || actionFilter || makerSearch || entitySearch || checkerSearch || assignedToMeOnly ||
    dateRange !== 'all' || decidedRange !== 'all' || statusFilter
  )

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <div className={styles.titleHeaderRow}>
            <h1 className={styles.title}>Approval Center</h1>
            <span className={styles.liveStreamBadge}>
              <span className={styles.liveDot} />
              Live Governance
            </span>
          </div>
          <p className={styles.subtitle}>
            Review and decide on pending administrative requests across the platform.
          </p>
        </div>

        <div className={styles.dateRangeGroup} role="group" aria-label="Quick date range">
          {DATE_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={r.key === dateRange ? styles.dateRangeActive : styles.dateRangeButton}
              onClick={() => {
                setDateRange(r.key)
                if (r.key !== 'custom') {
                  setCustomFrom('')
                  setCustomTo('')
                  setCustomDraftFrom('')
                  setCustomDraftTo('')
                }
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Metrics */}
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconAmber}`}>
            <Icon.Clock width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Pending</span>
            <span className={styles.summaryValue}>{summary?.pendingTotal ?? '0'}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconGreen}`}>
            <Icon.CheckCircle width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Approved Today</span>
            <span className={styles.summaryValue}>{summary?.approvedToday ?? '0'}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconRed}`}>
            <Icon.AlertCircle width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Rejected Today</span>
            <span className={styles.summaryValue}>{summary?.rejectedToday ?? '0'}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconBlue}`}>
            <Icon.UserCheck width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Assigned to Me</span>
            <span className={styles.summaryValue}>{summary?.assignedToMePending ?? '0'}</span>
          </div>
        </div>
      </div>

      {/* Tabs & Filter Bar */}
      <div className={styles.navBar}>
        <div className={styles.tabsList} role="tablist" aria-label="Approval views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === TAB_IDS.pending && !statusFilter}
            className={`${styles.tabBtn} ${activeTab === TAB_IDS.pending && !statusFilter ? styles.tabActive : ''}`}
            onClick={() => { setActiveTab(TAB_IDS.pending); setStatusFilter('') }}
          >
            Pending
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === TAB_IDS.processed && !statusFilter}
            className={`${styles.tabBtn} ${activeTab === TAB_IDS.processed && !statusFilter ? styles.tabActive : ''}`}
            onClick={() => { setActiveTab(TAB_IDS.processed); setStatusFilter('') }}
          >
            Processed
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === TAB_IDS.all && !statusFilter}
            className={`${styles.tabBtn} ${activeTab === TAB_IDS.all && !statusFilter ? styles.tabActive : ''}`}
            onClick={() => { setActiveTab(TAB_IDS.all); setStatusFilter('') }}
          >
            All Requests
          </button>
        </div>

        <div className={styles.toolbarActions}>
          {/* Rows-per-page dropdown */}
          <div className={styles.rowsDropdownWrap}>
            <label htmlFor="approvals-rows-select" className={styles.rowsDropdownLabel}>
              Rows
            </label>
            <div className={styles.rowsSelectWrap}>
              <select
                id="approvals-rows-select"
                className={styles.rowsSelect}
                value={isCustomPageSize ? 'custom' : pageSize}
                onChange={(e) => handlePageSizeSelect(e.target.value)}
                aria-label="Rows per page"
              >
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
                <option value="custom">Custom</option>
              </select>
              <span className={styles.rowsSelectChevron} aria-hidden="true">▾</span>
            </div>
            {isCustomPageSize && (
              <input
                type="number"
                min={1}
                max={500}
                className={styles.rowsCustomInput}
                value={customPageSizeInput}
                placeholder="e.g. 50"
                onChange={(e) => handleCustomPageSizeChange(e.target.value)}
                onBlur={() => {
                  const parsed = parseInt(customPageSizeInput, 10)
                  if (Number.isNaN(parsed) || parsed < 1 || parsed > 500) {
                    setCustomPageSizeInput(String(pageSize))
                  }
                }}
                aria-label="Custom row count"
                autoFocus
              />
            )}
          </div>

          <label className={styles.assignedToMeToggle}>
            <input type="checkbox" checked={assignedToMeOnly} onChange={(e) => setAssignedToMeOnly(e.target.checked)} />
            <span>Assigned to me</span>
          </label>

          <button type="button" className={styles.refreshBtn} onClick={() => { setRefreshKey((k) => k + 1); void loadSummary() }}>
            <Icon.Activity width={15} height={15} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Active filters chip banner */}
      {hasActiveFilters && (
        <div className={styles.activeFiltersBar}>
          <span className={styles.activeFiltersLabel}>Filters:</span>
          {dateRange !== 'all' && (
            <span className={styles.filterChip}>
              <span>
                Requested: {dateRange === 'custom' ? `${customFrom || '…'} to ${customTo || '…'}` : (DATE_RANGES.find((d) => d.key === dateRange)?.label ?? dateRange)}
              </span>
              <button type="button" className={styles.filterChipRemove} onClick={() => { setDateRange('all'); setCustomFrom(''); setCustomTo('') }} aria-label="Remove requested date filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {decidedRange !== 'all' && (
            <span className={styles.filterChip}>
              <span>
                Decided: {decidedRange === 'custom' ? `${decidedCustomFrom || '…'} to ${decidedCustomTo || '…'}` : (DATE_RANGES.find((d) => d.key === decidedRange)?.label ?? decidedRange)}
              </span>
              <button type="button" className={styles.filterChipRemove} onClick={() => { setDecidedRange('all'); setDecidedCustomFrom(''); setDecidedCustomTo('') }} aria-label="Remove decided date filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {statusFilter && (
            <span className={styles.filterChip}>
              <span>Status: {statusFilter}</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => setStatusFilter('')} aria-label="Remove status filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {module && (
            <span className={styles.filterChip}>
              <span>Module: {formatModuleName(module, moduleLabelsByKey)}</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => setModule('')} aria-label="Remove module filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {actionFilter && (
            <span className={styles.filterChip}>
              <span>Action: {ACTION_LABELS[actionFilter] ?? actionFilter}</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => setActionFilter('')} aria-label="Remove action filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {entitySearch && (
            <span className={styles.filterChip}>
              <span>Entity: "{entitySearch}"</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => setEntitySearch('')} aria-label="Remove entity filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {makerSearch && (
            <span className={styles.filterChip}>
              <span>Maker: "{makerSearch}"</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => setMakerSearch('')} aria-label="Remove maker filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {checkerSearch && (
            <span className={styles.filterChip}>
              <span>Checker: "{checkerSearch}"</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => setCheckerSearch('')} aria-label="Remove checker filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {assignedToMeOnly && (
            <span className={styles.filterChip}>
              <span>Assigned to me</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => setAssignedToMeOnly(false)} aria-label="Remove assigned to me filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          <button
            type="button"
            className={styles.clearAllBtn}
            onClick={clearAllFilters}
          >
            Clear all
          </button>
        </div>
      )}

      {error && <div className={styles.errorBanner}>{error}</div>}

      {/* Table */}
      <div className={styles.tableContainer}>
        <table className={styles.logTable}>
          <thead>
            <tr>
              {/* REQUESTED */}
              <th className={styles.thFilterable}>
                <button
                  type="button"
                  className={`${styles.thFilterBtn} ${dateRange !== 'all' ? styles.thFilterBtnActive : ''}`}
                  onClick={() => setActiveHeaderFilter((c) => (c === 'requested' ? null : 'requested'))}
                >
                  <span>REQUESTED</span>
                  <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'requested' ? styles.filterIconActive : ''}`} />
                  {dateRange !== 'all' && <span className={styles.filterDot} />}
                </button>
                {activeHeaderFilter === 'requested' && (
                  <div className={styles.filterPopover}>
                    <div className={styles.popoverHeader}>
                      <span className={styles.popoverTitle}>Requested Date</span>
                      {dateRange !== 'all' && (
                        <button type="button" className={styles.popoverClearBtn} onClick={() => { setDateRange('all'); setCustomFrom(''); setCustomTo(''); setCustomDraftFrom(''); setCustomDraftTo('') }}>
                          Reset
                        </button>
                      )}
                    </div>
                    <div className={styles.popoverList}>
                      {DATE_RANGES.map((r) => (
                        <button
                          key={r.key}
                          type="button"
                          className={`${styles.popoverItem} ${dateRange === r.key ? styles.popoverItemActive : ''}`}
                          onClick={() => { setDateRange(r.key); setActiveHeaderFilter(null) }}
                        >
                          <span>{r.label}</span>
                        </button>
                      ))}
                    </div>
                    <div className={styles.popoverDivider} />
                    <div className={styles.customDateSection}>
                      <span className={styles.customDateLabel}>Custom Range</span>
                      <div className={styles.customDateRow}>
                        <input
                          type="date"
                          className={styles.dateInput}
                          value={customDraftFrom || customFrom}
                          onChange={(e) => setCustomDraftFrom(e.target.value)}
                        />
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>to</span>
                        <input
                          type="date"
                          className={styles.dateInput}
                          value={customDraftTo || customTo}
                          onChange={(e) => setCustomDraftTo(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className={styles.applyDateBtn}
                        onClick={() => {
                          setCustomFrom(customDraftFrom)
                          setCustomTo(customDraftTo)
                          setDateRange('custom')
                          setActiveHeaderFilter(null)
                        }}
                      >
                        Apply Custom Range
                      </button>
                    </div>
                  </div>
                )}
              </th>

              {/* MODULE */}
              <th className={styles.thFilterable}>
                <button
                  type="button"
                  className={`${styles.thFilterBtn} ${module ? styles.thFilterBtnActive : ''}`}
                  onClick={() => setActiveHeaderFilter((c) => (c === 'module' ? null : 'module'))}
                >
                  <span>MODULE</span>
                  <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'module' ? styles.filterIconActive : ''}`} />
                  {module && <span className={styles.filterDot} />}
                </button>
                {activeHeaderFilter === 'module' && (
                  <div className={styles.filterPopover}>
                    <div className={styles.popoverHeader}>
                      <span className={styles.popoverTitle}>Filter Module</span>
                      {module && <button type="button" className={styles.popoverClearBtn} onClick={() => { setModule(''); setModuleSearch('') }}>Reset</button>}
                    </div>
                    <input
                      type="text"
                      className={styles.popoverInput}
                      placeholder="Type to search module..."
                      value={moduleSearch}
                      onChange={(e) => setModuleSearch(e.target.value)}
                      autoFocus
                    />
                    <div className={styles.popoverList}>
                      <button
                        type="button"
                        className={`${styles.popoverItem} ${!module ? styles.popoverItemActive : ''}`}
                        onClick={() => { setModule(''); setActiveHeaderFilter(null) }}
                      >
                        <span>All Modules</span>
                      </button>
                      {availableModules.length === 0 ? (
                        <div className={styles.emptyHint}>No modules matching "{moduleSearch}"</div>
                      ) : (
                        availableModules.map((m) => (
                          <button
                            key={m.key}
                            type="button"
                            className={`${styles.popoverItem} ${module === m.key ? styles.popoverItemActive : ''}`}
                            onClick={() => { setModule(m.key); setActiveHeaderFilter(null) }}
                          >
                            <span>{m.label}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </th>

              {/* ACTION */}
              <th className={styles.thFilterable}>
                <button
                  type="button"
                  className={`${styles.thFilterBtn} ${actionFilter ? styles.thFilterBtnActive : ''}`}
                  onClick={() => setActiveHeaderFilter((c) => (c === 'action' ? null : 'action'))}
                >
                  <span>ACTION</span>
                  <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'action' ? styles.filterIconActive : ''}`} />
                  {actionFilter && <span className={styles.filterDot} />}
                </button>
                {activeHeaderFilter === 'action' && (
                  <div className={styles.filterPopover}>
                    <div className={styles.popoverHeader}>
                      <span className={styles.popoverTitle}>Filter Action</span>
                      {actionFilter && <button type="button" className={styles.popoverClearBtn} onClick={() => setActionFilter('')}>Reset</button>}
                    </div>
                    <div className={styles.popoverList}>
                      <button
                        type="button"
                        className={`${styles.popoverItem} ${!actionFilter ? styles.popoverItemActive : ''}`}
                        onClick={() => { setActionFilter(''); setActiveHeaderFilter(null) }}
                      >
                        <span>All Actions</span>
                      </button>
                      {Object.keys(ACTION_LABELS).map((act) => {
                        const ActIcon = ACTION_ICONS[act] ?? Icon.Edit
                        return (
                          <button
                            key={act}
                            type="button"
                            className={`${styles.popoverItem} ${actionFilter === act ? styles.popoverItemActive : ''}`}
                            onClick={() => { setActionFilter(act); setActiveHeaderFilter(null) }}
                          >
                            <span className={`${styles.actionCell} ${styles[`action_${act}`] ?? ''}`}>
                              <ActIcon width={13} height={13} />
                              <span>{ACTION_LABELS[act]}</span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </th>

              {/* ENTITY */}
              <th className={styles.thFilterable}>
                <button
                  type="button"
                  className={`${styles.thFilterBtn} ${entitySearch ? styles.thFilterBtnActive : ''}`}
                  onClick={() => setActiveHeaderFilter((c) => (c === 'entity' ? null : 'entity'))}
                >
                  <span>ENTITY</span>
                  <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'entity' ? styles.filterIconActive : ''}`} />
                  {entitySearch && <span className={styles.filterDot} />}
                </button>
                {activeHeaderFilter === 'entity' && (
                  <div className={styles.filterPopover}>
                    <div className={styles.popoverHeader}>
                      <span className={styles.popoverTitle}>Search Entity</span>
                      {entitySearch && <button type="button" className={styles.popoverClearBtn} onClick={() => setEntitySearch('')}>Reset</button>}
                    </div>
                    <input
                      type="text"
                      className={styles.popoverInput}
                      placeholder="Filter by entity name/ID..."
                      value={entitySearch}
                      onChange={(e) => setEntitySearch(e.target.value)}
                      autoFocus
                    />
                  </div>
                )}
              </th>

              {/* MAKER */}
              <th className={styles.thFilterable}>
                <button
                  type="button"
                  className={`${styles.thFilterBtn} ${makerSearch ? styles.thFilterBtnActive : ''}`}
                  onClick={() => setActiveHeaderFilter((c) => (c === 'maker' ? null : 'maker'))}
                >
                  <span>MAKER</span>
                  <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'maker' ? styles.filterIconActive : ''}`} />
                  {makerSearch && <span className={styles.filterDot} />}
                </button>
                {activeHeaderFilter === 'maker' && (
                  <div className={styles.filterPopover}>
                    <div className={styles.popoverHeader}>
                      <span className={styles.popoverTitle}>Filter Maker</span>
                      {makerSearch && <button type="button" className={styles.popoverClearBtn} onClick={() => setMakerSearch('')}>Reset</button>}
                    </div>
                    <input
                      type="text"
                      className={styles.popoverInput}
                      placeholder="Search maker name..."
                      value={makerSearch}
                      onChange={(e) => setMakerSearch(e.target.value)}
                      autoFocus
                    />
                    {availableMakers.length > 0 && (
                      <>
                        <div className={styles.popoverDivider} />
                        <span className={styles.customDateLabel}>Known Makers:</span>
                        <div className={styles.userListSection}>
                          {availableMakers.map((m) => (
                            <button
                              key={m.id || m.name}
                              type="button"
                              className={`${styles.userItem} ${makerSearch.toLowerCase() === m.name.toLowerCase() ? styles.userItemActive : ''}`}
                              onClick={() => { setMakerSearch(m.name); setActiveHeaderFilter(null) }}
                            >
                              <div className={styles.userAvatarSmall}>
                                {m.name.charAt(0).toUpperCase()}
                              </div>
                              <span>{m.name}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </th>

              {/* CHECKER */}
              <th className={styles.thFilterable}>
                <button
                  type="button"
                  className={`${styles.thFilterBtn} ${assignedToMeOnly || checkerSearch ? styles.thFilterBtnActive : ''}`}
                  onClick={() => setActiveHeaderFilter((c) => (c === 'checker' ? null : 'checker'))}
                >
                  <span>CHECKER</span>
                  <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'checker' ? styles.filterIconActive : ''}`} />
                  {(assignedToMeOnly || checkerSearch) && <span className={styles.filterDot} />}
                </button>
                {activeHeaderFilter === 'checker' && (
                  <div className={`${styles.filterPopover} ${styles.popoverRight}`}>
                    <div className={styles.popoverHeader}>
                      <span className={styles.popoverTitle}>Filter Checker</span>
                      {(assignedToMeOnly || checkerSearch) && (
                        <button
                          type="button"
                          className={styles.popoverClearBtn}
                          onClick={() => { setAssignedToMeOnly(false); setCheckerSearch('') }}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    <label className={styles.popoverCheckboxLabel}>
                      <input
                        type="checkbox"
                        checked={assignedToMeOnly}
                        onChange={(e) => setAssignedToMeOnly(e.target.checked)}
                      />
                      <span>Assigned to me</span>
                    </label>
                    <input
                      type="text"
                      className={styles.popoverInput}
                      placeholder="Search checker name..."
                      value={checkerSearch}
                      onChange={(e) => setCheckerSearch(e.target.value)}
                    />
                    {availableCheckers.length > 0 && (
                      <>
                        <div className={styles.popoverDivider} />
                        <span className={styles.customDateLabel}>Known Checkers:</span>
                        <div className={styles.userListSection}>
                          {availableCheckers.map((c) => (
                            <button
                              key={c.id || c.name}
                              type="button"
                              className={`${styles.userItem} ${checkerSearch.toLowerCase() === c.name.toLowerCase() ? styles.userItemActive : ''}`}
                              onClick={() => { setCheckerSearch(c.name); setActiveHeaderFilter(null) }}
                            >
                              <div className={`${styles.userAvatarSmall} ${styles.checkerAvatarSmall}`}>
                                {c.name.charAt(0).toUpperCase()}
                              </div>
                              <span>{c.name}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </th>

              {/* STATUS */}
              <th className={styles.thFilterable}>
                <button
                  type="button"
                  className={`${styles.thFilterBtn} ${statusFilter || activeTab !== TAB_IDS.all ? styles.thFilterBtnActive : ''}`}
                  onClick={() => setActiveHeaderFilter((c) => (c === 'status' ? null : 'status'))}
                >
                  <span>STATUS</span>
                  <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'status' ? styles.filterIconActive : ''}`} />
                  {(statusFilter || activeTab !== TAB_IDS.all) && <span className={styles.filterDot} />}
                </button>
                {activeHeaderFilter === 'status' && (
                  <div className={`${styles.filterPopover} ${styles.popoverRight}`}>
                    <div className={styles.popoverHeader}>
                      <span className={styles.popoverTitle}>Filter Status</span>
                      {(statusFilter || activeTab !== TAB_IDS.all) && (
                        <button
                          type="button"
                          className={styles.popoverClearBtn}
                          onClick={() => { setStatusFilter(''); setActiveTab(TAB_IDS.all) }}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    <div className={styles.popoverList}>
                      <button
                        type="button"
                        className={`${styles.popoverItem} ${!statusFilter && activeTab === TAB_IDS.all ? styles.popoverItemActive : ''}`}
                        onClick={() => { setStatusFilter(''); setActiveTab(TAB_IDS.all); setActiveHeaderFilter(null) }}
                      >
                        <span>All Statuses</span>
                      </button>
                      <button
                        type="button"
                        className={`${styles.popoverItem} ${statusFilter === 'Pending' || (activeTab === TAB_IDS.pending && !statusFilter) ? styles.popoverItemActive : ''}`}
                        onClick={() => { setStatusFilter('Pending'); setActiveHeaderFilter(null) }}
                      >
                        <Badge tone="warning" dot>Pending</Badge>
                      </button>
                      <button
                        type="button"
                        className={`${styles.popoverItem} ${statusFilter === 'Approved' ? styles.popoverItemActive : ''}`}
                        onClick={() => { setStatusFilter('Approved'); setActiveHeaderFilter(null) }}
                      >
                        <Badge tone="success" dot>Approved</Badge>
                      </button>
                      <button
                        type="button"
                        className={`${styles.popoverItem} ${statusFilter === 'Rejected' ? styles.popoverItemActive : ''}`}
                        onClick={() => { setStatusFilter('Rejected'); setActiveHeaderFilter(null) }}
                      >
                        <Badge tone="danger" dot>Rejected</Badge>
                      </button>
                    </div>
                  </div>
                )}
              </th>

              {/* DECIDED */}
              <th className={styles.thFilterable}>
                <button
                  type="button"
                  className={`${styles.thFilterBtn} ${decidedRange !== 'all' ? styles.thFilterBtnActive : ''}`}
                  onClick={() => setActiveHeaderFilter((c) => (c === 'decided' ? null : 'decided'))}
                >
                  <span>DECIDED</span>
                  <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'decided' ? styles.filterIconActive : ''}`} />
                  {decidedRange !== 'all' && <span className={styles.filterDot} />}
                </button>
                {activeHeaderFilter === 'decided' && (
                  <div className={`${styles.filterPopover} ${styles.popoverRight}`}>
                    <div className={styles.popoverHeader}>
                      <span className={styles.popoverTitle}>Decided Date</span>
                      {decidedRange !== 'all' && (
                        <button type="button" className={styles.popoverClearBtn} onClick={() => { setDecidedRange('all'); setDecidedCustomFrom(''); setDecidedCustomTo(''); setDecidedDraftFrom(''); setDecidedDraftTo('') }}>
                          Reset
                        </button>
                      )}
                    </div>
                    <div className={styles.popoverList}>
                      {DATE_RANGES.map((r) => (
                        <button
                          key={r.key}
                          type="button"
                          className={`${styles.popoverItem} ${decidedRange === r.key ? styles.popoverItemActive : ''}`}
                          onClick={() => { setDecidedRange(r.key); setActiveHeaderFilter(null) }}
                        >
                          <span>{r.label}</span>
                        </button>
                      ))}
                    </div>
                    <div className={styles.popoverDivider} />
                    <div className={styles.customDateSection}>
                      <span className={styles.customDateLabel}>Custom Range</span>
                      <div className={styles.customDateRow}>
                        <input
                          type="date"
                          className={styles.dateInput}
                          value={decidedDraftFrom || decidedCustomFrom}
                          onChange={(e) => setDecidedDraftFrom(e.target.value)}
                        />
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>to</span>
                        <input
                          type="date"
                          className={styles.dateInput}
                          value={decidedDraftTo || decidedCustomTo}
                          onChange={(e) => setDecidedDraftTo(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className={styles.applyDateBtn}
                        onClick={() => {
                          setDecidedCustomFrom(decidedDraftFrom)
                          setDecidedCustomTo(decidedDraftTo)
                          setDecidedRange('custom')
                          setActiveHeaderFilter(null)
                        }}
                      >
                        Apply Custom Range
                      </button>
                    </div>
                  </div>
                )}
              </th>

              <th></th>
            </tr>
          </thead>
          <tbody>
            {items === null ? (
              // Shaped per-column, matching AuditLogsPage's own skeleton rows — a single bar spanning
              // the whole row read as noticeably less finished next to that page's per-cell shapes.
              Array.from({ length: pageSize }).map((_, i) => (
                <tr key={i}>
                  <td><SkeletonBlock width={85} height={15} radius="4px" /></td>
                  <td><SkeletonBlock width={100} height={20} radius="999px" /></td>
                  <td><SkeletonBlock width={75} height={20} radius="6px" /></td>
                  <td><SkeletonBlock width={95} height={15} radius="4px" /></td>
                  <td>
                    <div className={styles.actorCell}>
                      <SkeletonBlock width={28} height={28} radius="8px" />
                      <SkeletonBlock width={80} height={15} radius="4px" />
                    </div>
                  </td>
                  <td>
                    <div className={styles.actorCell}>
                      <SkeletonBlock width={28} height={28} radius="8px" />
                      <SkeletonBlock width={80} height={15} radius="4px" />
                    </div>
                  </td>
                  <td><SkeletonBlock width={70} height={20} radius="999px" /></td>
                  <td><SkeletonBlock width={85} height={15} radius="4px" /></td>
                  <td><SkeletonBlock width={56} height={26} radius="7px" /></td>
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={9} className={styles.emptyCell}>No approval requests found matching the selected filters.</td>
              </tr>
            ) : (
              items.map((r) => {
                const ActionIcon = ACTION_ICONS[r.action] ?? Icon.Edit
                return (
                  <tr key={r.id}>
                    <td className={styles.timeCell}>{formatDateOnly(r.requestedAt)}</td>
                    <td><Badge tone="info">{formatModuleName(r.module, moduleLabelsByKey)}</Badge></td>
                    <td>
                      <span className={`${styles.actionCell} ${styles[`action_${r.action}`] ?? ''}`}>
                        <ActionIcon width={12} height={12} />
                        <span>{ACTION_LABELS[r.action] ?? r.action}</span>
                      </span>
                    </td>
                    <td>
                      {r.entityLabel ? (
                        <span className={styles.entityLabel}>{r.entityLabel}</span>
                      ) : (
                        <span className={styles.mutedText}>—</span>
                      )}
                    </td>
                    <td>
                      {r.makerName ? (
                        <div className={styles.actorCell}>
                          <span className={styles.actorAvatar}>{r.makerName.charAt(0).toUpperCase()}</span>
                          <span className={styles.actorName}>{r.makerName}</span>
                        </div>
                      ) : (
                        <span className={styles.mutedText}>Unknown</span>
                      )}
                    </td>
                    <td>
                      {r.checkerName ? (
                        <div className={styles.actorCell}>
                          <span className={`${styles.actorAvatar} ${styles.checkerAvatar}`}>{r.checkerName.charAt(0).toUpperCase()}</span>
                          <span className={styles.actorName}>{r.checkerName}</span>
                        </div>
                      ) : (
                        <span className={styles.unassignedChip}>Unassigned</span>
                      )}
                    </td>
                    <td><Badge tone={STATUS_TONES[r.status]} dot>{r.status}</Badge></td>
                    <td className={styles.timeCell}>
                      {r.decidedAt ? formatDateOnly(r.decidedAt) : <span className={styles.mutedText}>—</span>}
                    </td>
                    <td>
                      <button type="button" className={styles.viewDetailBtn} onClick={() => handleRowClick(r)}>
                        <span>View</span>
                        <Icon.ChevronRight width={12} height={12} />
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className={styles.pagination}>
          <button type="button" className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            &lt; Previous
          </button>
          <span className={styles.pageIndicator}>Page {page} of {totalPages}</span>
          <button type="button" className={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next &gt;
          </button>
        </div>
      )}

      {/* Detail drawer */}
      {viewingId && (
        <div className={drawerStyles.overlayRoot}>
          <div className={drawerStyles.backdrop} onClick={handleCloseDetail} />
          <div className={drawerStyles.drawerContainer}>
            <div className={drawerStyles.rootPanel}>
              <div className={drawerStyles.header}>
                <div className={drawerStyles.headerLeft}>
                  <div className={drawerStyles.headerIcon}>
                    <Icon.UserCheck width={20} height={20} />
                  </div>
                  <div>
                    <h2 className={drawerStyles.title}>Approval Request</h2>
                    <p className={drawerStyles.subtitle}>Full details of this request</p>
                  </div>
                </div>
                <button type="button" className={drawerStyles.closeBtn} onClick={handleCloseDetail} aria-label="Close details">
                  <Icon.X width={20} height={20} />
                </button>
              </div>

              <div className={drawerStyles.tabBody}>
                {detailLoading ? (
                  <div className={styles.drawerSections}>
                    <SkeletonBlock height={120} radius="10px" />
                  </div>
                ) : detailError && !detail ? (
                  <div className={styles.errorBanner}>{detailError}</div>
                ) : detail ? (
                  <div className={styles.drawerSections}>
                    <section className={styles.drawerSection}>
                      <div className={styles.overviewTimelineGrid}>
                        <div className={styles.overviewTimelineCol}>
                          <h3 className={styles.drawerSectionTitle}>Overview</h3>
                          <dl className={styles.detailList}>
                            <div className={styles.detailRow}>
                              <span className={styles.detailIcon}><Icon.Grid width={15} height={15} /></span>
                              <div className={styles.detailRowBody}>
                                <dt>Module</dt>
                                <dd><Badge tone="info">{formatModuleName(detail.module, moduleLabelsByKey)}</Badge></dd>
                              </div>
                            </div>
                            <div className={styles.detailRow}>
                              <span className={`${styles.detailIcon} ${styles.detailIconNeutral}`}>
                                {(() => { const ActionIcon = ACTION_ICONS[detail.action] ?? Icon.Edit; return <ActionIcon width={15} height={15} /> })()}
                              </span>
                              <div className={styles.detailRowBody}>
                                <dt>Action</dt>
                                <dd>{ACTION_LABELS[detail.action] ?? detail.action}</dd>
                              </div>
                            </div>
                            {detail.entityType && (
                              <div className={styles.detailRow}>
                                <span className={styles.detailIcon}><Icon.User width={15} height={15} /></span>
                                <div className={styles.detailRowBody}>
                                   <dt>Entity</dt>
                                  <dd>{detail.entityType}{detail.entityLabel ? ` — ${detail.entityLabel}` : ''}</dd>
                                </div>
                              </div>
                            )}
                            <div className={styles.detailRow}>
                              <span className={`${styles.detailIcon} ${styles.detailIconPurple}`}><Icon.Info width={15} height={15} /></span>
                              <div className={styles.detailRowBody}>
                                <dt>Status</dt>
                                <dd><Badge tone={STATUS_TONES[detail.status]} dot>{detail.status}</Badge></dd>
                              </div>
                            </div>
                          </dl>
                        </div>

                        <div className={`${styles.overviewTimelineCol} ${styles.overviewTimelineColDivider}`}>
                          <h3 className={styles.drawerSectionTitle}>Approval Timeline</h3>
                          <div className={styles.timeline}>
                            <div className={styles.timelineStep}>
                              <span className={styles.timelineDot} />
                              <div className={styles.timelineStepCard}>
                                <span className={styles.timelineLabel}>Requested by {detail.makerName ?? 'Unknown'}</span>
                                <span className={styles.timelineTime}><Icon.Clock width={12} height={12} />{formatDateOnly(detail.requestedAt)}</span>
                              </div>
                            </div>
                            <div className={styles.timelineStep}>
                              <span className={`${styles.timelineDot} ${detail.status === 'Pending' ? styles.timelineDotPending : styles.timelineDotDone}`} />
                              <div className={styles.timelineStepCard}>
                                <span className={styles.timelineLabel}>
                                  {detail.status === 'Pending'
                                    ? `Awaiting ${detail.checkerName ?? 'an assigned checker'}`
                                    : `${detail.status} by ${detail.checkerName ?? 'checker'}`}
                                </span>
                                {detail.decidedAt && <span className={styles.timelineTime}><Icon.Clock width={12} height={12} />{formatDateOnly(detail.decidedAt)}</span>}
                              </div>
                            </div>
                          </div>
                          {detail.rejectionReason && (
                            <p className={styles.rejectionReasonText}>
                              <strong>Rejection reason:</strong> {detail.rejectionReason}
                            </p>
                          )}
                        </div>
                      </div>
                    </section>

                    <section className={styles.drawerSection}>
                      <h3 className={styles.drawerSectionTitle}>
                        <Icon.Clock width={12} height={12} />
                        Before
                        {/* "(Current Record)" only makes sense when a record actually exists to show —
                            a Create request's "Before" is deliberately empty, so this stays untagged then. */}
                        {detail.action !== 'Create' && <span className={styles.drawerSectionTitleTag}>(Current Record)</span>}
                      </h3>
                      {renderDataFields(detail.oldDataJson, detail.action === 'Create' ? 'New record — nothing existed before.' : 'No prior state recorded.')}
                    </section>

                    <section className={styles.drawerSection}>
                      <h3 className={styles.drawerSectionTitle}>
                        <Icon.FileText width={12} height={12} />
                        Requested Change
                      </h3>
                      {renderDataFields(detail.newDataJson, requestedChangeEmptyMessage(detail.action))}
                    </section>

                    {(() => {
                      const permissionDiff = diffOverrides(detail.oldDataJson, detail.newDataJson)
                      if (!permissionDiff) return null
                      return (
                        <section className={styles.drawerSection}>
                          <h3 className={styles.drawerSectionTitle}>Permission Changes</h3>
                          {permissionDiff.unchanged ? (
                            <p className={styles.mutedText}>No permission changes in this request.</p>
                          ) : (
                            <div className={styles.permissionDiffList}>
                              {permissionDiff.added.map((o) => (
                                <div key={`add-${overrideKey(o)}`} className={`${styles.permissionDiffCard} ${styles.permissionDiffCardAdd}`}>
                                  <span className={styles.permissionDiffBadgeAdd}>+ Add</span>
                                  <div className={styles.permissionDiffBody}>
                                    <span className={styles.permissionDiffFeature}>{o.featureKey}</span>
                                    <span className={styles.permissionDiffCapability}>{o.capability} ({o.effect})</span>
                                  </div>
                                </div>
                              ))}
                              {permissionDiff.removed.map((o) => (
                                <div key={`rem-${overrideKey(o)}`} className={`${styles.permissionDiffCard} ${styles.permissionDiffCardRem}`}>
                                  <span className={styles.permissionDiffBadgeRem}>− Remove</span>
                                  <div className={styles.permissionDiffBody}>
                                    <span className={styles.permissionDiffFeature}>{o.featureKey}</span>
                                    <span className={styles.permissionDiffCapability}>{o.capability} ({o.effect})</span>
                                  </div>
                                </div>
                              ))}
                              {permissionDiff.changed.map(({ key, from, to }) => (
                                <div key={`chg-${key}`} className={`${styles.permissionDiffCard} ${styles.permissionDiffCardMod}`}>
                                  <span className={styles.permissionDiffBadgeMod}>~ Modify</span>
                                  <div className={styles.permissionDiffBody}>
                                    <span className={styles.permissionDiffFeature}>{to.featureKey}</span>
                                    <span className={styles.permissionDiffCapability}>{to.capability}: {from.effect} → {to.effect}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      )
                    })()}

                    {detailError && <div className={styles.errorBanner}>{detailError}</div>}
                  </div>
                ) : null}
              </div>

              {/*
                Sticky action footer — outside the scrollable tabBody so Approve/Reject are
                always visible at the bottom of the drawer regardless of scroll position.
                Layout mirrors the screenshot: "Edit" chip on the left, Reject + Approve on the right.
                Row-level check (isMyDecisionToMake) instead of PermissionGate — an admin who isn't
                the specific assigned checker must not see actionable buttons on someone else's request.
              */}
              {isMyDecisionToMake && detail && (
                <div className={styles.detailFooter}>
                  {!rejecting ? (
                    <div className={styles.footerActions}>
                      <span className={styles.footerEditLabel}>Edit</span>
                      <div className={styles.footerBtns}>
                        <button
                          type="button"
                          className={styles.rejectBtn}
                          onClick={() => setRejecting(true)}
                          disabled={deciding}
                        >
                          <Icon.X width={15} height={15} />
                          <span>Reject</span>
                        </button>
                        <button
                          type="button"
                          className={styles.approveBtn}
                          onClick={() => void handleApprove()}
                          disabled={deciding}
                        >
                          <Icon.CheckCircle width={15} height={15} />
                          <span>{deciding ? 'Approving…' : 'Approve'}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.rejectFormFooter}>
                      <label className={styles.label}>Rejection reason</label>
                      <textarea
                        className={styles.rejectTextarea}
                        rows={3}
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Explain why this request is being rejected..."
                        autoFocus
                      />
                      <div className={styles.footerBtns}>
                        <button
                          type="button"
                          className={styles.cancelRejectBtn}
                          onClick={() => setRejecting(false)}
                          disabled={deciding}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className={styles.rejectBtn}
                          onClick={() => void handleReject()}
                          disabled={deciding || !rejectReason.trim()}
                        >
                          {deciding ? 'Rejecting…' : 'Confirm Reject'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
