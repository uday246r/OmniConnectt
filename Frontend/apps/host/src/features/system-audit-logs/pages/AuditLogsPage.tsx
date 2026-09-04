import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthStore } from '../../auth/store/authStore'
import { TOPICS, useDataRevision } from '../../../shared/stores/invalidationStore'
import { ActorCell, Badge, DataTable, DetailField, DetailGrid, DetailSection, EMPTY_VALUE, FilterBar, PageHeader, Pagination, ResponsiveRows, RowAction, RowsPerPage, formatAuditTimestamp, readStoredPageSize, sanitizeFilterInput, filterTypeBlockedMessage, type ActiveFilter, type BadgeTone } from '@omniremit/ui'
import { PermissionGate } from '../../../shared/components/PermissionGate/PermissionGate'
import { ApiError } from '../../../shared/api/httpClient'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue'
import { auditLogsApi, type AuditLogDto, type AuditLogSummaryDto } from '../api/auditLogsApi'
import { Icon } from '../../../shared/components/Icon/Icon'
// Same generated classes the Settings drawer and the System Audit Trail deep-link render from — reused
// here so a single record's details open as the identical right-side drawer shell used everywhere else
// in the host, rather than introducing a third drawer look.
import drawerStyles from '../../../layout/SettingsDrawer/SettingsDrawer.module.css'
import styles from './AuditLogsPage.module.css'

const FEATURE = 'host.system.audit-logs'
const DEFAULT_PAGE_SIZE = 10

const SERVICE_TONES: Record<string, BadgeTone> = {
  AuthService: 'primary',
  ModuleRegistry: 'info',
  LeadService: 'warning',
  Customer360Service: 'success',
}

function serviceTone(serviceName: string): BadgeTone {
  return SERVICE_TONES[serviceName] ?? 'neutral'
}

// Raw actions arrive as backend event names ("auth.login_succeeded", "remoteapp.deleted") — accurate
// for logs, unreadable for the person reviewing them. Known actions get an exact, hand-written label;
// anything not in the map yet still gets turned into words instead of showing raw dot/underscore
// notation, so a new action type added later degrades gracefully rather than looking broken.
const ACTION_LABELS: Record<string, string> = {
  'auth.login_succeeded': 'Login Succeeded',
  'auth.login_failed': 'Login Failed',
  'remoteapp.created': 'Remote App Registered',
  'remoteapp.updated': 'Remote App Updated',
  'remoteapp.deleted': 'Remote App Removed',
  'remoteapp.status_changed': 'Remote App Status Changed',
  'employee.created': 'Employee Created',
  'employee.updated': 'Employee Updated',
  'employee.deleted': 'Employee Deleted',
  'lead.created': 'Lead Created',
  'lead.updated': 'Lead Updated',
  'lead.deleted': 'Lead Deleted',
}

