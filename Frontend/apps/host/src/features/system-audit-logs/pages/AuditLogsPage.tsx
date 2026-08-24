import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '../../auth/store/authStore'
import { Badge, type BadgeTone } from '../../../shared/components/Badge/Badge'
import { SkeletonBlock } from '../../../shared/components/Skeleton'
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
const PAGE_SIZE_OPTIONS = [5, 10, 15, 20] as const

const SERVICE_TONES: Record<string, BadgeTone> = {
  AuthService: 'primary',
  ModuleRegistry: 'info',
  EmployeeService: 'warning',
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

function formatTimestamp(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

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

const KNOWN_SERVICES = ['AuthService', 'ModuleRegistry', 'EmployeeService', 'Customer360Service', 'LeadService']

export function AuditLogsPage() {
  const accessToken = useAuthStore((s) => s.accessToken)

  // Defaults to all activity, not to failures. See the tablist below for why.
  const [activeTab, setActiveTab] = useState<TabId>(TAB_IDS.auditEvents)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [isCustomPageSize, setIsCustomPageSize] = useState(false)
  const [customPageSizeInput, setCustomPageSizeInput] = useState('')

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

  // Actor search
  const [actorSearch, setActorSearch] = useState('')

  // Action filter & search
  const [actionFilter, setActionFilter] = useState('')
  const [actionSearch, setActionSearch] = useState('')

  // Entity search
  const [entitySearch, setEntitySearch] = useState('')

  // Sign-in specific filters
  const [authMethodFilter, setAuthMethodFilter] = useState('')
  const [ipSearch, setIpSearch] = useState('')
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

  // Zero extra API call: extract unique services
  const availableServices = useMemo(() => {
    const set = new Set<string>(KNOWN_SERVICES)
    for (const r of cachedPool) {
      if (r.serviceName) set.add(r.serviceName)
    }
    const list = Array.from(set)
    if (!serviceSearch.trim()) return list
    const q = serviceSearch.toLowerCase()
    return list.filter((s) => s.toLowerCase().includes(q))
  }, [cachedPool, serviceSearch])

  // Zero extra API call: extract unique actions
  const availableActions = useMemo(() => {
    const set = new Set<string>(Object.keys(ACTION_LABELS))
    for (const r of cachedPool) {
      if (r.action) set.add(r.action)
    }
    const list = Array.from(set).map((a) => ({ raw: a, label: formatActionLabel(a) }))
    if (!actionSearch.trim()) return list
    const q = actionSearch.toLowerCase()
    return list.filter((a) => a.label.toLowerCase().includes(q) || a.raw.toLowerCase().includes(q))
  }, [cachedPool, actionSearch])

  // Zero extra API call: extract unique auth methods
  const availableAuthMethods = useMemo(() => {
    const set = new Set<string>(['Local', 'Google', 'AzureAD', 'OAuth', 'ApiKey', 'Bearer'])
    for (const r of cachedPool) {
      if (r.authMethod) set.add(r.authMethod)
    }
    return Array.from(set)
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
  }, [loadSummary])

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false

    setLogs(null)
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

        // Update cached pool
        setCachedPool((prev) => {
          const map = new Map<string, AuditLogDto>()
          for (const item of prev) map.set(item.id, item)
          for (const item of allItems) map.set(item.id, item)
          return Array.from(map.values())
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

  const hasActiveFilters = Boolean(
    service || actorSearch || actionFilter || entitySearch || authMethodFilter ||
    ipSearch || deviceSearch || resultFilter || dateRange !== 'all'
  )

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const isLoginTab = activeTab === TAB_IDS.loginErrors || activeTab === TAB_IDS.loginSuccesses

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <div className={styles.titleHeaderRow}>
            <h1 className={styles.title}>Audit Logs</h1>
            <span className={styles.liveStreamBadge}>
              <span className={styles.liveDot} />
              Live Stream
            </span>
          </div>
          <p className={styles.subtitle}>
            Comprehensive real-time log of authentication events and administrative platform activities.
          </p>
        </div>

        {/* Date Filter Pills */}
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
      </div>

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
          <div className={styles.rowsDropdownWrap}>
            <label htmlFor="audit-rows-select" className={styles.rowsDropdownLabel}>
              Rows
            </label>
            <div className={styles.rowsSelectWrap}>
              <select
                id="audit-rows-select"
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

      {/* Active filters chip banner */}
      {hasActiveFilters && (
        <div className={styles.activeFiltersBar}>
          <span className={styles.activeFiltersLabel}>Filters:</span>
          {dateRange !== 'all' && (
            <span className={styles.filterChip}>
              <span>
                Time: {dateRange === 'custom' ? `${customFrom || '…'} to ${customTo || '…'}` : (DATE_RANGES.find((d) => d.key === dateRange)?.label ?? dateRange)}
              </span>
              <button type="button" className={styles.filterChipRemove} onClick={() => { setDateRange('all'); setCustomFrom(''); setCustomTo('') }} aria-label="Remove date filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {service && (
            <span className={styles.filterChip}>
              <span>Service: {service}</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => setService('')} aria-label="Remove service filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {actorSearch && (
            <span className={styles.filterChip}>
              <span>Actor: "{actorSearch}"</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => setActorSearch('')} aria-label="Remove actor filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {actionFilter && (
            <span className={styles.filterChip}>
              <span>Action: {formatActionLabel(actionFilter)}</span>
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
          {authMethodFilter && (
            <span className={styles.filterChip}>
              <span>Auth: {authMethodFilter}</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => setAuthMethodFilter('')} aria-label="Remove auth filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {ipSearch && (
            <span className={styles.filterChip}>
              <span>IP: "{ipSearch}"</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => setIpSearch('')} aria-label="Remove IP filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {deviceSearch && (
            <span className={styles.filterChip}>
              <span>Device: "{deviceSearch}"</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => setDeviceSearch('')} aria-label="Remove device filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          {resultFilter && (
            <span className={styles.filterChip}>
              <span>Result: {resultFilter}</span>
              <button type="button" className={styles.filterChipRemove} onClick={() => setResultFilter('')} aria-label="Remove result filter">
                <Icon.X width={12} height={12} />
              </button>
            </span>
          )}
          <button type="button" className={styles.clearAllBtn} onClick={clearAllFilters}>
            Clear all
          </button>
        </div>
      )}

      {error && <div className={styles.errorBanner}>{error}</div>}

      {/* Logs Table Container */}
      <div className={styles.tableContainer}>
        <table className={styles.logTable}>
          <thead>
            {isLoginTab ? (
              <tr>
                {/* TIME */}
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

                {/* ACTOR / EMAIL */}
                <th className={styles.thFilterable}>
                  <button
                    type="button"
                    className={`${styles.thFilterBtn} ${actorSearch ? styles.thFilterBtnActive : ''}`}
                    onClick={() => setActiveHeaderFilter((c) => (c === 'actor' ? null : 'actor'))}
                  >
                    <span>ACTOR / EMAIL</span>
                    <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'actor' ? styles.filterIconActive : ''}`} />
                    {actorSearch && <span className={styles.filterDot} />}
                  </button>
                  {activeHeaderFilter === 'actor' && (
                    <div className={styles.filterPopover}>
                      <div className={styles.popoverHeader}>
                        <span className={styles.popoverTitle}>Filter Actor / Email</span>
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

                {/* AUTH METHOD */}
                <th className={styles.thFilterable}>
                  <button
                    type="button"
                    className={`${styles.thFilterBtn} ${authMethodFilter ? styles.thFilterBtnActive : ''}`}
                    onClick={() => setActiveHeaderFilter((c) => (c === 'authMethod' ? null : 'authMethod'))}
                  >
                    <span>AUTH METHOD</span>
                    <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'authMethod' ? styles.filterIconActive : ''}`} />
                    {authMethodFilter && <span className={styles.filterDot} />}
                  </button>
                  {activeHeaderFilter === 'authMethod' && (
                    <div className={styles.filterPopover}>
                      <div className={styles.popoverHeader}>
                        <span className={styles.popoverTitle}>Filter Auth Method</span>
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

                {/* IP ADDRESS */}
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
                        {ipSearch && <button type="button" className={styles.popoverClearBtn} onClick={() => setIpSearch('')}>Reset</button>}
                      </div>
                      <input
                        type="text"
                        className={styles.popoverInput}
                        placeholder="Search IP address..."
                        value={ipSearch}
                        onChange={(e) => setIpSearch(e.target.value)}
                        autoFocus
                      />
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

                {/* BROWSER / DEVICE */}
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

                {/* RESULT */}
                <th className={styles.thFilterable}>
                  <button
                    type="button"
                    className={`${styles.thFilterBtn} ${resultFilter ? styles.thFilterBtnActive : ''}`}
                    onClick={() => setActiveHeaderFilter((c) => (c === 'result' ? null : 'result'))}
                  >
                    <span>RESULT</span>
                    <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'result' ? styles.filterIconActive : ''}`} />
                    {resultFilter && <span className={styles.filterDot} />}
                  </button>
                  {activeHeaderFilter === 'result' && (
                    <div className={`${styles.filterPopover} ${styles.popoverRight}`}>
                      <div className={styles.popoverHeader}>
                        <span className={styles.popoverTitle}>Filter Result</span>
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

                <th>DETAILS</th>
              </tr>
            ) : (
              <tr>
                {/* TIME */}
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

                {/* SERVICE */}
                <th className={styles.thFilterable}>
                  <button
                    type="button"
                    className={`${styles.thFilterBtn} ${service ? styles.thFilterBtnActive : ''}`}
                    onClick={() => setActiveHeaderFilter((c) => (c === 'service' ? null : 'service'))}
                  >
                    <span>SERVICE</span>
                    <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'service' ? styles.filterIconActive : ''}`} />
                    {service && <span className={styles.filterDot} />}
                  </button>
                  {activeHeaderFilter === 'service' && (
                    <div className={styles.filterPopover}>
                      <div className={styles.popoverHeader}>
                        <span className={styles.popoverTitle}>Filter Service</span>
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

                {/* ACTOR */}
                <th className={styles.thFilterable}>
                  <button
                    type="button"
                    className={`${styles.thFilterBtn} ${actorSearch ? styles.thFilterBtnActive : ''}`}
                    onClick={() => setActiveHeaderFilter((c) => (c === 'actor' ? null : 'actor'))}
                  >
                    <span>ACTOR</span>
                    <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'actor' ? styles.filterIconActive : ''}`} />
                    {actorSearch && <span className={styles.filterDot} />}
                  </button>
                  {activeHeaderFilter === 'actor' && (
                    <div className={styles.filterPopover}>
                      <div className={styles.popoverHeader}>
                        <span className={styles.popoverTitle}>Filter Actor</span>
                        {actorSearch && <button type="button" className={styles.popoverClearBtn} onClick={() => setActorSearch('')}>Reset</button>}
                      </div>
                      <input
                        type="text"
                        className={styles.popoverInput}
                        placeholder="Search actor name..."
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
                    <div className={`${styles.filterPopover} ${styles.popoverRight}`}>
                      <div className={styles.popoverHeader}>
                        <span className={styles.popoverTitle}>Search Entity</span>
                        {entitySearch && <button type="button" className={styles.popoverClearBtn} onClick={() => setEntitySearch('')}>Reset</button>}
                      </div>
                      <input
                        type="text"
                        className={styles.popoverInput}
                        placeholder="Filter by entity type or label..."
                        value={entitySearch}
                        onChange={(e) => setEntitySearch(e.target.value)}
                        autoFocus
                      />
                    </div>
                  )}
                </th>

                <th>DETAILS</th>
              </tr>
            )}
          </thead>
          <tbody>
            {logs === null ? (
              Array.from({ length: pageSize > 15 ? 10 : pageSize }).map((_, i) => (
                <tr key={i} className={styles.skeletonTableRow}>
                  {isLoginTab ? (
                    <>
                      <td><SkeletonBlock width={130} height={16} radius="4px" /></td>
                      <td>
                        <div className={styles.actorCell}>
                          <SkeletonBlock width={28} height={28} radius="8px" />
                          <SkeletonBlock width={110} height={16} radius="4px" />
                        </div>
                      </td>
                      <td><SkeletonBlock width={60} height={22} radius="999px" /></td>
                      <td><SkeletonBlock width={95} height={22} radius="6px" /></td>
                      <td>
                        <div className={styles.devicePillGroup}>
                          <SkeletonBlock width={75} height={22} radius="6px" />
                          <SkeletonBlock width={60} height={22} radius="6px" />
                        </div>
                      </td>
                      <td><SkeletonBlock width={70} height={22} radius="999px" /></td>
                      <td><SkeletonBlock width={52} height={26} radius="7px" /></td>
                    </>
                  ) : (
                    <>
                      <td><SkeletonBlock width={130} height={16} radius="4px" /></td>
                      <td><SkeletonBlock width={90} height={22} radius="999px" /></td>
                      <td>
                        <div className={styles.actorCell}>
                          <SkeletonBlock width={28} height={28} radius="8px" />
                          <SkeletonBlock width={100} height={16} radius="4px" />
                        </div>
                      </td>
                      <td><SkeletonBlock width={120} height={22} radius="6px" /></td>
                      <td>
                        <div className={styles.entityWrap}>
                          <SkeletonBlock width={70} height={16} radius="4px" />
                          <SkeletonBlock width={45} height={16} radius="4px" />
                        </div>
                      </td>
                      <td><SkeletonBlock width={52} height={26} radius="7px" /></td>
                    </>
                  )}
                </tr>
              ))
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={isLoginTab ? 7 : 6} className={styles.emptyCell}>
                  No audit records found matching the selected filters.
                </td>
              </tr>
            ) : (
              logs.map((log) => {
                const initial = (log.actorName || log.actorUserId || 'S').charAt(0).toUpperCase()

                return isLoginTab ? (
                  <tr key={log.id}>
                    <td className={styles.timeCell}>{formatTimestamp(log.occurredAt)}</td>
                    <td>
                      <div className={styles.actorCell}>
                        <span className={styles.actorAvatar}>{initial}</span>
                        <span className={styles.actorName}>
                          {log.actorName ?? <span className={styles.mutedText}>Unknown</span>}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={styles.authPill}>{log.authMethod ?? 'Local'}</span>
                    </td>
                    <td>
                      {log.sourceIp ? (
                        <span className={styles.ipBadge}>
                          <span className={styles.ipDot} aria-hidden="true" />
                          {formatIpv4(log.sourceIp)}
                        </span>
                      ) : (
                        <span className={styles.mutedText}>—</span>
                      )}
                    </td>
                    <td
                      className={`${styles.deviceCell} ${log.userAgent ? styles.deviceCellClickable : ''}`}
                      onClick={() => setViewingLog(log)}
                      title="Click to view full details"
                    >
                      {(() => {
                        const parsed = parseUserAgent(log.userAgent)
                        if (!parsed) return <span className={styles.mutedText}>{log.userAgent ?? '—'}</span>
                        return (
                          <div className={styles.devicePillGroup}>
                            <span className={styles.browserPill}>{parsed.browser}</span>
                            <span className={styles.osPill}>{parsed.os}</span>
                          </div>
                        )
                      })()}
                    </td>
                    <td>
                      <Badge tone={log.result === 'Success' ? 'success' : 'danger'} dot>
                        {log.result}
                      </Badge>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.viewDetailBtn}
                        onClick={() => setViewingLog(log)}
                        title="View full details"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={log.id}>
                    <td className={styles.timeCell}>{formatTimestamp(log.occurredAt)}</td>
                    <td>
                      <Badge tone={serviceTone(log.serviceName)}>{log.serviceName}</Badge>
                    </td>
                    <td>
                      <div className={styles.actorCell}>
                        <span className={styles.actorAvatar}>{initial}</span>
                        <span className={styles.actorName}>
                          {log.actorName ?? <span className={styles.mutedText}>System</span>}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={styles.actionCell} title={log.action}>{formatActionLabel(log.action)}</span>
                    </td>
                    <td>
                      {log.entityType ? (
                        <div className={styles.entityWrap}>
                          <span className={styles.entityType}>{log.entityType}</span>
                          {log.entityLabel && (
                            <span className={styles.entityId} title={log.entityLabel}>
                              {log.entityLabel}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className={styles.mutedText}>—</span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.viewDetailBtn}
                        onClick={() => setViewingLog(log)}
                        title="View full details"
                      >
                        View
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
          <button
            type="button"
            className={styles.pageBtn}
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            &lt; Previous
          </button>
          <span className={styles.pageIndicator}>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className={styles.pageBtn}
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next &gt;
          </button>
        </div>
      )}

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
                    <h2 className={drawerStyles.title}>Audit Record Details</h2>
                    <p className={drawerStyles.subtitle}>Full event context, actor, and execution metadata</p>
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
                          Overview
                        </h3>
                        <dl className={styles.detailList}>
                          <div className={styles.detailRow}>
                            <span className={styles.detailIcon}>
                              <Icon.Layers width={15} height={15} />
                            </span>
                            <div className={styles.detailRowBody}>
                              <dt className={styles.detailRowLabel}>Service</dt>
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
                              <dt className={styles.detailRowLabel}>Action</dt>
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
                              <dt className={styles.detailRowLabel}>Result</dt>
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
                              <dt className={styles.detailRowLabel}>Timestamp</dt>
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
                          Event Timeline
                        </h3>
                        <div className={styles.timeline}>
                          <div className={styles.timelineStep}>
                            <span className={styles.timelineDot} />
                            <div className={styles.timelineStepCard}>
                              <span className={styles.timelineLabel}>
                                Triggered by {viewingLog.actorName ?? 'System'}
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
                                  ? 'Event Completed Successfully'
                                  : 'Event Execution Failed'}
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
                              <strong>Failure Reason:</strong> {viewingLog.failureReason}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>

                  {/* 2. Actor & Authentication Context */}
                  <section className={styles.drawerSection}>
                    <h3 className={styles.drawerSectionTitle}>
                      <Icon.User width={12} height={12} />
                      Actor &amp; Authentication Context
                    </h3>
                    <div className={styles.fieldCardGrid}>
                      <div className={styles.fieldCard}>
                        <span className={styles.fieldCardIcon}>
                          <Icon.User width={15} height={15} />
                        </span>
                        <div className={styles.fieldCardBody}>
                          <span className={styles.fieldCardLabel}>Actor Name</span>
                          <span className={styles.fieldCardValue}>
                            {viewingLog.actorName ?? 'System'}
                          </span>
                        </div>
                      </div>

                      <div className={styles.fieldCard}>
                        <span className={styles.fieldCardIcon}>
                          <Icon.Key width={15} height={15} />
                        </span>
                        <div className={styles.fieldCardBody}>
                          <span className={styles.fieldCardLabel}>Actor ID</span>
                          <span className={`${styles.fieldCardValue} ${styles.monoText}`}>
                            {viewingLog.actorUserId ? (
                              viewingLog.actorUserId.length > 22
                                ? `${viewingLog.actorUserId.slice(0, 10)}…${viewingLog.actorUserId.slice(-8)}`
                                : viewingLog.actorUserId
                            ) : (
                              'System / None'
                            )}
                          </span>
                        </div>
                      </div>

                      <div className={styles.fieldCard}>
                        <span className={styles.fieldCardIcon}>
                          <Icon.Shield width={15} height={15} />
                        </span>
                        <div className={styles.fieldCardBody}>
                          <span className={styles.fieldCardLabel}>Auth Method</span>
                          <span className={styles.fieldCardValue}>
                            {viewingLog.authMethod ? (
                              <span className={styles.authPill}>{viewingLog.authMethod}</span>
                            ) : (
                              <span className={styles.mutedText}>Not recorded</span>
                            )}
                          </span>
                        </div>
                      </div>

                      <div className={styles.fieldCard}>
                        <span className={styles.fieldCardIcon}>
                          <Icon.Globe width={15} height={15} />
                        </span>
                        <div className={styles.fieldCardBody}>
                          <span className={styles.fieldCardLabel}>Client IP (IPv4)</span>
                          <span className={styles.fieldCardValue}>
                            <span className={styles.ipBadge}>
                              <span className={styles.ipDot} />
                              {formatIpv4(viewingLog.sourceIp)}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* 3. Device & Environment Context */}
                  <section className={styles.drawerSection}>
                    <h3 className={styles.drawerSectionTitle}>
                      <Icon.Globe width={12} height={12} />
                      Device &amp; Environment Context
                    </h3>
                    {(() => {
                      const parsed = parseUserAgent(viewingLog.userAgent)
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div className={styles.fieldCardGrid}>
                            <div className={styles.fieldCard}>
                              <span className={styles.fieldCardIcon}>
                                <Icon.Globe width={15} height={15} />
                              </span>
                              <div className={styles.fieldCardBody}>
                                <span className={styles.fieldCardLabel}>Browser</span>
                                <span className={styles.fieldCardValue}>
                                  {parsed ? (
                                    <span className={styles.browserPill}>{parsed.browser}</span>
                                  ) : (
                                    <span className={styles.mutedText}>—</span>
                                  )}
                                </span>
                              </div>
                            </div>

                            <div className={styles.fieldCard}>
                              <span className={styles.fieldCardIcon}>
                                <Icon.Box width={15} height={15} />
                              </span>
                              <div className={styles.fieldCardBody}>
                                <span className={styles.fieldCardLabel}>Operating System</span>
                                <span className={styles.fieldCardValue}>
                                  {parsed ? (
                                    <span className={styles.osPill}>{parsed.os}</span>
                                  ) : (
                                    <span className={styles.mutedText}>—</span>
                                  )}
                                </span>
                              </div>
                            </div>
                          </div>

                          {viewingLog.userAgent && (
                            <div>
                              <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                                Raw User Agent
                              </div>
                              <pre className={styles.payloadCodeBox}>{viewingLog.userAgent}</pre>
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </section>

                  {/* 4. Target Entity (if present) */}
                  {viewingLog.entityType && (
                    <section className={styles.drawerSection}>
                      <h3 className={styles.drawerSectionTitle}>
                        <Icon.Box width={12} height={12} />
                        Target Entity
                      </h3>
                      <div className={styles.fieldCardGrid}>
                        <div className={styles.fieldCard}>
                          <span className={styles.fieldCardIcon}>
                            <Icon.Layers width={15} height={15} />
                          </span>
                          <div className={styles.fieldCardBody}>
                            <span className={styles.fieldCardLabel}>Entity Type</span>
                            <span className={styles.fieldCardValue}>
                              <Badge tone="neutral">{viewingLog.entityType}</Badge>
                            </span>
                          </div>
                        </div>

                        <div className={styles.fieldCard}>
                          <span className={styles.fieldCardIcon}>
                            <Icon.FileText width={15} height={15} />
                          </span>
                          <div className={styles.fieldCardBody}>
                            <span className={styles.fieldCardLabel}>Entity Name / Label</span>
                            <span className={styles.fieldCardValue}>
                              {viewingLog.entityLabel ?? <span className={styles.mutedText}>Not recorded</span>}
                            </span>
                          </div>
                        </div>

                        {viewingLog.entityId && (
                          <div className={styles.fieldCard} style={{ gridColumn: '1 / -1' }}>
                            <span className={styles.fieldCardIcon}>
                              <Icon.Key width={15} height={15} />
                            </span>
                            <div className={styles.fieldCardBody}>
                              <span className={styles.fieldCardLabel}>Entity ID / Key</span>
                              <span className={`${styles.fieldCardValue} ${styles.monoText}`}>
                                {viewingLog.entityId}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {/* 5. Event Details & Payload (if present) */}
                  {viewingLog.details && (
                    <section className={styles.drawerSection}>
                      <h3 className={styles.drawerSectionTitle}>
                        <Icon.FileText width={12} height={12} />
                        Event Details &amp; Payload
                      </h3>
                      <pre className={styles.payloadCodeBox}>{viewingLog.details}</pre>
                    </section>
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
