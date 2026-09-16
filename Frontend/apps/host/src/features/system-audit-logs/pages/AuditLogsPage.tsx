import { useCallback, useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../../auth/store/authStore'
import { queryKeys } from '../../../shared/query/queryKeys'
import { useLiveRefetchInterval } from '../../../shared/query/invalidationBridge'
import { ActorCell, Badge, CsvExportError, DataTable, DateRangeColumnFilter, DateRangeFilterButton, EMPTY_DATE_RANGE, EMPTY_VALUE, FilterBar, PageHeader, Pagination, ResponsiveRows, RowAction, RowsPerPage, describeDateRange, describeTruncation, formatAuditTimestamp, isDateRangeActive, readStoredPageSize, resolveDateRange, sanitizeFilterInput, filterTypeBlockedMessage, useCommittedFilter, type ActiveFilter, type CommittedFilter, type DateRangeValue } from '@omniremit/ui'
import { PermissionGate } from '../../../shared/components/PermissionGate/PermissionGate'
import { ApiError } from '../../../shared/api/httpClient'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue'
import { auditLogsApi, type AuditLogDto, type ListAuditLogsParams } from '../api/auditLogsApi'
import { formatActionLabel, actionChipClass, formatIpv4 } from '../utils/auditLogFormatting'
import { Icon } from '../../../shared/components/Icon/Icon'
import { AuditLogDetailDrawer, serviceTone, parseUserAgent } from '../components/AuditLogDetailDrawer/AuditLogDetailDrawer'
import { OperationTimeline } from '../components/OperationTimeline/OperationTimeline'
import styles from './AuditLogsPage.module.css'

const FEATURE = 'host.system.audit-logs'
const DEFAULT_PAGE_SIZE = 10

/* Audit timestamps come from @omniremit/ui so the two remotes render the same shape. */
const formatTimestamp = formatAuditTimestamp

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
  const [searchParams, setSearchParams] = useSearchParams()

  // Scopes the whole page to one operation's audit trail — set by "View related events" in the detail
  // drawer, or by pasting a shared link. URL-driven (not just component state) so that link works.
  const [correlationId, setCorrelationId] = useState(() => searchParams.get('correlationId') ?? '')
  function clearCorrelationId() {
    setCorrelationId('')
    const next = new URLSearchParams(searchParams)
    next.delete('correlationId')
    setSearchParams(next, { replace: true })
  }

  // Defaults to all activity, not to failures. See the tablist below for why.
  const [activeTab, setActiveTab] = useState<TabId>(TAB_IDS.auditEvents)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => readStoredPageSize('host.audit', DEFAULT_PAGE_SIZE))

  // Popover state
  const [activeHeaderFilter, setActiveHeaderFilter] = useState<string | null>(null)

  // The shared date range — one value replacing nine pieces of state and two local helpers.
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE)

  /*
   * Actor, Record, IP and Device are free-text popovers where the box used to BE the filter: every
   * debounce tick refetched the table while simultaneously re-narrowing the "known values" list you
   * were reading. useCommittedFilter splits the two — `query` drives the recommendations, `applied`
   * drives the fetch — so typing is free and the table moves exactly once, on Enter or on picking a
   * value. (Application, Action, Auth and Outcome never had the problem: their boxes only ever
   * narrowed a list and the filter changed on click.)
   */
  const actorFilter = useCommittedFilter()
  const recordFilter = useCommittedFilter()
  const ipFilter = useCommittedFilter()
  const deviceFilter = useCommittedFilter()

  /**
   * Enter applies whatever is typed and closes the popover — the escape hatch that keeps these
   * boxes useful for a value with no suggestion behind it (a one-off IP, a record this page of
   * results does not happen to contain).
   */
  const commitOnEnter = (f: CommittedFilter) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    f.commit()
    setActiveHeaderFilter(null)
  }

  // Service filter & search
  const [service, setService] = useState('')
  const [serviceSearch, setServiceSearch] = useState('')

  // Actor search — a person's name, so only letters are accepted; `actorSearchBlocked` flags the
  // instant after a keystroke that got stripped, driving a "why won't it let me type that" hint.
  const [actorSearchBlocked, setActorSearchBlocked] = useState(false)
  function handleActorSearchChange(raw: string) {
    const clean = sanitizeFilterInput(raw, 'alpha')
    actorFilter.setQuery(clean)
    setActorSearchBlocked(clean !== raw)
  }

  // Action filter & search
  const [actionFilter, setActionFilter] = useState('')
  const [actionSearch, setActionSearch] = useState('')

  // Sign-in specific filters
  const [authMethodFilter, setAuthMethodFilter] = useState('')
  // An IPv4 address is digits and dots only.
  const [ipSearchBlocked, setIpSearchBlocked] = useState(false)
  function handleIpSearchChange(raw: string) {
    const clean = sanitizeFilterInput(raw, 'numeric')
    ipFilter.setQuery(clean)
    setIpSearchBlocked(clean !== raw)
  }
  const [resultFilter, setResultFilter] = useState<'' | 'Success' | 'Failure'>('')

  // Debounced TYPED text — these feed the recommendation lists only. What the table is filtered by
  // is `actorFilter.applied` / `recordFilter.applied` / `ipFilter.applied` / `deviceFilter.applied`, which change on commit.
  const debouncedServiceSearch = useDebouncedValue(serviceSearch, 200)
  const debouncedActor = useDebouncedValue(actorFilter.query, 200)
  const debouncedEntity = useDebouncedValue(recordFilter.query, 200)
  const debouncedIp = useDebouncedValue(ipFilter.query, 200)
  const debouncedDevice = useDebouncedValue(deviceFilter.query, 200)

  /** Export outcome (truncation warning or failure). The list's own load error comes from its query. */
  const [error, setError] = useState<string | null>(null)
  const [viewingLog, setViewingLog] = useState<AuditLogDto | null>(null)
  const queryClient = useQueryClient()
  const refetchInterval = useLiveRefetchInterval()
  const [exporting, setExporting] = useState(false)

  /*
   * The rows currently on screen, used ONLY to suggest values for the four unbounded columns —
   * actor, record, IP and device. A DISTINCT over actor names or addresses is a full table scan, so
   * those cannot be faceted the way the bounded columns are.
   *
   * The honest trade, and it is the inverse of what this page used to do: the SUGGESTIONS narrow to
   * what is on screen, while the FILTER is server-side and complete. Before, the suggestions looked
   * complete and the filter was not.
   */

  /*
   * Opening the drawer no longer writes an audit row.
   *
   * It used to POST an "audit_log.details_viewed" event, but expanding a row the browser already
   * holds is not a backend event — nothing is fetched, nothing is authorized, and the row said only
   * that a client claimed to have opened a drawer. Audit rows are now written exclusively by the
   * service performing an action, from the verified token; a trail the browser can write into is
   * not evidence of anything.
   */
  const handleOpenDetail = useCallback((log: AuditLogDto) => {
    setViewingLog(log)
  }, [])

  const range = useMemo(() => resolveDateRange(dateRange), [dateRange])

  /**
   * Every filter this screen applies, as the query parameters the server understands.
   *
   * One builder shared by the list, the summary, the facets and the export — which is the point.
   * The export used to assemble its own subset and silently dropped the IP, device and sign-in
   * method filters, so the CSV answered a different question from the table it was launched from.
   */
  const buildFilterParams = useCallback((): ListAuditLogsParams => ({
    service: service || undefined,
    action: actionFilter || TAB_ACTION_FILTER[activeTab],
    result:
      resultFilter ||
      (activeTab === TAB_IDS.loginErrors ? 'Failure' : activeTab === TAB_IDS.loginSuccesses ? 'Success' : undefined),
    actorName: actorFilter.applied || undefined,
    entityId: recordFilter.applied || undefined,
    authMethod: authMethodFilter || undefined,
    sourceIp: ipFilter.applied || undefined,
    device: deviceFilter.applied || undefined,
    correlationId: correlationId || undefined,
    ...range,
  }), [
    service, actionFilter, activeTab, resultFilter, actorFilter.applied, recordFilter.applied,
    authMethodFilter, ipFilter.applied, deviceFilter.applied, correlationId, range,
  ])

  const filterParams = useMemo(() => buildFilterParams(), [buildFilterParams])
  const listParams = useMemo<ListAuditLogsParams>(
    () => ({
      ...filterParams,
      // One operation is shown whole, oldest first, never split across pages — its later steps would
      // otherwise disappear behind "page 2" of a story that is only a handful of rows long.
      ...(correlationId ? { page: 1, pageSize: 100, sortDir: 'asc' as const } : { page, pageSize }),
    }),
    [filterParams, correlationId, page, pageSize],
  )

  /*
   * Cached queries, keyed by exactly what is shown. Leaving this page and coming back renders the rows
   * already fetched at once and revalidates in the background; a live update marks them stale through
   * the invalidation bridge. Previously every visit started from an empty table and refetched all three.
   *
   * Every filter is a server-side predicate and paging is the server's — see AuditLogFilter.
   */
  const listQuery = useQuery({
    queryKey: queryKeys.auditLogPages.list(listParams),
    enabled: Boolean(accessToken),
    placeholderData: keepPreviousData,
    refetchInterval,
    queryFn: ({ signal }) => auditLogsApi.list(accessToken!, listParams, signal),
  })
  const summaryQuery = useQuery({
    queryKey: queryKeys.auditLogPages.summary(range),
    enabled: Boolean(accessToken),
    placeholderData: keepPreviousData,
    refetchInterval,
    queryFn: () => auditLogsApi.summary(accessToken!, range),
  })
  // The bounded columns' options, under the same filters the table shows. A failure empties the
  // dropdowns rather than the table: facets are an affordance, and losing them must not look like
  // losing the data.
  const facetsQuery = useQuery({
    queryKey: queryKeys.auditLogPages.facets(filterParams),
    enabled: Boolean(accessToken),
    placeholderData: keepPreviousData,
    refetchInterval,
    queryFn: ({ signal }) => auditLogsApi.facets(accessToken!, filterParams, signal),
  })

  const logs: AuditLogDto[] | null = listQuery.isError ? [] : (listQuery.data?.items ?? null)
  const total = listQuery.data?.total ?? 0
  const summary = summaryQuery.data ?? null
  const facets = facetsQuery.isError ? null : (facetsQuery.data ?? null)
  const listError = listQuery.isError
    ? listQuery.error instanceof ApiError ? listQuery.error.message : 'Could not load audit logs.'
    : null
  const suggestionPool = logs ?? []

  /*
   * Zero extra API call: unique actors from the rows already loaded.
   *
   * This list did not narrow as you typed — it was built from `suggestionPool` alone, with the search
   * box's value absent from the dependency array, so "Known Actors" stayed identical no matter what
   * was in the box next to it. Typing a name is exactly when you most want it to shrink to that
   * name. Empty box still shows everything, which is the browse affordance the section is for, and
   * matches how the Service and IP lists below already behave.
   */
  const availableActors = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    for (const r of suggestionPool) {
      const name = r.actorName || r.actorUserId
      if (name) map.set(name.toLowerCase(), { id: r.actorUserId || r.id, name })
    }
    // The name already applied is dropped: re-picking it changes nothing and it displaces a real
    // alternative. Same rule on every list below.
    const list = Array.from(map.values()).filter((a) => a.name.toLowerCase() !== actorFilter.applied.toLowerCase())
    if (!debouncedActor.trim()) return list
    const q = debouncedActor.toLowerCase().trim()
    return list.filter((a) => a.name.toLowerCase().includes(q))
  }, [suggestionPool, debouncedActor, actorFilter.applied])

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
  /*
   * The bounded columns' options come from the server now, not from the rows on screen.
   *
   * Deriving them client-side worked only because the page pre-fetched 200 rows; with genuine
   * paging a ten-row page would offer a ten-value dropdown. And even with the pre-fetch the lists
   * ignored the OTHER active filters, so the Action dropdown happily offered actions that the chosen
   * Application had already excluded — pick one and get an empty table.
   *
   * The facets endpoint answers under the same filter set the table is showing, so every option it
   * offers returns at least one row.
   */
  const availableServices = useMemo(() => {
    const list = [...(facets?.services ?? [])].sort((a, b) => a.localeCompare(b))
    // Narrowed by the SEARCH BOX (serviceSearch), not by the applied filter (`service`) — these are
    // two different things here, unlike the actor/IP/device popovers where the box is the filter.
    if (!debouncedServiceSearch.trim()) return list
    const q = debouncedServiceSearch.toLowerCase().trim()
    return list.filter((s) => s.toLowerCase().includes(q))
  }, [facets, debouncedServiceSearch])

  const availableActions = useMemo(() => {
    // From the facets endpoint, under the same filters the table is showing.
    const entries = (facets?.actions ?? []).map((a) => ({ raw: a.action, label: formatActionLabel(a.action) }))

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
  }, [facets, actionSearch])

  const availableAuthMethods = useMemo(
    () => [...(facets?.authMethods ?? [])].sort((a, b) => a.localeCompare(b)),
    [facets],
  )

  // Zero extra API call: extract unique IPv4 addresses
  const availableIps = useMemo(() => {
    const set = new Set<string>()
    for (const r of suggestionPool) {
      if (r.sourceIp) {
        const clean = formatIpv4(r.sourceIp)
        if (clean && clean !== '—') set.add(clean)
      }
    }
    const list = Array.from(set).filter((v) => v !== ipFilter.applied)
    if (!debouncedIp.trim()) return list
    const q = debouncedIp.toLowerCase().trim()
    return list.filter((ip) => ip.toLowerCase().includes(q))
  }, [suggestionPool, debouncedIp, ipFilter.applied])

  /*
   * Zero extra API call: unique records touched, for the RECORD column's popover.
   *
   * That popover was the only one in this table offering a bare text box and no list at all — you
   * had to already know what a record was called to filter by it. Same treatment as Known IPs
   * above: everything when the box is empty, narrowed once you type.
   */
  const availableEntities = useMemo(() => {
    const set = new Set<string>()
    for (const r of suggestionPool) {
      const label = r.entityLabel || (r.module && r.page ? `${r.module} — ${r.page}` : r.page) || r.entityType
      if (label) set.add(label)
    }
    const list = Array.from(set).sort((a, b) => a.localeCompare(b)).filter((v) => v !== recordFilter.applied)
    if (!debouncedEntity.trim()) return list
    const q = debouncedEntity.toLowerCase().trim()
    return list.filter((e) => e.toLowerCase().includes(q))
  }, [suggestionPool, debouncedEntity, recordFilter.applied])

  // Zero extra API call: extract unique browser and OS / device options
  const availableDevices = useMemo(() => {
    const browserSet = new Set<string>()
    const osSet = new Set<string>()
    for (const r of suggestionPool) {
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
      const pool = arr.filter((v) => v.toLowerCase() !== deviceFilter.applied.toLowerCase())
      if (!debouncedDevice.trim()) return pool
      const q = debouncedDevice.toLowerCase().trim()
      return pool.filter((item) => item.toLowerCase().includes(q))
    }

    return {
      browsers: filterList(browsers),
      oses: filterList(oses),
    }
  }, [suggestionPool, debouncedDevice, deviceFilter.applied])

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


  // Changing the filter or page size invalidates the page number. One dependency now, because
  // buildFilterParams already closes over every filter there is.
  useEffect(() => {
    setPage(1)
  }, [buildFilterParams, pageSize])

  /**
   * Exports exactly what is on screen.
   *
   * @remarks
   * It sends the same {@link buildFilterParams} the table sends, which it did not before: the
   * previous version assembled its own subset and silently omitted the IP, device and sign-in
   * method filters, so a CSV taken from a filtered view answered a broader question than the view
   * did — and said nothing about it.
   */
  async function handleExport() {
    if (!accessToken) return
    setExporting(true)
    setError(null)
    try {
      const result = await auditLogsApi.exportCsv(accessToken, buildFilterParams())

      // A capped export is a warning, not a success. The file used to arrive holding the newest
      // 10,000 rows of a larger match with nothing to say so.
      setError(describeTruncation(result))
    } catch (err) {
      setError(err instanceof CsvExportError ? err.message : 'Could not export audit logs.')
    } finally {
      setExporting(false)
    }
  }

  // Handler for the page-size preset or custom selection
  function clearAllFilters() {
    setService('')
    setServiceSearch('')
    actorFilter.clear()
    setActionFilter('')
    setActionSearch('')
    recordFilter.clear()
    setAuthMethodFilter('')
    ipFilter.clear()
    deviceFilter.clear()
    setResultFilter('')
    setDateRange(EMPTY_DATE_RANGE)
    clearCorrelationId()
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
          /* The shared control, replacing a preset button group that duplicated the Time column's
             own popover and disagreed with the two other log screens about what a range means. */
          <DateRangeFilterButton label="Date Range" value={dateRange} onChange={setDateRange} />
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
          {/* Rows-per-page dropdown — meaningless once an operation's whole (unpaginated) story is
              on screen, so hidden rather than left controlling nothing. */}
          {/* The shared control — same presets and Custom entry this page defined, now with the
              choice remembered per table so it survives navigation and reload. */}
          {!correlationId && (
            <RowsPerPage
              storageKey="host.audit"
              value={pageSize}
              onChange={(n) => {
                setPageSize(n)
                setPage(1)
              }}
            />
          )}

          <button
            type="button"
            className={styles.refreshBtn}
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ['auditLogs'] })
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
          isDateRangeActive(dateRange) && {
            key: 'time',
            label: 'Time',
            value: describeDateRange(dateRange),
            onRemove: () => setDateRange(EMPTY_DATE_RANGE),
          },
          service && { key: 'service', label: 'Service', value: service, onRemove: () => setService('') },
          actorFilter.applied && { key: 'actor', label: 'Performed By', value: `"${actorFilter.applied}"`, onRemove: () => actorFilter.clear() },
          actionFilter && { key: 'action', label: 'Action', value: actionFilter, onRemove: () => setActionFilter('') },
          recordFilter.applied && { key: 'entity', label: 'Record', value: `"${recordFilter.applied}"`, onRemove: () => recordFilter.clear() },
          authMethodFilter && { key: 'auth', label: 'Auth', value: authMethodFilter, onRemove: () => setAuthMethodFilter('') },
          ipFilter.applied && { key: 'ip', label: 'IP', value: `"${ipFilter.applied}"`, onRemove: () => ipFilter.clear() },
          deviceFilter.applied && { key: 'device', label: 'Device', value: `"${deviceFilter.applied}"`, onRemove: () => deviceFilter.clear() },
          resultFilter && { key: 'result', label: 'Result', value: resultFilter, onRemove: () => setResultFilter('') },
          correlationId && { key: 'correlation', label: 'Operation', value: `${total} event${total === 1 ? '' : 's'}`, onRemove: clearCorrelationId },
        ].filter(Boolean) as ActiveFilter[]}
        onClearAll={clearAllFilters}
      />

      {(error ?? listError) && <div className={styles.errorBanner}>{error ?? listError}</div>}

      {/* Scoped to one operation: a connected thread telling the story in order, not a table meant
          for scanning many unrelated rows. */}
      {correlationId ? (
        logs === null ? (
          <p className={styles.timelineLoading}>Loading this operation's events…</p>
        ) : (
          <OperationTimeline logs={logs} onView={handleOpenDetail} />
        )
      ) : (
      <>
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
                    // The shared control, replacing ~100 lines of hand-rolled popover that duplicated
                    // the header's own preset row and had to be kept in step with it by hand.
                    header: (
                      <DateRangeColumnFilter
                        key="time"
                        label="TIME"
                        value={dateRange}
                        onChange={setDateRange}
                      />
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
                          className={`${styles.thFilterBtn} ${actorFilter.applied ? styles.thFilterBtnActive : ''}`}
                          onClick={() => setActiveHeaderFilter((c) => (c === 'actor' ? null : 'actor'))}
                        >
                          <span>PERFORMED BY</span>
                          <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'actor' ? styles.filterIconActive : ''}`} />
                          {actorFilter.applied && <span className={styles.filterDot} />}
                        </button>
                        {activeHeaderFilter === 'actor' && (
                          <div className={styles.filterPopover}>
                            <div className={styles.popoverHeader}>
                              <span className={styles.popoverTitle}>Filter Performed By</span>
                              {actorFilter.applied && <button type="button" className={styles.popoverClearBtn} onClick={() => actorFilter.clear()}>Reset</button>}
                            </div>
                            <input
                              type="text"
                              className={styles.popoverInput}
                              placeholder="Search name or email..."
                              value={actorFilter.query}
                              onChange={(e) => actorFilter.setQuery(e.target.value)}
                              onKeyDown={commitOnEnter(actorFilter)}
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
                                      className={`${styles.userItem} ${actorFilter.applied.toLowerCase() === a.name.toLowerCase() ? styles.userItemActive : ''}`}
                                      onClick={() => { actorFilter.commit(a.name); setActiveHeaderFilter(null) }}
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
                          className={`${styles.thFilterBtn} ${ipFilter.applied ? styles.thFilterBtnActive : ''}`}
                          onClick={() => setActiveHeaderFilter((c) => (c === 'ip' ? null : 'ip'))}
                        >
                          <span>IP ADDRESS</span>
                          <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'ip' ? styles.filterIconActive : ''}`} />
                          {ipFilter.applied && <span className={styles.filterDot} />}
                        </button>
                        {activeHeaderFilter === 'ip' && (
                          <div className={styles.filterPopover}>
                            <div className={styles.popoverHeader}>
                              <span className={styles.popoverTitle}>Filter IP Address</span>
                              {ipFilter.applied && <button type="button" className={styles.popoverClearBtn} onClick={() => { ipFilter.clear(); setIpSearchBlocked(false) }}>Reset</button>}
                            </div>
                            <input
                              type="text"
                              inputMode="numeric"
                              className={`${styles.popoverInput} ${ipSearchBlocked ? styles.popoverInputBlocked : ''}`}
                              placeholder="Search IP address..."
                              value={ipFilter.query}
                              onChange={(e) => handleIpSearchChange(e.target.value)}
                              onKeyDown={commitOnEnter(ipFilter)}
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
                                      className={`${styles.popoverItem} ${ipFilter.applied === ip ? styles.popoverItemActive : ''}`}
                                      onClick={() => { ipFilter.commit(ip); setActiveHeaderFilter(null) }}
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
                          className={`${styles.thFilterBtn} ${deviceFilter.applied ? styles.thFilterBtnActive : ''}`}
                          onClick={() => setActiveHeaderFilter((c) => (c === 'device' ? null : 'device'))}
                        >
                          <span>BROWSER / DEVICE</span>
                          <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'device' ? styles.filterIconActive : ''}`} />
                          {deviceFilter.applied && <span className={styles.filterDot} />}
                        </button>
                        {activeHeaderFilter === 'device' && (
                          <div className={`${styles.filterPopover} ${styles.popoverRight}`}>
                            <div className={styles.popoverHeader}>
                              <span className={styles.popoverTitle}>Filter Browser / Device</span>
                              {deviceFilter.applied && <button type="button" className={styles.popoverClearBtn} onClick={() => deviceFilter.clear()}>Reset</button>}
                            </div>
                            <input
                              type="text"
                              className={styles.popoverInput}
                              placeholder="Search browser or OS..."
                              value={deviceFilter.query}
                              onChange={(e) => deviceFilter.setQuery(e.target.value)}
                              onKeyDown={commitOnEnter(deviceFilter)}
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
                                        className={`${styles.popoverItem} ${deviceFilter.applied.toLowerCase() === b.toLowerCase() ? styles.popoverItemActive : ''}`}
                                        onClick={() => { deviceFilter.commit(b); setActiveHeaderFilter(null) }}
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
                                        className={`${styles.popoverItem} ${deviceFilter.applied.toLowerCase() === os.toLowerCase() ? styles.popoverItemActive : ''}`}
                                        onClick={() => { deviceFilter.commit(os); setActiveHeaderFilter(null) }}
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
                          onClick={() => handleOpenDetail(log)}
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
                    render: (log) => <RowAction onClick={() => handleOpenDetail(log)} title="View full details" />,
                  },
                  ]
                : [
                  {
                    key: 'time',
                    label: 'TIME',
                    priority: 'always',
                    // The same shared control the other tab's Time column uses — the two hand-rolled
                    // popovers this replaces were near-identical copies that had to be edited together.
                    header: (
                      <DateRangeColumnFilter
                        key="time"
                        label="TIME"
                        value={dateRange}
                        onChange={setDateRange}
                      />
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
                    render: (log) => {
                      const app = log.sourceApplication || log.serviceName
                      return <Badge tone={serviceTone(app)}>{app}</Badge>
                    },
                  },
                  {
                    key: 'actor',
                    label: 'PERFORMED BY',
                    priority: 'always',
                    header: (
                      <th className={styles.thFilterable}>
                        <button
                          type="button"
                          className={`${styles.thFilterBtn} ${actorFilter.applied ? styles.thFilterBtnActive : ''}`}
                          onClick={() => setActiveHeaderFilter((c) => (c === 'actor' ? null : 'actor'))}
                        >
                          <span>PERFORMED BY</span>
                          <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'actor' ? styles.filterIconActive : ''}`} />
                          {actorFilter.applied && <span className={styles.filterDot} />}
                        </button>
                        {activeHeaderFilter === 'actor' && (
                          <div className={styles.filterPopover}>
                            <div className={styles.popoverHeader}>
                              <span className={styles.popoverTitle}>Filter Performed By</span>
                              {actorFilter.applied && <button type="button" className={styles.popoverClearBtn} onClick={() => { actorFilter.clear(); setActorSearchBlocked(false) }}>Reset</button>}
                            </div>
                            <input
                              type="text"
                              inputMode="text"
                              className={`${styles.popoverInput} ${actorSearchBlocked ? styles.popoverInputBlocked : ''}`}
                              placeholder="Search by name..."
                              value={actorFilter.query}
                              onChange={(e) => handleActorSearchChange(e.target.value)}
                              onKeyDown={commitOnEnter(actorFilter)}
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
                                      className={`${styles.userItem} ${actorFilter.applied.toLowerCase() === a.name.toLowerCase() ? styles.userItemActive : ''}`}
                                      onClick={() => { actorFilter.commit(a.name); setActiveHeaderFilter(null) }}
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
                          className={`${styles.thFilterBtn} ${recordFilter.applied ? styles.thFilterBtnActive : ''}`}
                          onClick={() => setActiveHeaderFilter((c) => (c === 'entity' ? null : 'entity'))}
                        >
                          <span>RECORD</span>
                          <Icon.ChevronDown width={12} height={12} className={`${styles.filterIcon} ${activeHeaderFilter === 'entity' ? styles.filterIconActive : ''}`} />
                          {recordFilter.applied && <span className={styles.filterDot} />}
                        </button>
                        {activeHeaderFilter === 'entity' && (
                          <div className={`${styles.filterPopover} ${styles.popoverRight}`}>
                            <div className={styles.popoverHeader}>
                              <span className={styles.popoverTitle}>Search Entity</span>
                              {recordFilter.applied && <button type="button" className={styles.popoverClearBtn} onClick={() => recordFilter.clear()}>Reset</button>}
                            </div>
                            <input
                              type="text"
                              className={styles.popoverInput}
                              placeholder="Filter by record type or name..."
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
                    render: (log) => {
                      const type = log.entityType || (log.page || log.actionCategory === 'Navigation' ? 'Page' : null)
                      const label = log.entityLabel || (log.module && log.page ? `${log.module} — ${log.page}` : log.page || log.module)
                      if (type || label) {
                        return (
                          <div className={styles.entityWrap}>
                            {type && <span className={styles.entityType}>{type}</span>}
                            {label && (
                              <span className={styles.entityId} title={label}>
                                {label}
                              </span>
                            )}
                          </div>
                        )
                      }
                      return <span className={styles.mutedText}>{EMPTY_VALUE}</span>
                    },
                  },
                  {
                    key: 'details',
                    label: 'DETAILS',
                    priority: 'always',
                    align: 'right',
                    render: (log) => <RowAction onClick={() => handleOpenDetail(log)} title="View full details" />,
                  },
                ]}
              />
            </DataTable>
      </>
      )}

      {/* Record details drawer — opened per row by its "View" button (or, on the Sign-ins tabs, the
          device cell). The one shared AuditLogDetailDrawer, also used by a user's own Audit Log tab —
          enhancing it here enhances both. */}
      {viewingLog && (
        <AuditLogDetailDrawer
          log={viewingLog}
          accessToken={accessToken}
          onClose={() => setViewingLog(null)}
          onViewRelated={(cid) => {
            clearAllFilters()
            setCorrelationId(cid)
            const next = new URLSearchParams(searchParams)
            next.set('correlationId', cid)
            setSearchParams(next, { replace: true })
            setViewingLog(null)
          }}
        />
      )}
    </div>
  )
}
