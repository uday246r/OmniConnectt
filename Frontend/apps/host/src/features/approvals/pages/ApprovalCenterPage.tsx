import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuthStore } from '../../auth/store/authStore'
import { Badge, Button, CsvExportError, DataTable, DateRangeColumnFilter, DateRangeFilterButton, EMPTY_DATE_RANGE, EMPTY_VALUE, PageHeader, Pagination, ResponsiveRows, RowAction, RowsPerPage, describeDateRange, describeTruncation, isDateRangeActive, readStoredPageSize, resolveDateRange, sanitizeFilterInput, filterTypeBlockedMessage, useCommittedFilter, type BadgeTone, type CommittedFilter, type DateRangeValue } from '@omniconnect/ui'
import { PermissionGate } from '../../../shared/components/PermissionGate/PermissionGate'
import { SkeletonBlock } from '../../../shared/components/Skeleton'
import { ApiError } from '../../../shared/api/httpClient'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue'
import {
  approvalsApi,
  type ApprovalRequestListItemDto,
  type ApprovalRequestDetailDto,
  type ApprovalSummaryDto,
  type ApprovalStatus,
  type ApprovalFacetsDto,
  type ListApprovalsParams,
} from '../api/approvalsApi'
import { useApprovalRequests } from '../hooks/useApprovalRequests'
import { Icon } from '../../../shared/components/Icon/Icon'
// Same drawer shell Audit Logs / Settings use — the whole point of "keep the design language" is
// not building a fourth right-side-panel implementation.
import drawerStyles from '../../../layout/SettingsDrawer/SettingsDrawer.module.css'
import styles from './ApprovalCenterPage.module.css'
import { TOPICS, invalidate } from '../../../shared/stores/invalidationStore'
import { useLiveRefetchInterval } from '../../../shared/query/invalidationBridge'
import { queryKeys } from '../../../shared/query/queryKeys'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'

const DEFAULT_PAGE_SIZE = 10

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