function formatActionLabel(action: string): string {
  if (!action) return 'Unknown Action'
  const known = ACTION_LABELS[action]
  if (known) return known
  const segment = action.includes('.') ? action.slice(action.lastIndexOf('.') + 1) : action
  return segment
    .replace(/_/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

/** Maps a raw backend action key to one of the actionCell colour-variant CSS classes. */
function actionChipClass(action: string): 'actionSuccess' | 'actionDanger' | 'actionWarning' | 'actionLogin' | 'actionNeutral' {
  const a = action.toLowerCase()
  if (a.includes('login_succeeded') || a.includes('login_success')) return 'actionSuccess'
  if (a.includes('login_failed') || a.includes('login_fail')) return 'actionDanger'
  if (a.includes('created') || a.includes('registered')) return 'actionSuccess'
  if (a.includes('deleted') || a.includes('removed') || a.includes('unregistered')) return 'actionDanger'
  if (a.includes('status_changed') || a.includes('maintenance')) return 'actionWarning'
  if (a.includes('updated') || a.includes('changed') || a.includes('modified')) return 'actionLogin'
  return 'actionNeutral'
}

/* Audit timestamps come from @omniremit/ui so the two remotes render the same shape. */
const formatTimestamp = formatAuditTimestamp


interface ParsedUserAgent {
  browser: string
  os: string
}

function parseUserAgent(ua?: string | null): ParsedUserAgent | null {
  if (!ua) return null
  let browser = 'Browser'
  let os = 'Device'

  // OS detection
  if (/Windows NT 10.0|Windows NT 11/i.test(ua)) os = 'Windows 10/11'
  else if (/Windows/i.test(ua)) os = 'Windows'
  else if (/iPhone|iPad/i.test(ua)) os = 'iOS'
  else if (/Android/i.test(ua)) os = 'Android'
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS'
  else if (/Linux/i.test(ua)) os = 'Linux'

  // Browser detection (order matters: Edge contains Chrome, Chrome contains Safari)
  if (/Edg\/([\d.]+)/i.test(ua)) {
    const m = ua.match(/Edg\/([\d.]+)/i)
    browser = m ? `Edge ${m[1].split('.')[0]}` : 'Edge'
  } else if (/Chrome\/([\d.]+)/i.test(ua)) {
    const m = ua.match(/Chrome\/([\d.]+)/i)
    browser = m ? `Chrome ${m[1].split('.')[0]}` : 'Chrome'
  } else if (/Firefox\/([\d.]+)/i.test(ua)) {
    const m = ua.match(/Firefox\/([\d.]+)/i)
    browser = m ? `Firefox ${m[1].split('.')[0]}` : 'Firefox'
  } else if (/Version\/([\d.]+).*Safari/i.test(ua)) {
    const m = ua.match(/Version\/([\d.]+)/i)
    browser = m ? `Safari ${m[1].split('.')[0]}` : 'Safari'
  } else if (/Safari/i.test(ua)) {
    browser = 'Safari'
  }

  return { browser, os }
}

function formatIpv4(ip?: string | null): string {
  if (!ip) return '—'
  let trimmed = ip.trim()
  if (trimmed === '::1' || trimmed === 'localhost') {
    return '127.0.0.1'
  }
  if (trimmed.startsWith('::ffff:')) {
    trimmed = trimmed.substring(7)
  }
  if (trimmed === '::') {
    return '127.0.0.1'
  }
  return trimmed
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

const TAB_IDS = {
  loginErrors: 'login-errors',
  loginSuccesses: 'login-successes',
  auditEvents: 'audit-events',
} as const

type TabId = (typeof TAB_IDS)[keyof typeof TAB_IDS]

const TAB_ACTION_FILTER: Record<TabId, string | undefined> = {
  [TAB_IDS.loginErrors]: 'auth.login_failed',
  [TAB_IDS.loginSuccesses]: 'auth.login_succeeded',
  [TAB_IDS.auditEvents]: undefined,
}

export function AuditLogsPage() {
  const accessToken = useAuthStore((s) => s.accessToken)

  // Defaults to all activity, not to failures. See the tablist below for why.
  const [activeTab, setActiveTab] = useState<TabId>(TAB_IDS.auditEvents)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => readStoredPageSize('host.audit', DEFAULT_PAGE_SIZE))

  // Popover state
  const [activeHeaderFilter, setActiveHeaderFilter] = useState<string | null>(null)

  // Date Filter
  const [dateRange, setDateRange] = useState<DateFilterMode>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [customDraftFrom, setCustomDraftFrom] = useState('')
  const [customDraftTo, setCustomDraftTo] = useState('')

  // Service filter & search
  const [service, setService] = useState('')
  const [serviceSearch, setServiceSearch] = useState('')

  // Actor search — a person's name, so only letters are accepted; `actorSearchBlocked` flags the
  // instant after a keystroke that got stripped, driving a "why won't it let me type that" hint.
  const [actorSearch, setActorSearch] = useState('')
  const [actorSearchBlocked, setActorSearchBlocked] = useState(false)
  function handleActorSearchChange(raw: string) {
    const clean = sanitizeFilterInput(raw, 'alpha')
    setActorSearch(clean)
    setActorSearchBlocked(clean !== raw)
  }

  // Action filter & search
  const [actionFilter, setActionFilter] = useState('')
  const [actionSearch, setActionSearch] = useState('')

  // Entity search
  const [entitySearch, setEntitySearch] = useState('')

  // Sign-in specific filters
  const [authMethodFilter, setAuthMethodFilter] = useState('')
  // An IPv4 address is digits and dots only.
  const [ipSearch, setIpSearch] = useState('')
  const [ipSearchBlocked, setIpSearchBlocked] = useState(false)
  function handleIpSearchChange(raw: string) {
    const clean = sanitizeFilterInput(raw, 'numeric')
    setIpSearch(clean)
    setIpSearchBlocked(clean !== raw)
  }
  const [deviceSearch, setDeviceSearch] = useState('')
  const [resultFilter, setResultFilter] = useState<'' | 'Success' | 'Failure'>('')

  // In-memory cached pool to extract available unique options with 0 extra API calls
  const [cachedPool, setCachedPool] = useState<AuditLogDto[]>([])

  const debouncedService = useDebouncedValue(service, 200)
  const debouncedActor = useDebouncedValue(actorSearch, 200)
  const debouncedEntity = useDebouncedValue(entitySearch, 200)
  const debouncedIp = useDebouncedValue(ipSearch, 200)
  const debouncedDevice = useDebouncedValue(deviceSearch, 200)

  const [summary, setSummary] = useState<AuditLogSummaryDto | null>(null)
  const [logs, setLogs] = useState<AuditLogDto[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [viewingLog, setViewingLog] = useState<AuditLogDto | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const dataRevision = useDataRevision(TOPICS.auditLogs)
  const prevDepsRef = useRef<unknown[] | null>(null)

  const range = useMemo(() => computeRangeWithCustom(dateRange, customFrom, customTo), [dateRange, customFrom, customTo])

  // Zero extra API call: extract unique actors from loaded items
  const availableActors = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    for (const r of cachedPool) {
      const name = r.actorName || r.actorUserId
      if (name) map.set(name.toLowerCase(), { id: r.actorUserId || r.id, name })
    }
    return Array.from(map.values())
  }, [cachedPool])

  /*
   * Services, actions and sign-in methods actually present in the loaded rows — nothing else.
   *
   * These three used to seed themselves from hardcoded lists (a KNOWN_SERVICES array, every key in
   * ACTION_LABELS, six auth methods) and then add whatever the data contained. That offered options
   * no row could ever match: picking "EmployeeService" — a service with no frontend in this repo at
   * all — filtered the table to nothing and read as a broken filter rather than an empty service.
   * A column filter should only offer values that column holds.
   *
   * ACTION_LABELS is still the raw→friendly mapping used by formatActionLabel; it is just no longer
   * treated as a list of things to offer.
   */
  const availableServices = useMemo(() => {
    const set = new Set<string>()
    for (const r of cachedPool) {
      if (r.serviceName) set.add(r.serviceName)
    }
    const list = Array.from(set).sort((a, b) => a.localeCompare(b))
    if (!serviceSearch.trim()) return list
    const q = serviceSearch.toLowerCase()
    return list.filter((s) => s.toLowerCase().includes(q))
  }, [cachedPool, serviceSearch])

  const availableActions = useMemo(() => {
    const set = new Set<string>()
    for (const r of cachedPool) {
      if (r.action) set.add(r.action)
    }

    const entries = Array.from(set).map((a) => ({ raw: a, label: formatActionLabel(a) }))

    /*
     * Several distinct actions share one friendly label: formatActionLabel falls back to the last
     * segment, so user.created, role.created and checker_assignment.created all read "Created".
     * Each still filters to a different action, so the list showed three identical options that did
     * three different things. Qualify only the colliding ones with the record they act on —
     * "Created (User)" — rather than exposing the raw dotted key.
     */
    const labelCounts = new Map<string, number>()
    for (const entry of entries) labelCounts.set(entry.label, (labelCounts.get(entry.label) ?? 0) + 1)

    const list = entries
      .map((entry) => {
        if ((labelCounts.get(entry.label) ?? 0) < 2 || !entry.raw.includes('.')) return entry
        const entity = entry.raw
          .slice(0, entry.raw.lastIndexOf('.'))
          .replace(/[._-]/g, ' ')
          .trim()
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ')
        return { raw: entry.raw, label: entity ? `${entry.label} (${entity})` : entry.label }
      })
      .sort((a, b) => a.label.localeCompare(b.label))

    if (!actionSearch.trim()) return list
    const q = actionSearch.toLowerCase()
    return list.filter((a) => a.label.toLowerCase().includes(q) || a.raw.toLowerCase().includes(q))
  }, [cachedPool, actionSearch])

  const availableAuthMethods = useMemo(() => {
    const set = new Set<string>()
    for (const r of cachedPool) {
      if (r.authMethod) set.add(r.authMethod)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [cachedPool])

  // Zero extra API call: extract unique IPv4 addresses
  const availableIps = useMemo(() => {
    const set = new Set<string>()
    for (const r of cachedPool) {
      if (r.sourceIp) {
        const clean = formatIpv4(r.sourceIp)
        if (clean && clean !== '—') set.add(clean)
      }
    }
    const list = Array.from(set)
    if (!ipSearch.trim()) return list
    const q = ipSearch.toLowerCase()
    return list.filter((ip) => ip.toLowerCase().includes(q))
  }, [cachedPool, ipSearch])

  // Zero extra API call: extract unique browser and OS / device options
  const availableDevices = useMemo(() => {
    const browserSet = new Set<string>()
    const osSet = new Set<string>()
    for (const r of cachedPool) {
      if (r.userAgent) {
        const parsed = parseUserAgent(r.userAgent)
        if (parsed) {
          if (parsed.browser && parsed.browser !== 'Browser') browserSet.add(parsed.browser)
          if (parsed.os && parsed.os !== 'Device') osSet.add(parsed.os)
        }
      }
    }
    if (browserSet.size === 0) {
      ;['Chrome', 'Edge', 'Firefox', 'Safari'].forEach((b) => browserSet.add(b))
    }
    if (osSet.size === 0) {
      ;['Windows', 'macOS', 'Linux', 'iOS', 'Android'].forEach((o) => osSet.add(o))
    }
    const browsers = Array.from(browserSet)
    const oses = Array.from(osSet)

    const filterList = (arr: string[]) => {
      if (!deviceSearch.trim()) return arr
      const q = deviceSearch.toLowerCase()
      return arr.filter((item) => item.toLowerCase().includes(q))
    }

    return {
      browsers: filterList(browsers),
      oses: filterList(oses),
    }
  }, [cachedPool, deviceSearch])

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

  useEffect(() => {
    if (!viewingLog) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewingLog(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewingLog])

  const loadSummary = useCallback(async () => {
    if (!accessToken) return
    try {
      const result = await auditLogsApi.summary(accessToken, range)
      setSummary(result)
    } catch {
      // Ignore
    }
  }, [accessToken, range])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary, dataRevision])

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false

    const activeDeps = [
      page, pageSize, debouncedService, activeTab, actionFilter,
      resultFilter, authMethodFilter, debouncedActor, debouncedEntity,
      debouncedIp, debouncedDevice, range, dateRange, customFrom, customTo, refreshKey,
    ]

    const activeDepsChanged =
      prevDepsRef.current === null ||
      prevDepsRef.current.length !== activeDeps.length ||
      activeDeps.some((dep, i) => dep !== prevDepsRef.current![i])

    prevDepsRef.current = activeDeps

    if (activeDepsChanged) {
      setLogs(null)
    }
    setError(null)

    async function load() {
      try {
        const effectiveAction = actionFilter || TAB_ACTION_FILTER[activeTab]
        const effectiveResult = resultFilter || (activeTab === TAB_IDS.loginErrors ? 'Failure' : activeTab === TAB_IDS.loginSuccesses ? 'Success' : undefined)

        const result = await auditLogsApi.list(accessToken!, {
          page: 1,
          pageSize: 200,
          service: debouncedService || undefined,
          action: effectiveAction,
          result: effectiveResult,
          ...range,
        })
        if (cancelled) return

        let allItems = result.items

        // Update cached pool (capped at 2000 entries to bound memory growth)
        setCachedPool((prev) => {
          const map = new Map<string, AuditLogDto>()
          for (const item of prev) map.set(item.id, item)
          for (const item of allItems) map.set(item.id, item)
          const list = Array.from(map.values())
          return list.length > 2000 ? list.slice(-2000) : list
        })

        // Client-side precision filtering
        if (dateRange === 'custom') {
          allItems = allItems.filter((r) => matchesDateRange(r.occurredAt, dateRange, customFrom, customTo))
        }
        if (debouncedActor) {
          const q = debouncedActor.toLowerCase()
          allItems = allItems.filter((r) =>
            (r.actorName && r.actorName.toLowerCase().includes(q)) ||
            (r.actorUserId && r.actorUserId.toLowerCase().includes(q))
          )
        }
        if (debouncedEntity) {
          const q = debouncedEntity.toLowerCase()
          allItems = allItems.filter((r) =>
            (r.entityType && r.entityType.toLowerCase().includes(q)) ||
            (r.entityLabel && r.entityLabel.toLowerCase().includes(q)) ||
            (r.entityId && r.entityId.toLowerCase().includes(q))
          )
        }
        if (authMethodFilter) {
          allItems = allItems.filter((r) => r.authMethod?.toLowerCase() === authMethodFilter.toLowerCase())
        }
        if (debouncedIp) {
          const q = debouncedIp.toLowerCase()
          allItems = allItems.filter((r) => {
            const raw = r.sourceIp?.toLowerCase() || ''
            const formatted = formatIpv4(r.sourceIp).toLowerCase()
            return raw.includes(q) || formatted.includes(q)
          })
        }
        if (debouncedDevice) {
          const q = debouncedDevice.toLowerCase()
          allItems = allItems.filter((r) => {
            if (!r.userAgent) return false
            const raw = r.userAgent.toLowerCase()
            const parsed = parseUserAgent(r.userAgent)
            const browser = parsed?.browser.toLowerCase() || ''
            const os = parsed?.os.toLowerCase() || ''
            return raw.includes(q) || browser.includes(q) || os.includes(q)
          })
        }
        if (resultFilter) {
          allItems = allItems.filter((r) => r.result === resultFilter)
        }

        const totalCount = allItems.length
        const start = (page - 1) * pageSize
        setLogs(allItems.slice(start, start + pageSize))
        setTotal(totalCount)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load audit logs.')
        setLogs([])
        setTotal(0)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [
    accessToken, page, pageSize, debouncedService, activeTab, actionFilter,
    resultFilter, authMethodFilter, debouncedActor, debouncedEntity,
    debouncedIp, debouncedDevice, range, dateRange, customFrom, customTo, refreshKey,
    dataRevision,
  ])

  // Changing the filter or page size invalidates the page number.
  useEffect(() => {
    setPage(1)
  }, [
    activeTab, dateRange, customFrom, customTo, debouncedService,
    actionFilter, resultFilter, authMethodFilter, debouncedActor,
    debouncedEntity, debouncedIp, debouncedDevice, pageSize,
  ])

  async function handleExport() {
    if (!accessToken) return
    setExporting(true)
    setError(null)
    try {
      await auditLogsApi.exportCsv(accessToken, {
        service: debouncedService || undefined,
        action: actionFilter || TAB_ACTION_FILTER[activeTab],
        result: resultFilter || (activeTab === TAB_IDS.loginErrors ? 'Failure' : activeTab === TAB_IDS.loginSuccesses ? 'Success' : undefined),
        ...range,
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not export audit logs.')
    } finally {
      setExporting(false)
    }
  }

  // Handler for the page-size preset or custom selection
  function clearAllFilters() {
    setService('')
    setServiceSearch('')
    setActorSearch('')
    setActionFilter('')
    setActionSearch('')
    setEntitySearch('')
    setAuthMethodFilter('')
    setIpSearch('')
    setDeviceSearch('')
    setResultFilter('')
    setDateRange('all')
    setCustomFrom('')
    setCustomTo('')
    setCustomDraftFrom('')
    setCustomDraftTo('')
  }

  const isLoginTab = activeTab === TAB_IDS.loginErrors || activeTab === TAB_IDS.loginSuccesses

  return (
    <div className={styles.page}>
      {/* Header */}
      {/* This page's banner IS the platform reference — PageHeader was derived from it, so moving it
          onto the shared component is byte-for-byte identical here and brings the three copies that
          had drifted from it (Approval Center, and both of lead_mf's) into line. */}
      <PageHeader
        title="Audit Logs"
        pill={
          <>
            <span className={styles.liveDot} />
            Live Stream
          </>
        }
        subtitle="Comprehensive real-time log of authentication events and administrative platform activities."
        actions={
          <div className={styles.dateRangeGroup} role="group" aria-label="Date range">
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
        }
      />

      {/* 4 Summary Stat Cards */}
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconGreen}`}>
            <Icon.CheckCircle width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Login Successes</span>
            <span className={styles.summaryValue}>{summary?.loginSuccesses ?? '0'}</span>
          </div>
        </div>

        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconRed}`}>
            <Icon.AlertCircle width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Login Errors</span>
            <span className={styles.summaryValue}>{summary?.loginErrors ?? '0'}</span>
          </div>
        </div>

        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconBlue}`}>
            <Icon.FileText width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Audit Events</span>
            <span className={styles.summaryValue}>{summary?.totalAuditEvents ?? '0'}</span>
          </div>
        </div>

        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconPurple}`}>
            <Icon.Users width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Active Users</span>
            <span className={styles.summaryValue}>{summary?.activeUsers ?? '0'}</span>
          </div>
        </div>
      </div>

      {/* Tabs & Filter Bar */}
      <div className={styles.navBar}>
        <div className={styles.tabsList} role="tablist" aria-label="Audit log views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === TAB_IDS.auditEvents}
            className={`${styles.tabBtn} ${activeTab === TAB_IDS.auditEvents ? styles.tabActive : ''}`}
            onClick={() => { setActiveTab(TAB_IDS.auditEvents); setResultFilter('') }}
          >
            All Activity
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === TAB_IDS.loginSuccesses}
            className={`${styles.tabBtn} ${activeTab === TAB_IDS.loginSuccesses ? styles.tabActive : ''}`}
            onClick={() => { setActiveTab(TAB_IDS.loginSuccesses); setResultFilter('') }}
          >
            Sign-ins
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === TAB_IDS.loginErrors}
            className={`${styles.tabBtn} ${activeTab === TAB_IDS.loginErrors ? styles.tabActive : ''}`}
            onClick={() => { setActiveTab(TAB_IDS.loginErrors); setResultFilter('') }}
          >
            Failed Sign-ins
          </button>
        </div>

        <div className={styles.toolbarActions}>
          {/* Rows-per-page dropdown */}
          {/* The shared control — same presets and Custom entry this page defined, now with the
              choice remembered per table so it survives navigation and reload. */}
          <RowsPerPage
            storageKey="host.audit"
            value={pageSize}
            onChange={(n) => {
              setPageSize(n)
              setPage(1)
            }}
          />

          <button
            type="button"
            className={styles.refreshBtn}
            onClick={() => {
              setRefreshKey((k) => k + 1)
              void loadSummary()
            }}
            title="Refresh Logs"
          >
            <Icon.Activity width={15} height={15} />
            <span>Refresh</span>
          </button>

          <PermissionGate featureKey={FEATURE} capability="Export">
            <button
              type="button"
              className={styles.exportBtn}
              onClick={() => void handleExport()}
              disabled={exporting}
            >
              <Icon.FileText width={15} height={15} />
              <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
            </button>
          </PermissionGate>
        </div>
      </div>

      {/* The shared FilterBar. This page WAS the only implementation of this control; it is now
          the shared one, so every table in the platform can show what it is filtered by. */}
      <FilterBar
        filters={[
          dateRange !== 'all' && {
            key: 'time',
            label: 'Time',
            value:
              dateRange === 'custom'
                ? `${customFrom || '…'} to ${customTo || '…'}`
                : (DATE_RANGES.find((d) => d.key === dateRange)?.label ?? dateRange),
            onRemove: () => {
              setDateRange('all')
              setCustomFrom('')
              setCustomTo('')
            },
          },
          service && { key: 'service', label: 'Service', value: service, onRemove: () => setService('') },
          actorSearch && { key: 'actor', label: 'Performed By', value: `"${actorSearch}"`, onRemove: () => setActorSearch('') },
          actionFilter && { key: 'action', label: 'Action', value: actionFilter, onRemove: () => setActionFilter('') },
          entitySearch && { key: 'entity', label: 'Record', value: `"${entitySearch}"`, onRemove: () => setEntitySearch('') },
          authMethodFilter && { key: 'auth', label: 'Auth', value: authMethodFilter, onRemove: () => setAuthMethodFilter('') },
          ipSearch && { key: 'ip', label: 'IP', value: `"${ipSearch}"`, onRemove: () => setIpSearch('') },
          deviceSearch && { key: 'device', label: 'Device', value: `"${deviceSearch}"`, onRemove: () => setDeviceSearch('') },
          resultFilter && { key: 'result', label: 'Result', value: resultFilter, onRemove: () => setResultFilter('') },
        ].filter(Boolean) as ActiveFilter[]}
        onClearAll={clearAllFilters}
      />

      {error && <div className={styles.errorBanner}>{error}</div>}

      {/* Logs Table — chrome from @omniremit/ui so the host, Approval Center and both remotes all
          render the same table. This page's own `.tableContainer`/`.logTable` were the origin of
          that shared style; the duplicate copy in ApprovalCenterPage.module.css is now gone too. */}
      <DataTable reserveHeight footer={<Pagination page={page} pageSize={pageSize} total={total} itemLabel="event" onPageChange={setPage} />}>
          <ResponsiveRows
            rows={logs ?? []}
            rowKey={(log) => String(log.id)}
            loading={logs === null}
            loadingRows={pageSize > 15 ? 10 : pageSize}
            empty="No audit records found matching the selected filters."
            columns={
              isLoginTab
                ? [
                  {
                    key: 'time',
                    label: 'TIME',
                    priority: 'always',
                    header: (
                      <th className={styles.thFilterable}>
                        <button
                          type="button"
                          className={`${styles.thFilterBtn} ${dateRange !== 'all' ? styles.thFilterBtnActive : ''}`}
                          onClick={() => setActiveHeaderFilter((c) => (c === 'time' ? null : 'time'))}
                        >
                          <span>TIME</span>
                          <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'time' ? styles.filterIconActive : ''}`} />
                          {dateRange !== 'all' && <span className={styles.filterDot} />}
                        </button>
                        {activeHeaderFilter === 'time' && (
                          <div className={styles.filterPopover}>
                            <div className={styles.popoverHeader}>
                              <span className={styles.popoverTitle}>Filter Time</span>
                              {dateRange !== 'all' && (
                                <button
                                  type="button"
                                  className={styles.popoverClearBtn}
                                  onClick={() => { setDateRange('all'); setCustomFrom(''); setCustomTo(''); setCustomDraftFrom(''); setCustomDraftTo('') }}
                                >
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
                                <span className={styles.alp1}>to</span>
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
                    ),
                    render: (log) => <span className={styles.timeCell}>{formatTimestamp(log.occurredAt)}</span>,
                  },
                  {
                    key: 'actor',
                    label: 'PERFORMED BY',
                    priority: 'always',
                    header: (
                      <th className={styles.thFilterable}>
                        <button
                          type="button"
                          className={`${styles.thFilterBtn} ${actorSearch ? styles.thFilterBtnActive : ''}`}
                          onClick={() => setActiveHeaderFilter((c) => (c === 'actor' ? null : 'actor'))}
                        >
                          <span>PERFORMED BY</span>
                          <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'actor' ? styles.filterIconActive : ''}`} />
                          {actorSearch && <span className={styles.filterDot} />}
                        </button>
                        {activeHeaderFilter === 'actor' && (
                          <div className={styles.filterPopover}>
                            <div className={styles.popoverHeader}>
                              <span className={styles.popoverTitle}>Filter Performed By</span>
                              {actorSearch && <button type="button" className={styles.popoverClearBtn} onClick={() => setActorSearch('')}>Reset</button>}
                            </div>
                            <input
                              type="text"
                              className={styles.popoverInput}
                              placeholder="Search name or email..."
                              value={actorSearch}
                              onChange={(e) => setActorSearch(e.target.value)}
                              autoFocus
                            />
                            {availableActors.length > 0 && (
                              <>
                                <div className={styles.popoverDivider} />
                                <span className={styles.customDateLabel}>Known Actors:</span>
                                <div className={styles.userListSection}>
                                  {availableActors.map((a) => (
                                    <button
                                      key={a.id || a.name}
                                      type="button"
                                      className={`${styles.userItem} ${actorSearch.toLowerCase() === a.name.toLowerCase() ? styles.userItemActive : ''}`}
                                      onClick={() => { setActorSearch(a.name); setActiveHeaderFilter(null) }}
                                    >
                                      <div className={styles.userAvatarSmall}>
                                        {a.name.charAt(0).toUpperCase()}
                                      </div>
                                      <span>{a.name}</span>
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </th>
                    ),
                    render: (log) => <ActorCell name={log.actorName} />,
                  },
                  {
                    key: 'auth',
                    label: 'SIGN-IN METHOD',
                    priority: 'low',
                    header: (
                      <th className={styles.thFilterable}>
                        <button
                          type="button"
                          className={`${styles.thFilterBtn} ${authMethodFilter ? styles.thFilterBtnActive : ''}`}
                          onClick={() => setActiveHeaderFilter((c) => (c === 'authMethod' ? null : 'authMethod'))}
                        >
                          <span>SIGN-IN METHOD</span>
                          <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'authMethod' ? styles.filterIconActive : ''}`} />
                          {authMethodFilter && <span className={styles.filterDot} />}
                        </button>
                        {activeHeaderFilter === 'authMethod' && (
                          <div className={styles.filterPopover}>
                            <div className={styles.popoverHeader}>
                              <span className={styles.popoverTitle}>Filter Sign-in Method</span>
                              {authMethodFilter && <button type="button" className={styles.popoverClearBtn} onClick={() => setAuthMethodFilter('')}>Reset</button>}
                            </div>
                            <div className={styles.popoverList}>
                              <button
                                type="button"
                                className={`${styles.popoverItem} ${!authMethodFilter ? styles.popoverItemActive : ''}`}
                                onClick={() => { setAuthMethodFilter(''); setActiveHeaderFilter(null) }}
                              >
                                <span>All Methods</span>
                              </button>
                              {availableAuthMethods.map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  className={`${styles.popoverItem} ${authMethodFilter.toLowerCase() === m.toLowerCase() ? styles.popoverItemActive : ''}`}
                                  onClick={() => { setAuthMethodFilter(m); setActiveHeaderFilter(null) }}
                                >
                                  <span>{m}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </th>
                    ),
                    render: (log) => <span className={styles.authPill}>{log.authMethod ?? 'Local'}</span>,
                  },
                  {
                    key: 'ip',
                    label: 'IP ADDRESS',
                    priority: 'low',
                    header: (
                      <th className={styles.thFilterable}>
                        <button
                          type="button"
                          className={`${styles.thFilterBtn} ${ipSearch ? styles.thFilterBtnActive : ''}`}
                          onClick={() => setActiveHeaderFilter((c) => (c === 'ip' ? null : 'ip'))}
                        >
                          <span>IP ADDRESS</span>
                          <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'ip' ? styles.filterIconActive : ''}`} />
                          {ipSearch && <span className={styles.filterDot} />}
                        </button>
                        {activeHeaderFilter === 'ip' && (
                          <div className={styles.filterPopover}>
                            <div className={styles.popoverHeader}>
                              <span className={styles.popoverTitle}>Filter IP Address</span>
                              {ipSearch && <button type="button" className={styles.popoverClearBtn} onClick={() => { setIpSearch(''); setIpSearchBlocked(false) }}>Reset</button>}
                            </div>
                            <input
                              type="text"
                              inputMode="numeric"
                              className={`${styles.popoverInput} ${ipSearchBlocked ? styles.popoverInputBlocked : ''}`}
                              placeholder="Search IP address..."
                              value={ipSearch}
                              onChange={(e) => handleIpSearchChange(e.target.value)}
                              autoFocus
                            />
                            {ipSearchBlocked && (
                              <p className={styles.blockedHint} role="alert">{filterTypeBlockedMessage('numeric')}</p>
                            )}
                            {availableIps.length > 0 && (
                              <>
                                <div className={styles.popoverDivider} />
                                <span className={styles.customDateLabel}>Known IPs:</span>
                                <div className={styles.popoverList}>
                                  {availableIps.map((ip) => (
                                    <button
                                      key={ip}
                                      type="button"
                                      className={`${styles.popoverItem} ${ipSearch === ip ? styles.popoverItemActive : ''}`}
                                      onClick={() => { setIpSearch(ip); setActiveHeaderFilter(null) }}
                                    >
                                      <span>{ip}</span>
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </th>
                    ),
                    render: (log) =>
                      log.sourceIp ? (
                        <span className={styles.ipBadge}>
                          <span className={styles.ipDot} aria-hidden="true" />
                          {formatIpv4(log.sourceIp)}
                        </span>
                      ) : (
                        <span className={styles.mutedText}>{EMPTY_VALUE}</span>
                      ),
                  },
                  {
                    key: 'device',
                    label: 'BROWSER / DEVICE',
                    priority: 'low',
                    header: (
                      <th className={styles.thFilterable}>
                        <button
                          type="button"
                          className={`${styles.thFilterBtn} ${deviceSearch ? styles.thFilterBtnActive : ''}`}
                          onClick={() => setActiveHeaderFilter((c) => (c === 'device' ? null : 'device'))}
                        >
                          <span>BROWSER / DEVICE</span>
                          <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'device' ? styles.filterIconActive : ''}`} />
                          {deviceSearch && <span className={styles.filterDot} />}
                        </button>
                        {activeHeaderFilter === 'device' && (
                          <div className={`${styles.filterPopover} ${styles.popoverRight}`}>
                            <div className={styles.popoverHeader}>
                              <span className={styles.popoverTitle}>Filter Browser / Device</span>
                              {deviceSearch && <button type="button" className={styles.popoverClearBtn} onClick={() => setDeviceSearch('')}>Reset</button>}
                            </div>
                            <input
                              type="text"
                              className={styles.popoverInput}
                              placeholder="Search browser or OS..."
                              value={deviceSearch}
                              onChange={(e) => setDeviceSearch(e.target.value)}
                              autoFocus
                            />
                            {(availableDevices.browsers.length > 0 || availableDevices.oses.length > 0) && (
                              <div className={styles.popoverList}>
                                {availableDevices.browsers.length > 0 && (
                                  <>
                                    <div className={styles.popoverDivider} />
                                    <span className={styles.customDateLabel}>Browsers:</span>
                                    {availableDevices.browsers.map((b) => (
                                      <button
                                        key={b}
                                        type="button"
                                        className={`${styles.popoverItem} ${deviceSearch.toLowerCase() === b.toLowerCase() ? styles.popoverItemActive : ''}`}
                                        onClick={() => { setDeviceSearch(b); setActiveHeaderFilter(null) }}
                                      >
                                        <span>{b}</span>
                                      </button>
                                    ))}
                                  </>
                                )}
                                {availableDevices.oses.length > 0 && (
                                  <>
                                    <div className={styles.popoverDivider} />
                                    <span className={styles.customDateLabel}>Operating Systems:</span>
                                    {availableDevices.oses.map((os) => (
                                      <button
                                        key={os}
                                        type="button"
                                        className={`${styles.popoverItem} ${deviceSearch.toLowerCase() === os.toLowerCase() ? styles.popoverItemActive : ''}`}
                                        onClick={() => { setDeviceSearch(os); setActiveHeaderFilter(null) }}
                                      >
                                        <span>{os}</span>
                                      </button>
                                    ))}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </th>
                    ),
                    render: (log) => {
                      const parsed = parseUserAgent(log.userAgent)
                      return (
                        <span
                          className={`${styles.deviceCell} ${log.userAgent ? styles.deviceCellClickable : ''}`}
                          onClick={() => setViewingLog(log)}
                          title="Click to view full details"
                        >
                          {parsed ? (
                            <span className={styles.devicePillGroup}>
                              <span className={styles.browserPill}>{parsed.browser}</span>
                              <span className={styles.osPill}>{parsed.os}</span>
                            </span>
                          ) : (
                            <span className={styles.mutedText}>{log.userAgent ?? EMPTY_VALUE}</span>
                          )}
                        </span>
                      )
                    },
                  },
                  {
                    key: 'result',
                    label: 'OUTCOME',
                    priority: 'always',
                    header: (
                      <th className={styles.thFilterable}>
                        <button
                          type="button"
                          className={`${styles.thFilterBtn} ${resultFilter ? styles.thFilterBtnActive : ''}`}
                          onClick={() => setActiveHeaderFilter((c) => (c === 'result' ? null : 'result'))}
                        >
                          <span>OUTCOME</span>
                          <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'result' ? styles.filterIconActive : ''}`} />
                          {resultFilter && <span className={styles.filterDot} />}
                        </button>
                        {activeHeaderFilter === 'result' && (
                          <div className={`${styles.filterPopover} ${styles.popoverRight}`}>
                            <div className={styles.popoverHeader}>
                              <span className={styles.popoverTitle}>Filter Outcome</span>
                              {resultFilter && <button type="button" className={styles.popoverClearBtn} onClick={() => setResultFilter('')}>Reset</button>}
                            </div>
                            <div className={styles.popoverList}>
                              <button
                                type="button"
                                className={`${styles.popoverItem} ${!resultFilter ? styles.popoverItemActive : ''}`}
                                onClick={() => { setResultFilter(''); setActiveHeaderFilter(null) }}
                              >
                                <span>All Results</span>
                              </button>
                              <button
                                type="button"
                                className={`${styles.popoverItem} ${resultFilter === 'Success' ? styles.popoverItemActive : ''}`}
                                onClick={() => { setResultFilter('Success'); setActiveHeaderFilter(null) }}
                              >
                                <Badge tone="success" dot>Success</Badge>
                              </button>
                              <button
                                type="button"
                                className={`${styles.popoverItem} ${resultFilter === 'Failure' ? styles.popoverItemActive : ''}`}
                                onClick={() => { setResultFilter('Failure'); setActiveHeaderFilter(null) }}
                              >
                                <Badge tone="danger" dot>Failure</Badge>
                              </button>
                            </div>
                          </div>
                        )}
                      </th>
                    ),
                    render: (log) => (
                      <Badge tone={log.result === 'Success' ? 'success' : 'danger'} dot>
                        {log.result}
                      </Badge>
                    ),
                  },
                  {
                    key: 'details',
                    label: 'DETAILS',
                    priority: 'always',
                    align: 'right',
                    render: (log) => <RowAction onClick={() => setViewingLog(log)} title="View full details" />,
                  },
                  ]
                : [
                  {
                    key: 'time',
                    label: 'TIME',
                    priority: 'always',
                    header: (
                      <th className={styles.thFilterable}>
                        <button
                          type="button"
                          className={`${styles.thFilterBtn} ${dateRange !== 'all' ? styles.thFilterBtnActive : ''}`}
                          onClick={() => setActiveHeaderFilter((c) => (c === 'time' ? null : 'time'))}
                        >
                          <span>TIME</span>
                          <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'time' ? styles.filterIconActive : ''}`} />
                          {dateRange !== 'all' && <span className={styles.filterDot} />}
                        </button>
                        {activeHeaderFilter === 'time' && (
                          <div className={styles.filterPopover}>
                            <div className={styles.popoverHeader}>
                              <span className={styles.popoverTitle}>Filter Time</span>
                              {dateRange !== 'all' && (
                                <button
                                  type="button"
                                  className={styles.popoverClearBtn}
                                  onClick={() => { setDateRange('all'); setCustomFrom(''); setCustomTo(''); setCustomDraftFrom(''); setCustomDraftTo('') }}
                                >
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
                                <span className={styles.alp1}>to</span>
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
                    ),
                    render: (log) => <span className={styles.timeCell}>{formatTimestamp(log.occurredAt)}</span>,
                  },
                  {
                    key: 'service',
                    label: 'APPLICATION',
                    priority: 'high',
                    header: (
                      <th className={styles.thFilterable}>
                        <button
                          type="button"
                          className={`${styles.thFilterBtn} ${service ? styles.thFilterBtnActive : ''}`}
                          onClick={() => setActiveHeaderFilter((c) => (c === 'service' ? null : 'service'))}
                        >
                          <span>APPLICATION</span>
                          <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'service' ? styles.filterIconActive : ''}`} />
                          {service && <span className={styles.filterDot} />}
                        </button>
                        {activeHeaderFilter === 'service' && (
                          <div className={styles.filterPopover}>
                            <div className={styles.popoverHeader}>
                              <span className={styles.popoverTitle}>Filter Application</span>
                              {service && <button type="button" className={styles.popoverClearBtn} onClick={() => { setService(''); setServiceSearch('') }}>Reset</button>}
                            </div>
                            <input
                              type="text"
                              className={styles.popoverInput}
                              placeholder="Type to search service..."
                              value={serviceSearch}
                              onChange={(e) => setServiceSearch(e.target.value)}
                              autoFocus
                            />
                            <div className={styles.popoverList}>
                              <button
                                type="button"
                                className={`${styles.popoverItem} ${!service ? styles.popoverItemActive : ''}`}
                                onClick={() => { setService(''); setActiveHeaderFilter(null) }}
                              >
                                <span>All Services</span>
                              </button>
                              {availableServices.map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  className={`${styles.popoverItem} ${service.toLowerCase() === s.toLowerCase() ? styles.popoverItemActive : ''}`}
                                  onClick={() => { setService(s); setActiveHeaderFilter(null) }}
                                >
                                  <Badge tone={serviceTone(s)}>{s}</Badge>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </th>
                    ),
                    render: (log) => <Badge tone={serviceTone(log.serviceName)}>{log.serviceName}</Badge>,
                  },
                  {
                    key: 'actor',
                    label: 'PERFORMED BY',
                    priority: 'always',
                    header: (
                      <th className={styles.thFilterable}>
                        <button
                          type="button"
                          className={`${styles.thFilterBtn} ${actorSearch ? styles.thFilterBtnActive : ''}`}
                          onClick={() => setActiveHeaderFilter((c) => (c === 'actor' ? null : 'actor'))}
                        >
                          <span>PERFORMED BY</span>
                          <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'actor' ? styles.filterIconActive : ''}`} />
                          {actorSearch && <span className={styles.filterDot} />}
                        </button>
                        {activeHeaderFilter === 'actor' && (
                          <div className={styles.filterPopover}>
                            <div className={styles.popoverHeader}>
                              <span className={styles.popoverTitle}>Filter Performed By</span>
                              {actorSearch && <button type="button" className={styles.popoverClearBtn} onClick={() => { setActorSearch(''); setActorSearchBlocked(false) }}>Reset</button>}
                            </div>
                            <input
                              type="text"
                              inputMode="text"
                              className={`${styles.popoverInput} ${actorSearchBlocked ? styles.popoverInputBlocked : ''}`}
                              placeholder="Search by name..."
                              value={actorSearch}
                              onChange={(e) => handleActorSearchChange(e.target.value)}
                              autoFocus
                            />
                            {actorSearchBlocked && (
                              <p className={styles.blockedHint} role="alert">{filterTypeBlockedMessage('alpha')}</p>
                            )}
                            {availableActors.length > 0 && (
                              <>
                                <div className={styles.popoverDivider} />
                                <span className={styles.customDateLabel}>Known Actors:</span>
                                <div className={styles.userListSection}>
                                  {availableActors.map((a) => (
                                    <button
                                      key={a.id || a.name}
                                      type="button"
                                      className={`${styles.userItem} ${actorSearch.toLowerCase() === a.name.toLowerCase() ? styles.userItemActive : ''}`}
                                      onClick={() => { setActorSearch(a.name); setActiveHeaderFilter(null) }}
                                    >
                                      <div className={styles.userAvatarSmall}>
                                        {a.name.charAt(0).toUpperCase()}
                                      </div>
                                      <span>{a.name}</span>
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </th>
                    ),
                    render: (log) => (
                      <div className={styles.actorCell}>
                        <span className={styles.actorAvatar}>
                          {(log.actorName || log.actorUserId || 'S').charAt(0).toUpperCase()}
                        </span>
                        <span className={styles.actorName}>
                          {log.actorName ?? <span className={styles.mutedText}>System</span>}
                        </span>
                      </div>
                    ),
                  },
                  {
                    key: 'action',
                    label: 'WHAT HAPPENED',
                    priority: 'always',
                    header: (
                      <th className={styles.thFilterable}>
                        <button
                          type="button"
                          className={`${styles.thFilterBtn} ${actionFilter ? styles.thFilterBtnActive : ''}`}
                          onClick={() => setActiveHeaderFilter((c) => (c === 'action' ? null : 'action'))}
                        >
                          <span>WHAT HAPPENED</span>
                          <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'action' ? styles.filterIconActive : ''}`} />
                          {actionFilter && <span className={styles.filterDot} />}
                        </button>
                        {activeHeaderFilter === 'action' && (
                          <div className={styles.filterPopover}>
                            <div className={styles.popoverHeader}>
                              <span className={styles.popoverTitle}>Filter What Happened</span>
                              {actionFilter && <button type="button" className={styles.popoverClearBtn} onClick={() => { setActionFilter(''); setActionSearch('') }}>Reset</button>}
                            </div>
                            <input
                              type="text"
                              className={styles.popoverInput}
                              placeholder="Search action..."
                              value={actionSearch}
                              onChange={(e) => setActionSearch(e.target.value)}
                              autoFocus
                            />
                            <div className={styles.popoverList}>
                              <button
                                type="button"
                                className={`${styles.popoverItem} ${!actionFilter ? styles.popoverItemActive : ''}`}
                                onClick={() => { setActionFilter(''); setActiveHeaderFilter(null) }}
                              >
                                <span>All Actions</span>
                              </button>
                              {availableActions.map((a) => (
                                <button
                                  key={a.raw}
                                  type="button"
                                  className={`${styles.popoverItem} ${actionFilter === a.raw ? styles.popoverItemActive : ''}`}
                                  onClick={() => { setActionFilter(a.raw); setActiveHeaderFilter(null) }}
                                >
                                  <span className={styles.actionCell}>{a.label}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </th>
                    ),
                    render: (log) => (
                      <span className={`${styles.actionCell} ${styles[actionChipClass(log.action)]}`} title={log.action}>
                        {formatActionLabel(log.action)}
                      </span>
                    ),
                  },
                  {
                    key: 'entity',
                    clamp: true,
                    label: 'RECORD',
                    priority: 'low',
                    header: (
                      <th className={`${styles.thFilterable} ${styles.thNarrow}`}>
                        <button
                          type="button"
                          className={`${styles.thFilterBtn} ${entitySearch ? styles.thFilterBtnActive : ''}`}
                          onClick={() => setActiveHeaderFilter((c) => (c === 'entity' ? null : 'entity'))}
                        >
                          <span>RECORD</span>
                          <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'entity' ? styles.filterIconActive : ''}`} />
                          {entitySearch && <span className={styles.filterDot} />}
                        </button>
                        {activeHeaderFilter === 'entity' && (
                          <div className={`${styles.filterPopover} ${styles.popoverRight}`}>
                            <div className={styles.popoverHeader}>
                              <span className={styles.popoverTitle}>Search Entity</span>
                              {entitySearch && <button type="button" className={styles.popoverClearBtn} onClick={() => setEntitySearch('')}>Reset</button>}
                            </div>
                            <input
                              type="text"
                              className={styles.popoverInput}
                              placeholder="Filter by record type or name..."
                              value={entitySearch}
                              onChange={(e) => setEntitySearch(e.target.value)}
                              autoFocus
                            />
                          </div>
                        )}
                      </th>
                    ),
                    render: (log) =>
                      log.entityType ? (
                        <div className={styles.entityWrap}>
                          <span className={styles.entityType}>{log.entityType}</span>
                          {log.entityLabel && (
                            <span className={styles.entityId} title={log.entityLabel}>
                              {log.entityLabel}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className={styles.mutedText}>{EMPTY_VALUE}</span>
                      ),
                  },
                  {
                    key: 'details',
                    label: 'DETAILS',
                    priority: 'always',
                    align: 'right',
                    render: (log) => <RowAction onClick={() => setViewingLog(log)} title="View full details" />,
                  },
                ]}
              />
            </DataTable>

      {/* Record details drawer — opened per row by its "View" button (or, on the Sign-ins tabs, the
          device cell). The SAME right-side drawer shell Settings and the System Audit Trail deep-link
          use, scoped to just the one record clicked — NOT the whole audit log section. */}
      {viewingLog && (
        <div className={drawerStyles.overlayRoot}>
          <div className={drawerStyles.backdrop} onClick={() => setViewingLog(null)} />
          <div className={drawerStyles.drawerContainer}>
            <div className={drawerStyles.rootPanel}>
              <div className={drawerStyles.header}>
                <div className={drawerStyles.headerLeft}>
                  <div className={drawerStyles.headerIcon}>
                    <Icon.Shield width={20} height={20} />
                  </div>
                  <div>
                    <h2 className={drawerStyles.title}>Activity Details</h2>
                    <p className={drawerStyles.subtitle}>What happened, who did it, and when</p>
                  </div>
                </div>
                <button
                  type="button"
                  className={drawerStyles.closeBtn}
                  onClick={() => setViewingLog(null)}
                  aria-label="Close details"
                >
                  <Icon.X width={20} height={20} />
                </button>
              </div>

              <div className={drawerStyles.tabBody}>
                <div className={styles.drawerSections}>
                  {/* 1. Overview & Timeline Two-Column Section */}
                  <section className={styles.drawerSection}>
                    <div className={styles.overviewTimelineGrid}>
                      <div className={styles.overviewTimelineCol}>
                        <h3 className={styles.drawerSectionTitle}>
                          <Icon.Grid width={12} height={12} />
                          Summary
                        </h3>
                        <dl className={styles.detailList}>
                          <div className={styles.detailRow}>
                            <span className={styles.detailIcon}>
                              <Icon.Layers width={15} height={15} />
                            </span>
                            <div className={styles.detailRowBody}>
                              <dt className={styles.detailRowLabel}>Application</dt>
                              <dd className={styles.detailRowValue}>
                                <Badge tone={serviceTone(viewingLog.serviceName)}>
                                  {viewingLog.serviceName}
                                </Badge>
                              </dd>
                            </div>
                          </div>

                          <div className={styles.detailRow}>
                            <span className={`${styles.detailIcon} ${styles.detailIconNeutral}`}>
                              <Icon.Activity width={15} height={15} />
                            </span>
                            <div className={styles.detailRowBody}>
                              <dt className={styles.detailRowLabel}>What Happened</dt>
                              <dd className={styles.detailRowValue}>
                                <span className={styles.actionCell}>
                                  {formatActionLabel(viewingLog.action)}
                                </span>
                              </dd>
                            </div>
                          </div>

                          <div className={styles.detailRow}>
                            <span
                              className={`${styles.detailIcon} ${
                                viewingLog.result === 'Success'
                                  ? styles.detailIconSuccess
                                  : styles.detailIconDanger
                              }`}
                            >
                              {viewingLog.result === 'Success' ? (
                                <Icon.CheckCircle width={15} height={15} />
                              ) : (
                                <Icon.AlertTriangle width={15} height={15} />
                              )}
                            </span>
                            <div className={styles.detailRowBody}>
                              <dt className={styles.detailRowLabel}>Outcome</dt>
                              <dd className={styles.detailRowValue}>
                                <Badge
                                  tone={viewingLog.result === 'Success' ? 'success' : 'danger'}
                                  dot
                                >
                                  {viewingLog.result}
                                </Badge>
                              </dd>
                            </div>
                          </div>

                          <div className={styles.detailRow}>
                            <span className={`${styles.detailIcon} ${styles.detailIconPurple}`}>
                              <Icon.Clock width={15} height={15} />
                            </span>
                            <div className={styles.detailRowBody}>
                              <dt className={styles.detailRowLabel}>Date &amp; Time</dt>
                              <dd className={styles.detailRowValue}>
                                {formatTimestamp(viewingLog.occurredAt)}
                              </dd>
                            </div>
                          </div>
                        </dl>
                      </div>

                      <div className={`${styles.overviewTimelineCol} ${styles.overviewTimelineColDivider}`}>
                        <h3 className={styles.drawerSectionTitle}>
                          <Icon.Clock width={12} height={12} />
                          Timeline
                        </h3>
                        <div className={styles.timeline}>
                          <div className={styles.timelineStep}>
                            <span className={styles.timelineDot} />
                            <div className={styles.timelineStepCard}>
                              <span className={styles.timelineLabel}>
                                {viewingLog.actorName ? `Started by ${viewingLog.actorName}` : 'Activity recorded'}
                              </span>
                              <span className={styles.timelineTime}>
                                <Icon.Clock width={12} height={12} />
                                {formatTimestamp(viewingLog.occurredAt)}
                              </span>
                            </div>
                          </div>

                          <div className={styles.timelineStep}>
                            <span
                              className={`${styles.timelineDot} ${
                                viewingLog.result === 'Success'
                                  ? styles.timelineDotSuccess
                                  : styles.timelineDotDanger
                              }`}
                            />
                            <div className={styles.timelineStepCard}>
                              <span className={styles.timelineLabel}>
                                {viewingLog.result === 'Success'
                                  ? 'Finished successfully'
                                  : 'Did not complete'}
                              </span>
                              <span className={styles.timelineTime}>
                                <Icon.ShieldCheck width={12} height={12} />
                                {viewingLog.serviceName}
                              </span>
                            </div>
                          </div>
                        </div>

                        {viewingLog.failureReason && (
                          <div className={styles.failureAlert}>
                            <Icon.AlertTriangle className={styles.failureAlertIcon} width={15} height={15} />
                            <div>
                              <strong>Why it failed:</strong> {viewingLog.failureReason}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>

                  {/*
                    Every field below is omitted when the record carries no value for it —
                    DetailField returns null rather than printing "Not recorded", "System / None"
                    or an em dash, which is what these cards used to do.

                    Two fields were removed outright rather than relabelled: "Actor ID" and
                    "Entity ID / Key" rendered raw database GUIDs. They mean nothing to the people
                    who read an audit trail and cannot be acted on; the actor's name and the
                    record's name carry the same meaning in readable form.
                  */}
                  <DetailSection title="Who Did This" icon={<Icon.User width={12} height={12} />}>
                    <DetailGrid>
                      <DetailField label="Performed By" icon={<Icon.User width={15} height={15} />}>
                        {viewingLog.actorName ?? 'System'}
                      </DetailField>

                      <DetailField label="Sign-in Method" icon={<Icon.Shield width={15} height={15} />}>
                        {viewingLog.authMethod ? (
                          <span className={styles.authPill}>{viewingLog.authMethod}</span>
                        ) : null}
                      </DetailField>

                      <DetailField label="IP Address" icon={<Icon.Globe width={15} height={15} />}>
                        {viewingLog.sourceIp ? (
                          <span className={styles.ipBadge}>
                            <span className={styles.ipDot} />
                            {formatIpv4(viewingLog.sourceIp)}
                          </span>
                        ) : null}
                      </DetailField>
                    </DetailGrid>
                  </DetailSection>

                  {(() => {
                    const parsed = parseUserAgent(viewingLog.userAgent)
                    return (
                      <DetailSection
                        title="Device Used"
                        icon={<Icon.Globe width={12} height={12} />}
                        hidden={!parsed}
                      >
                        <DetailGrid>
                          <DetailField label="Browser" icon={<Icon.Globe width={15} height={15} />}>
                            {parsed ? <span className={styles.browserPill}>{parsed.browser}</span> : null}
                          </DetailField>

                          <DetailField label="Operating System" icon={<Icon.Box width={15} height={15} />}>
                            {parsed ? <span className={styles.osPill}>{parsed.os}</span> : null}
                          </DetailField>
                        </DetailGrid>
                      </DetailSection>
                    )
                  })()}

                  <DetailSection
                    title="Affected Record"
                    icon={<Icon.Box width={12} height={12} />}
                    hidden={!viewingLog.entityType && !viewingLog.entityLabel}
                  >
                    <DetailGrid>
                      <DetailField label="Record Type" icon={<Icon.Layers width={15} height={15} />}>
                        {viewingLog.entityType ? (
                          <Badge tone="neutral">{viewingLog.entityType}</Badge>
                        ) : null}
                      </DetailField>

                      <DetailField label="Record Name" icon={<Icon.FileText width={15} height={15} />}>
                        {viewingLog.entityLabel}
                      </DetailField>
                    </DetailGrid>
                  </DetailSection>

                  {viewingLog.details && (
                    <DetailSection title="Additional Details" icon={<Icon.FileText width={12} height={12} />}>
                      <pre className={styles.payloadCodeBox}>{viewingLog.details}</pre>
                    </DetailSection>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