function formatModuleName(rawModule: string | null | undefined): string {
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
            <span className={styles.fieldCardIcon} style={{ '--icon-bg': bg, '--icon-color': color } as React.CSSProperties}>
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

/**
 * The centralized Approval Center — one source of truth across the whole platform (Phase 1: Users and
 * Roles; every future gated module lands in this same table, same page, no separate flow per module).
 */
/** The feature key this page's own capabilities hang off. */
const FEATURE = 'host.system.approvals'

export function ApprovalCenterPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const queryClient = useQueryClient()
  const refetchInterval = useLiveRefetchInterval()
  const currentUserId = useAuthStore((s) => s.user?.id)

  const [activeTab, setActiveTab] = useState<TabId>(TAB_IDS.pending)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => readStoredPageSize('host.approvals', DEFAULT_PAGE_SIZE))
  const [activeHeaderFilter, setActiveHeaderFilter] = useState<string | null>(null)

  /*
   * Two ranges, both on the shared control.
   *
   * The pair this replaces had two problems. Its custom range resolved against UTC while every other
   * screen resolved against local time, so the same dates typed here selected a different window —
   * at UTC+8, "12 Sep" meant 08:00 on the 12th to 07:59 on the 13th. And the Decided range was
   * applied in the browser, over the page already fetched, so it only ever searched the rows that
   * happened to be loaded; it is a real query parameter now.
   */
  const [requestedRange, setRequestedRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE)
  const [decidedRange, setDecidedRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE)
  const [exporting, setExporting] = useState(false)
  const [exportNotice, setExportNotice] = useState<string | null>(null)

  // Module filter with live search. Its options come from the loaded rows — see availableModules.
  const [module, setModule] = useState('')
  const [moduleSearch, setModuleSearch] = useState('')

  // Action filter
  const [actionFilter, setActionFilter] = useState('')

  /*
   * Record, Maker and Checker are free-text popovers whose box used to BE the filter: every debounce
   * tick re-filtered the table while simultaneously re-narrowing the "known values" list you were
   * reading. useCommittedFilter separates them — `query` feeds the recommendations, `applied` feeds
   * the table — so typing costs nothing and the rows move exactly once, on Enter or on a pick.
   * (Module, Action and Status were always pick-only and are left alone.)
   */
  const recordFilter = useCommittedFilter()
  const makerFilter = useCommittedFilter()
  const checkerFilter = useCommittedFilter()

  /** Enter applies what is typed — the escape hatch for a value with no suggestion behind it. */
  const commitOnEnter = (f: CommittedFilter) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    f.commit()
    setActiveHeaderFilter(null)
  }

  // Maker search — a person's name, letters only.
  const [makerSearchBlocked, setMakerSearchBlocked] = useState(false)
  function handleMakerSearchChange(raw: string) {
    const clean = sanitizeFilterInput(raw, 'alpha')
    makerFilter.setQuery(clean)
    setMakerSearchBlocked(clean !== raw)
  }

  // Checker search & assigned to me — same as maker, letters only.
  const [checkerSearchBlocked, setCheckerSearchBlocked] = useState(false)
  function handleCheckerSearchChange(raw: string) {
    const clean = sanitizeFilterInput(raw, 'alpha')
    checkerFilter.setQuery(clean)
    setCheckerSearchBlocked(clean !== raw)
  }
  const [assignedToMeOnly, setAssignedToMeOnly] = useState(false)

  // Status filter ('Pending' | 'Approved' | 'Rejected' | '')
  const [statusFilter, setStatusFilter] = useState<'' | 'Pending' | 'Approved' | 'Rejected'>('')

  /*
   * Module, maker and checker options, from the server under the filters already applied.
   *
   * These were derived from an in-memory pool of every row the page had fetched. With the page
   * fetching one page at a time that pool would shrink to ten rows, and even before it could only
   * offer names that happened to be loaded — a maker whose requests were all older than the newest
   * 200 was absent from the list and unfindable by picking.
   */

  // Debounced TYPED text — feeds the recommendation lists only. The table reads `.applied`.
  const debouncedMaker = useDebouncedValue(makerFilter.query, 200)
  const debouncedEntity = useDebouncedValue(recordFilter.query, 200)
  const debouncedChecker = useDebouncedValue(checkerFilter.query, 200)

  // Resolved where the request is built, never stored — a stored "Last 7 Days" would freeze.
  const range = useMemo(() => resolveDateRange(requestedRange), [requestedRange])
  const decided = useMemo(() => resolveDateRange(decidedRange), [decidedRange])

  /**
   * Every filter on this screen, as the query parameters the server applies.
   *
   * One builder for the table, the dropdown options and the export. The table used to fetch the
   * newest 200 requests per status (two requests for Processed, merged in the browser), then filter
   * action, maker, checker, record and assignment client-side and page the remainder — so anything
   * outside those 200 could not be found, and the export, which could only send what the server
   * understood, answered a broader question than the table.
   */
  const buildFilterParams = useCallback((): ListApprovalsParams => {
    const tabStatus = activeTab === TAB_IDS.processed ? 'Approved,Rejected' : TAB_STATUS_FILTER[activeTab]
    return {
      module: module || undefined,
      status: statusFilter || tabStatus,
      action: (actionFilter || undefined) as ListApprovalsParams['action'],
      makerName: makerFilter.applied || undefined,
      checkerName: checkerFilter.applied || undefined,
      entityLabel: recordFilter.applied || undefined,
      assignedToMe: assignedToMeOnly || undefined,
      sortBy: activeTab === TAB_IDS.processed ? 'decided' : undefined,
      from: range.from,
      to: range.to,
      decidedFrom: decided.from,
      decidedTo: decided.to,
    }
  }, [
    activeTab, module, statusFilter, actionFilter, makerFilter.applied, checkerFilter.applied,
    recordFilter.applied, assignedToMeOnly, range.from, range.to, decided.from, decided.to,
  ])

  const filterParams = useMemo(() => buildFilterParams(), [buildFilterParams])

  // Dropdown options under the filters applied. A failure empties the dropdowns, never the table.
  const facetsQuery = useQuery({
    queryKey: queryKeys.approvals.facets(filterParams),
    enabled: Boolean(accessToken),
    placeholderData: keepPreviousData,
    refetchInterval,
    queryFn: ({ signal }) => approvalsApi.facets(accessToken!, filterParams, signal),
  })
  const facets: ApprovalFacetsDto | null = facetsQuery.isError ? null : (facetsQuery.data ?? null)

  /*
   * Known makers and checkers narrow as you type, in step with the table (both read the same
   * debounced value). An empty box lists everyone, which is what the section is for.
   */
  const narrowByName = <T extends { name: string }>(list: T[], query: string, applied: string) => {
    const withoutApplied = applied
      ? list.filter((x) => x.name.toLowerCase() !== applied.toLowerCase())
      : list
    const q = query.toLowerCase().trim()
    return q ? withoutApplied.filter((x) => x.name.toLowerCase().includes(q)) : withoutApplied
  }

  const availableMakers = useMemo(
    () => narrowByName((facets?.makers ?? []).map((name) => ({ id: name, name })), debouncedMaker, makerFilter.applied),
    [facets, debouncedMaker, makerFilter.applied],
  )

  const availableCheckers = useMemo(
    () => narrowByName((facets?.checkers ?? []).map((name) => ({ id: name, name })), debouncedChecker, checkerFilter.applied),
    [facets, debouncedChecker, checkerFilter.applied],
  )

  /*
   * Module filter options: only modules that at least one request under the current filters belongs
   * to. (This once listed the platform's entire permission catalog, so most options returned
   * nothing.)
   */
  const availableModules = useMemo(() => {
    const list = (facets?.modules ?? [])
      .map((key) => ({ key, label: formatModuleName(key) }))
      .sort((a, b) => a.label.localeCompare(b.label))
    if (!moduleSearch.trim()) return list
    const q = moduleSearch.toLowerCase()
    return list.filter((m) => m.label.toLowerCase().includes(q) || m.key.toLowerCase().includes(q))
  }, [facets, moduleSearch])


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

  // Cached, and refreshed by live updates through the invalidation bridge.
  const summaryQuery = useQuery({
    queryKey: queryKeys.approvals.summary(),
    enabled: Boolean(accessToken),
    refetchInterval,
    queryFn: () => approvalsApi.summary(accessToken!),
  })
  const summary: ApprovalSummaryDto | null = summaryQuery.data ?? null


  const listParams = useMemo(() => ({ ...filterParams, page, pageSize }), [filterParams, page, pageSize])

  const fetcher = useCallback(
    async (token: string, signal?: AbortSignal) => {
      const res = await approvalsApi.list(token, listParams, signal)
      return { items: res.items, total: res.total }
    },
    [listParams],
  )


  const { items, total, error } = useApprovalRequests(accessToken, queryKeys.approvals.list(listParams), fetcher)

  /*
   * Record suggestions come from the rows on screen. A record label is unbounded free text, so a
   * DISTINCT over it is not a dropdown the server should build; the SUGGESTIONS narrow to this page
   * while the FILTER itself is server-side and complete. Enter applies anything typed.
   */
  const availableEntities = useMemo(() => {
    const set = new Set<string>()
    for (const r of items ?? []) {
      if (r.entityLabel) set.add(r.entityLabel)
    }
    const list = Array.from(set).sort((a, b) => a.localeCompare(b)).filter((e) => e !== recordFilter.applied)
    const q = debouncedEntity.toLowerCase().trim()
    return q ? list.filter((e) => e.toLowerCase().includes(q)) : list
  }, [items, debouncedEntity, recordFilter.applied])

  // Handler for the page-size preset or custom selection
  useEffect(() => {
    setPage(1)
  }, [
    activeTab, module, actionFilter, assignedToMeOnly,
    makerFilter.applied, recordFilter.applied, checkerFilter.applied, statusFilter,
    requestedRange, decidedRange,
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
      // Marks the list, its options, the summary and the badges stale everywhere (invalidation bridge).
      invalidate(TOPICS.approvals, TOPICS.kpis)
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
      invalidate(TOPICS.approvals, TOPICS.kpis)
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : 'Could not reject this request.')
    } finally {
      setDeciding(false)
    }
  }


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
    makerFilter.clear()
    setMakerSearchBlocked(false)
    recordFilter.clear()
    checkerFilter.clear()
    setCheckerSearchBlocked(false)
    setAssignedToMeOnly(false)
    setStatusFilter('')
    setRequestedRange(EMPTY_DATE_RANGE)
    setDecidedRange(EMPTY_DATE_RANGE)
  }

  /**
   * Exports the approval queue exactly as it is currently filtered — the same
   * {@link buildFilterParams} the table sends, every filter included.
   */
  async function handleExport() {
    if (!accessToken) return
    setExporting(true)
    setExportNotice(null)
    try {
      const result = await approvalsApi.exportCsv(accessToken, buildFilterParams())
      setExportNotice(describeTruncation(result))
    } catch (err) {
      setExportNotice(
        err instanceof CsvExportError ? err.message : 'The approval queue could not be exported.',
      )
    } finally {
      setExporting(false)
    }
  }

  const hasActiveFilters = Boolean(
    module || actionFilter || makerFilter.applied || recordFilter.applied || checkerFilter.applied || assignedToMeOnly ||
    isDateRangeActive(requestedRange) || isDateRangeActive(decidedRange) || statusFilter
  )

  return (
    <div className={styles.page}>
      {/* Header */}
      {/* Same banner component as Audit Logs — this page previously carried its own copy of the
          markup and CSS, which is how the two drifted apart in the first place. */}
      <PageHeader
        title="Approval Center"
        pill={
          <>
            <span className={styles.liveDot} />
            Live Governance
          </>
        }
        subtitle="Review and decide on pending administrative requests across the platform."
        actions={
          <div className={styles.headerActions}>
            {/* The shared control, replacing a hand-rolled preset row that anchored its custom
                range to UTC while every other screen anchored to local time. */}
            <DateRangeFilterButton
              label="Requested"
              value={requestedRange}
              onChange={setRequestedRange}
            />
            {/*
              The export this page never had.

              The Approval Center is the platform's record of every gated change and who decided it,
              and it was the only log-shaped screen with no export at all — producing evidence of a
              period's approvals meant taking screenshots. Gated on a capability of its own, because
              reading the queue on screen and carrying a copy of it off the platform are different
              decisions.
            */}
            <PermissionGate featureKey={FEATURE} capability="Export">
              <Button
                type="button"
                variant="onHeader"
                onClick={handleExport}
                disabled={exporting}
                leadingIcon={<Icon.Download width={15} height={15} />}
              >
                {exporting ? 'Exporting…' : 'Export CSV'}
              </Button>
            </PermissionGate>
          </div>
        }
      />

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
          {/* The shared control — same presets and Custom entry this page defined, now with the
              choice remembered per table so it survives navigation and reload. */}
          <RowsPerPage
            storageKey="host.approvals"
            value={pageSize}
            onChange={(n) => {
              setPageSize(n)
              setPage(1)
            }}
          />

          <label className={styles.assignedToMeToggle}>
            <input type="checkbox" checked={assignedToMeOnly} onChange={(e) => setAssignedToMeOnly(e.target.checked)} />
            <span>Assigned to me</span>
          </label>

          <button type="button" className={styles.refreshBtn} onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() })}>
            <Icon.Activity width={15} height={15} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {exportNotice && (
        <div className={styles.exportNotice} role="status">{exportNotice}</div>
      )}

      {/* Active filters chip banner */}
      {hasActiveFilters && (
        <div className={styles.activeFiltersBar}>
          <span className={styles.activeFiltersLabel}>Filters:</span>
          {isDateRangeActive(requestedRange) && (
            <span className={styles.filterChip}>
              <span>Requested: {describeDateRange(requestedRange)}</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => setRequestedRange(EMPTY_DATE_RANGE)} aria-label="Remove requested date filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {isDateRangeActive(decidedRange) && (
            <span className={styles.filterChip}>
              <span>Decided: {describeDateRange(decidedRange)}</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => setDecidedRange(EMPTY_DATE_RANGE)} aria-label="Remove decided date filter">
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
              <span>Module: {formatModuleName(module)}</span>
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
          {recordFilter.applied && (
            <span className={styles.filterChip}>
              <span>Entity: "{recordFilter.applied}"</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => recordFilter.clear()} aria-label="Remove entity filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {makerFilter.applied && (
            <span className={styles.filterChip}>
              <span>Maker: "{makerFilter.applied}"</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => { makerFilter.clear(); setMakerSearchBlocked(false) }} aria-label="Remove maker filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {checkerFilter.applied && (
            <span className={styles.filterChip}>
              <span>Checker: "{checkerFilter.applied}"</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => { checkerFilter.clear(); setCheckerSearchBlocked(false) }} aria-label="Remove checker filter">
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

      {/* Table — shared chrome. This page's own `.tableContainer`/`.logTable` were a byte-for-byte
          copy of the Audit Logs pair (only min-width differed), which is exactly the duplication
          @omniconnect/ui's DataTable exists to remove. */}
      <DataTable reserveHeight footer={<Pagination page={page} pageSize={pageSize} total={total ?? 0} itemLabel="request" onPageChange={setPage} />}>
          <ResponsiveRows
            rows={items ?? []}
            rowKey={(r) => String(r.id)}
            loading={items === null}
            loadingRows={pageSize}
            empty="No approval requests found matching the selected filters."
            columns={[
                {
                  key: 'requested',
                  label: 'REQUESTED',
                  priority: 'always',
                  // The shared control, replacing ~65 lines of hand-rolled popover that duplicated
                  // the header button group above it and disagreed with it about custom ranges.
                  header: (
                    <DateRangeColumnFilter
                      key="requested"
                      label="REQUESTED"
                      value={requestedRange}
                      onChange={setRequestedRange}
                    />
                  ),
                  render: (r) => <span className={styles.timeCell}>{formatDateOnly(r.requestedAt)}</span>,
                },
                {
                  key: 'module',
                  label: 'MODULE',
                  priority: 'high',
                  header: (
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
                  ),
                  render: (r) => <Badge tone="info">{formatModuleName(r.module)}</Badge>,
                },
                {
                  key: 'action',
                  label: 'ACTION',
                  priority: 'always',
                  header: (
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
                  ),
                  render: (r) => {
                    const ActionIcon = ACTION_ICONS[r.action] ?? Icon.Edit
                    return (
                      <span className={`${styles.actionCell} ${styles[`action_${r.action}`] ?? ''}`}>
                        <ActionIcon width={12} height={12} />
                        <span>{ACTION_LABELS[r.action] ?? r.action}</span>
                      </span>
                    )
                  },
                },
                {
                  key: 'entity',
                  label: 'ENTITY',
                  priority: 'high',
                  header: (
                    <th className={styles.thFilterable}>
                      <button
                        type="button"
                        className={`${styles.thFilterBtn} ${recordFilter.applied ? styles.thFilterBtnActive : ''}`}
                        onClick={() => setActiveHeaderFilter((c) => (c === 'entity' ? null : 'entity'))}
                      >
                        <span>RECORD</span>
                        <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'entity' ? styles.filterIconActive : ''}`} />
                        {recordFilter.applied && <span className={styles.filterDot} />}
                      </button>
                      {activeHeaderFilter === 'entity' && (
                        <div className={styles.filterPopover}>
                          <div className={styles.popoverHeader}>
                            <span className={styles.popoverTitle}>Search Entity</span>
                            {recordFilter.applied && <button type="button" className={styles.popoverClearBtn} onClick={() => recordFilter.clear()}>Reset</button>}
                          </div>
                          <input
                            type="text"
                            className={styles.popoverInput}
                            placeholder="Filter by entity name/ID..."
                            value={recordFilter.query}
                            onChange={(e) => recordFilter.setQuery(e.target.value)}
                            onKeyDown={commitOnEnter(recordFilter)}
                            autoFocus
                          />
                          {availableEntities.length > 0 && (
                            <>
                              <div className={styles.popoverDivider} />
                              <span className={styles.customDateLabel}>Known Records:</span>
                              <div className={styles.popoverList}>
                                {availableEntities.map((e) => (
                                  <button
                                    key={e}
                                    type="button"
                                    className={`${styles.popoverItem} ${recordFilter.applied === e ? styles.popoverItemActive : ''}`}
                                    onClick={() => { recordFilter.commit(e); setActiveHeaderFilter(null) }}
                                  >
                                    <span>{e}</span>
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </th>
                  ),
                  render: (r) =>
                    r.entityLabel ? (
                      <span className={styles.entityLabel}>{r.entityLabel}</span>
                    ) : (
                      <span className={styles.mutedText}>{EMPTY_VALUE}</span>
                    ),
                },
                {
                  key: 'maker',
                  label: 'MAKER',
                  priority: 'low',
                  header: (
                    <th className={styles.thFilterable}>
                      <button
                        type="button"
                        className={`${styles.thFilterBtn} ${makerFilter.applied ? styles.thFilterBtnActive : ''}`}
                        onClick={() => setActiveHeaderFilter((c) => (c === 'maker' ? null : 'maker'))}
                      >
                        <span>MAKER</span>
                        <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'maker' ? styles.filterIconActive : ''}`} />
                        {makerFilter.applied && <span className={styles.filterDot} />}
                      </button>
                      {activeHeaderFilter === 'maker' && (
                        <div className={styles.filterPopover}>
                          <div className={styles.popoverHeader}>
                            <span className={styles.popoverTitle}>Filter Maker</span>
                            {makerFilter.applied && <button type="button" className={styles.popoverClearBtn} onClick={() => { makerFilter.clear(); setMakerSearchBlocked(false) }}>Reset</button>}
                          </div>
                          <input
                            type="text"
                            inputMode="text"
                            className={`${styles.popoverInput} ${makerSearchBlocked ? styles.popoverInputBlocked : ''}`}
                            placeholder="Search maker name..."
                            value={makerFilter.query}
                            onChange={(e) => handleMakerSearchChange(e.target.value)}
                            onKeyDown={commitOnEnter(makerFilter)}
                            autoFocus
                          />
                          {makerSearchBlocked && (
                            <p className={styles.blockedHint} role="alert">{filterTypeBlockedMessage('alpha')}</p>
                          )}
                          {availableMakers.length > 0 && (
                            <>
                              <div className={styles.popoverDivider} />
                              <span className={styles.customDateLabel}>Known Makers:</span>
                              <div className={styles.userListSection}>
                                {availableMakers.map((m) => (
                                  <button
                                    key={m.id || m.name}
                                    type="button"
                                    className={`${styles.userItem} ${makerFilter.applied.toLowerCase() === m.name.toLowerCase() ? styles.userItemActive : ''}`}
                                    onClick={() => { makerFilter.commit(m.name); setActiveHeaderFilter(null) }}
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
                  ),
                  render: (r) =>
                    r.makerName ? (
                      <div className={styles.actorCell}>
                        <span className={styles.actorAvatar}>{r.makerName.charAt(0).toUpperCase()}</span>
                        <span className={styles.actorName}>{r.makerName}</span>
                      </div>
                    ) : (
                      <span className={styles.mutedText}>Unknown</span>
                    ),
                },
                {
                  key: 'checker',
                  label: 'CHECKER',
                  priority: 'low',
                  header: (
                    <th className={styles.thFilterable}>
                      <button
                        type="button"
                        className={`${styles.thFilterBtn} ${assignedToMeOnly || checkerFilter.applied ? styles.thFilterBtnActive : ''}`}
                        onClick={() => setActiveHeaderFilter((c) => (c === 'checker' ? null : 'checker'))}
                      >
                        <span>CHECKER</span>
                        <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'checker' ? styles.filterIconActive : ''}`} />
                        {(assignedToMeOnly || checkerFilter.applied) && <span className={styles.filterDot} />}
                      </button>
                      {activeHeaderFilter === 'checker' && (
                        <div className={`${styles.filterPopover} ${styles.popoverRight}`}>
                          <div className={styles.popoverHeader}>
                            <span className={styles.popoverTitle}>Filter Checker</span>
                            {(assignedToMeOnly || checkerFilter.applied) && (
                              <button
                                type="button"
                                className={styles.popoverClearBtn}
                                onClick={() => { setAssignedToMeOnly(false); checkerFilter.clear() }}
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
                            inputMode="text"
                            className={`${styles.popoverInput} ${checkerSearchBlocked ? styles.popoverInputBlocked : ''}`}
                            placeholder="Search checker name..."
                            value={checkerFilter.query}
                            onChange={(e) => handleCheckerSearchChange(e.target.value)}
                            onKeyDown={commitOnEnter(checkerFilter)}
                          />
                          {checkerSearchBlocked && (
                            <p className={styles.blockedHint} role="alert">{filterTypeBlockedMessage('alpha')}</p>
                          )}
                          {availableCheckers.length > 0 && (
                            <>
                              <div className={styles.popoverDivider} />
                              <span className={styles.customDateLabel}>Known Checkers:</span>
                              <div className={styles.userListSection}>
                                {availableCheckers.map((c) => (
                                  <button
                                    key={c.id || c.name}
                                    type="button"
                                    className={`${styles.userItem} ${checkerFilter.applied.toLowerCase() === c.name.toLowerCase() ? styles.userItemActive : ''}`}
                                    onClick={() => { checkerFilter.commit(c.name); setActiveHeaderFilter(null) }}
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
                  ),
                  render: (r) =>
                    r.checkerName ? (
                      <div className={styles.actorCell}>
                        <span className={`${styles.actorAvatar} ${styles.checkerAvatar}`}>
                          {r.checkerName.charAt(0).toUpperCase()}
                        </span>
                        <span className={styles.actorName}>{r.checkerName}</span>
                      </div>
                    ) : (
                      <span className={styles.unassignedChip}>Unassigned</span>
                    ),
                },
                {
                  key: 'status',
                  label: 'STATUS',
                  priority: 'always',
                  header: (
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
                  ),
                  render: (r) => <Badge tone={STATUS_TONES[r.status]} dot>{r.status}</Badge>,
                },
                {
                  key: 'decided',
                  label: 'DECIDED',
                  priority: 'low',
                  // Now a server-side filter, not a client-side one over the fetched page — so
                  // "decided last week" finally reaches requests this page has not loaded.
                  header: (
                    <DateRangeColumnFilter
                      key="decided"
                      label="DECIDED"
                      value={decidedRange}
                      onChange={setDecidedRange}
                    />
                  ),
                  render: (r) => (
                    <span className={styles.timeCell}>
                      {r.decidedAt ? formatDateOnly(r.decidedAt) : <span className={styles.mutedText}>{EMPTY_VALUE}</span>}
                    </span>
                  ),
                },
                {
                  key: 'actions',
                  label: 'Actions',
                  priority: 'always',
                  align: 'right',
                  render: (r) => (
                    <RowAction
                      onClick={() => handleRowClick(r)}
                      trailing={<Icon.ChevronRight width={12} height={12} />}
                    />
                  ),
                },
            ]}
          />
      </DataTable>

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
                                <dd><Badge tone="info">{formatModuleName(detail.module)}</Badge></dd>
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
                                   <dt>Record</dt>
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
                always visible at the bottom of the drawer regardless of scroll position. The two
                decisions fill the row edge-to-edge as equal, deliberate targets — this is the one
                thing a checker is here to do, not a toolbar sharing space with an unrelated action.
                ("Edit" previously sat here as an inert label with no handler — a maker-checker
                approval is reviewed and decided, not edited from inside the review itself.)
                Row-level check (isMyDecisionToMake) instead of PermissionGate — an admin who isn't
                the specific assigned checker must not see actionable buttons on someone else's request.
              */}
              {isMyDecisionToMake && detail && (
                <div className={styles.detailFooter}>
                  {!rejecting ? (
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
