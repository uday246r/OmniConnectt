import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../../auth/store/authStore'
import { queryKeys } from '../../../shared/query/queryKeys'
import { useLiveRefetchInterval } from '../../../shared/query/invalidationBridge'
import {
  Badge,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Pagination,
  ResponsiveRows,
  RowAction,
  RowsPerPage,
  formatAuditTimestamp,
  readStoredPageSize,
  type ActiveFilter,
  type ResponsiveColumn,
  DateRangeFilterButton,
  EMPTY_DATE_RANGE,
  CsvExportError,
  describeDateRange,
  describeTruncation,
  isDateRangeActive,
  resolveDateRange,
  type DateRangeValue,
  Select,
} from '@omniconnect/ui'
import { PermissionGate } from '../../../shared/components/PermissionGate/PermissionGate'
import { ApiError } from '../../../shared/api/httpClient'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue'
import { systemLogsApi, type ListSystemLogsParams, type SystemLogDto, type SystemLogSummaryDto } from '../api/systemLogsApi'
import { Icon } from '../../../shared/components/Icon/Icon'
import { SystemLogDetailDrawer } from '../components/SystemLogDetailDrawer/SystemLogDetailDrawer'
import { environmentTone, formatEventCode, severityTone } from '../utils/systemLogFormatting'
import styles from './SystemLogsPage.module.css'

const FEATURE = 'host.system.system-logs'
const DEFAULT_PAGE_SIZE = 10


const TAB_IDS = {
  allEvents: 'all-events',
  errors: 'errors',
  warnings: 'warnings',
  critical: 'critical',
} as const

type TabId = (typeof TAB_IDS)[keyof typeof TAB_IDS]

export function SystemLogsPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const correlationId = searchParams.get('correlationId') ?? ''

  const [activeTab, setActiveTab] = useState<TabId>(TAB_IDS.allEvents)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => readStoredPageSize('host.system-logs', DEFAULT_PAGE_SIZE))

  // One shared date range, resolved to instants only where a request needs them.
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE)

  // Filters
  const [severityFilter, setSeverityFilter] = useState('')
  const [serviceFilter, setServiceFilter] = useState('')
  const [eventCodeFilter, setEventCodeFilter] = useState('')
  const [messageSearchRaw, setMessageSearchRaw] = useState('')
  const [environmentFilter, setEnvironmentFilter] = useState('')
  const [moduleFilter, setModuleFilter] = useState('')
  const [correlationSearch, setCorrelationSearch] = useState('')

  const messageSearch = useDebouncedValue(messageSearchRaw, 400)
  const [sortDir] = useState<'asc' | 'desc'>('desc')

  const [exporting, setExporting] = useState(false)
  /** An export outcome (truncation warning or failure) — shown above the table, never in place of it. */
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const [detailLog, setDetailLog] = useState<SystemLogDto | null>(null)
  const queryClient = useQueryClient()
  const refetchInterval = useLiveRefetchInterval()

  /* Opening the drawer writes no audit row — see AuditLogsPage.handleOpenDetail for why. */
  const handleViewDetail = useCallback((log: SystemLogDto) => {
    setDetailLog(log)
  }, [])

  // Tab-based severity mapping
  const finalSeverity = useMemo(() => {
    if (activeTab === TAB_IDS.errors) return 'Error'
    if (activeTab === TAB_IDS.warnings) return 'Warning'
    if (activeTab === TAB_IDS.critical) return 'Critical'
    return severityFilter
  }, [activeTab, severityFilter])

  const range = useMemo(() => resolveDateRange(dateRange), [dateRange])

  /** Every filter as the query parameters the server understands — shared by the list and the export. */
  const filterParams = useMemo<ListSystemLogsParams>(() => ({
    severity: finalSeverity || undefined,
    service: serviceFilter || undefined,
    eventCode: eventCodeFilter || undefined,
    messageSearch: messageSearch || undefined,
    environment: environmentFilter || undefined,
    module: moduleFilter || undefined,
    from: range.from,
    to: range.to,
    sortDir,
    correlationId: correlationSearch || correlationId || undefined,
  }), [finalSeverity, serviceFilter, eventCodeFilter, messageSearch, environmentFilter, moduleFilter, range, sortDir, correlationSearch, correlationId])

  const listParams = useMemo(() => ({ ...filterParams, page, pageSize }), [filterParams, page, pageSize])

  /*
   * Cached queries keyed by what is shown: coming back to this page renders the rows already fetched at
   * once and revalidates in the background, and a live update marks them stale through the invalidation
   * bridge. They used to be component state, refetched — with a skeleton — on every visit and every event.
   */
  const listQuery = useQuery({
    queryKey: queryKeys.systemLogs.list(listParams),
    enabled: Boolean(accessToken),
    placeholderData: keepPreviousData,
    refetchInterval,
    queryFn: ({ signal }) => systemLogsApi.list(accessToken!, listParams, signal),
  })
  const summaryQuery = useQuery({
    queryKey: queryKeys.systemLogs.summary(range),
    enabled: Boolean(accessToken),
    placeholderData: keepPreviousData,
    refetchInterval,
    queryFn: () => systemLogsApi.summary(accessToken!, range),
  })

  const logs = listQuery.data?.items ?? []
  const totalCount = listQuery.data?.total ?? 0
  const isLoading = listQuery.isPending
  const summary: SystemLogSummaryDto | null = summaryQuery.data ?? null
  const listError = listQuery.isError
    ? listQuery.error instanceof ApiError ? listQuery.error.message : 'Failed to load system logs'
    : null

  // Dropdown options: every value seen while browsing this session, capped. There is no facets endpoint
  // for system logs; the pool grows as pages and filters are visited.
  const poolRef = useRef(new Map<string, SystemLogDto>())
  const cachedPool = useMemo(() => {
    for (const row of listQuery.data?.items ?? []) poolRef.current.set(row.id, row)
    if (poolRef.current.size > 2000) {
      poolRef.current = new Map([...poolRef.current].slice(-2000))
    }
    return [...poolRef.current.values()]
  }, [listQuery.data])
  const availableServices = useMemo(() => [...new Set(cachedPool.map(r => r.serviceName))].sort(), [cachedPool])
  const availableEnvironments = useMemo(() => [...new Set(cachedPool.map(r => r.environment).filter(Boolean) as string[])].sort(), [cachedPool])
  const availableModules = useMemo(() => [...new Set(cachedPool.map(r => r.module).filter(Boolean) as string[])].sort(), [cachedPool])
  const availableEventCodes = useMemo(() => [...new Set(cachedPool.map(r => r.eventCode))].sort(), [cachedPool])

  // Reset page on filter change
  useEffect(() => { setPage(1) }, [activeTab, finalSeverity, serviceFilter, eventCodeFilter, messageSearch, environmentFilter, moduleFilter, range])

  const handleExport = async () => {
    if (!accessToken) return
    setExporting(true)
    setExportNotice(null)
    try {
      const result = await systemLogsApi.exportCsv(accessToken, filterParams)

      // A capped export is reported, not hidden. The file used to arrive containing the newest
      // 10,000 rows of a larger match, with a 200 and a filename and nothing to suggest that
      // anything was missing from it.
      const truncation = describeTruncation(result)
      if (truncation) setExportNotice(truncation)
    } catch (err) {
      setExportNotice(err instanceof CsvExportError ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.systemLogs.all() })
  }

  const handleClearFilters = () => {
    setServiceFilter(''); setEventCodeFilter(''); setSeverityFilter('')
    setMessageSearchRaw(''); setEnvironmentFilter(''); setModuleFilter('')
    setDateRange(EMPTY_DATE_RANGE)
    setCorrelationSearch(''); setPage(1)
  }

  const activeFilters = useMemo(() => {
    const active: ActiveFilter[] = []
    if (isDateRangeActive(dateRange)) active.push({ key: 'time', label: 'Time', value: describeDateRange(dateRange), onRemove: () => setDateRange(EMPTY_DATE_RANGE) })
    if (serviceFilter) active.push({ key: 'service', label: 'Service', value: serviceFilter, onRemove: () => setServiceFilter('') })
    if (environmentFilter) active.push({ key: 'env', label: 'Environment', value: environmentFilter, onRemove: () => setEnvironmentFilter('') })
    if (moduleFilter) active.push({ key: 'module', label: 'Module', value: moduleFilter, onRemove: () => setModuleFilter('') })
    if (eventCodeFilter) active.push({ key: 'eventCode', label: 'Event', value: formatEventCode(eventCodeFilter), onRemove: () => setEventCodeFilter('') })
    if (severityFilter && activeTab === TAB_IDS.allEvents) active.push({ key: 'severity', label: 'Severity', value: severityFilter, onRemove: () => setSeverityFilter('') })
    if (messageSearchRaw) active.push({ key: 'message', label: 'Message', value: `"${messageSearchRaw}"`, onRemove: () => setMessageSearchRaw('') })
    if (correlationSearch) active.push({ key: 'cid', label: 'Correlation ID', value: correlationSearch.slice(0, 8) + '…', onRemove: () => setCorrelationSearch('') })
    return active
  }, [serviceFilter, environmentFilter, moduleFilter, eventCodeFilter, severityFilter, messageSearchRaw, correlationSearch, activeTab, dateRange])

  // Close custom date popover on outside click
  const columns: ResponsiveColumn<SystemLogDto>[] = useMemo(() => [
    { key: 'time', label: 'TIME', priority: 'always', render: (l) => <span className={styles.timeCell}>{formatAuditTimestamp(l.occurredAt)}</span> },
    {
      key: 'severity', label: 'SEVERITY', priority: 'always',
      render: (l) => <Badge tone={severityTone(l.severity)}>{l.severity}</Badge>
    },
    { key: 'service', label: 'SERVICE', priority: 'high', render: (l) => <Badge tone="neutral">{l.serviceName}</Badge> },
    {
      key: 'environment', label: 'ENV', priority: 'low',
      render: (l) => l.environment ? <Badge tone={environmentTone(l.environment)}>{l.environment}</Badge> : <span className={styles.mutedText}>—</span>
    },
    // The readable event name; the raw code stays one hover away and under "Technical details".
    { key: 'eventCode', label: 'EVENT', priority: 'high', render: (l) => <span className={styles.eventCode} title={l.eventCode}>{formatEventCode(l.eventCode)}</span> },
    {
      key: 'message', label: 'MESSAGE', priority: 'always',
      render: (l) => <span className={styles.messageCell} title={l.message}>{l.message}</span>
    },
    { key: 'actions', label: '', priority: 'always', align: 'right', render: (l) => <RowAction onClick={() => handleViewDetail(l)}>View</RowAction> },
  ], [handleViewDetail])

  return (
    <div className={styles.page}>
      <PageHeader
        title="System Logs"
        pill={<><span className={styles.liveDot} />Live Stream</>}
        subtitle="Technical and operational event logs from all platform services — errors, warnings, health checks, and startup events."
        actions={
          /*
           * The shared control, replacing a hand-rolled preset row plus a bespoke popover.
           *
           * That popover had two problems worth naming. Its custom range was date-only — the state
           * for a time of day existed and no control ever wrote to it — so the one screen most
           * likely to need "between 14:00 and 15:00 when the errors started" could not express it.
           * And its outside-click handler had no Escape counterpart, so an open popover could only
           * be dismissed by clicking elsewhere.
           */
          <DateRangeFilterButton label="Date Range" value={dateRange} onChange={setDateRange} />
        }
      />

      {/* 5 Summary Stat Cards */}
      <div className={styles.summaryGrid}>
        <div className={`${styles.summaryCard} ${styles.summaryCardClickable}`} onClick={() => { setActiveTab(TAB_IDS.errors); setPage(1) }}>
          <div className={`${styles.summaryIcon} ${styles.iconRed}`}><Icon.AlertCircle width={18} height={18} /></div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Errors</span>
            <span className={styles.summaryValue}>{summary?.errorCount ?? '—'}</span>
          </div>
        </div>
        <div className={`${styles.summaryCard} ${styles.summaryCardClickable}`} onClick={() => { setActiveTab(TAB_IDS.critical); setPage(1) }}>
          <div className={`${styles.summaryIcon} ${styles.iconCritical}`}><Icon.AlertOctagon width={18} height={18} /></div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Critical</span>
            <span className={styles.summaryValue}>{summary?.criticalCount ?? '—'}</span>
          </div>
        </div>
        <div className={`${styles.summaryCard} ${styles.summaryCardClickable}`} onClick={() => { setActiveTab(TAB_IDS.warnings); setPage(1) }}>
          <div className={`${styles.summaryIcon} ${styles.iconAmber}`}><Icon.AlertTriangle width={18} height={18} /></div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Warnings</span>
            <span className={styles.summaryValue}>{summary?.warningCount ?? '—'}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconBlue}`}><Icon.Info width={18} height={18} /></div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Info / Debug</span>
            <span className={styles.summaryValue}>{summary?.infoCount ?? '—'}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconGreen}`}><Icon.Server width={18} height={18} /></div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Services Reporting</span>
            <span className={styles.summaryValue}>{summary?.servicesReporting ?? '—'}</span>
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className={styles.searchBar}>
        <div className={styles.searchInputWrap}>
          <Icon.Search width={15} height={15} className={styles.searchIcon} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search message text…"
            value={messageSearchRaw}
            onChange={e => setMessageSearchRaw(e.target.value)}
          />
          {messageSearchRaw && (
            <button type="button" className={styles.searchClear} onClick={() => setMessageSearchRaw('')}><Icon.X width={13} height={13} /></button>
          )}
        </div>

        {/* Service filter */}
        <div className={styles.filterCombo}>
          <Select aria-label="Service" size="sm" placeholder="All Services" clearLabel="All Services" value={serviceFilter} onChange={e => setServiceFilter(e.target.value)} options={availableServices.map(s => ({ value: s, label: s }))} />
        </div>

        {/* Environment filter */}
        <div className={styles.filterCombo}>
          <Select aria-label="Environment" size="sm" placeholder="All Environments" clearLabel="All Environments" value={environmentFilter} onChange={e => setEnvironmentFilter(e.target.value)} options={(availableEnvironments.length > 0 ? availableEnvironments : ['Production', 'Staging', 'Development']).map(env => ({ value: env, label: env }))} />
        </div>

        {/* Module filter */}
        {availableModules.length > 0 && (
          <div className={styles.filterCombo}>
            <Select aria-label="Module" size="sm" placeholder="All Modules" clearLabel="All Modules" value={moduleFilter} onChange={e => setModuleFilter(e.target.value)} options={availableModules.map(m => ({ value: m, label: m }))} />
          </div>
        )}

        {/* Event Code filter */}
        <div className={styles.filterCombo}>
          <Select aria-label="Event code" size="sm" placeholder="All Event Codes" clearLabel="All Event Codes" value={eventCodeFilter} onChange={e => setEventCodeFilter(e.target.value)} options={availableEventCodes.map(c => ({ value: c, label: formatEventCode(c) }))} />
        </div>

        {/* Correlation ID search */}
        <input
          type="text"
          className={styles.filterSelect}
          placeholder="Correlation ID…"
          value={correlationSearch}
          onChange={e => setCorrelationSearch(e.target.value.trim())}
        />
      </div>

      {/* Tabs + Toolbar */}
      <div className={styles.navBar}>
        <div className={styles.tabsList}>
          <button type="button" className={`${styles.tabBtn} ${activeTab === TAB_IDS.allEvents ? styles.tabActive : ''}`} onClick={() => { setActiveTab(TAB_IDS.allEvents); setPage(1) }}>All Events</button>
          <button type="button" className={`${styles.tabBtn} ${activeTab === TAB_IDS.errors ? styles.tabActive : ''}`} onClick={() => { setActiveTab(TAB_IDS.errors); setPage(1) }}>
            Errors {summary?.errorCount ? <span className={styles.tabBadge}>{summary.errorCount}</span> : null}
          </button>
          <button type="button" className={`${styles.tabBtn} ${styles.tabCritical} ${activeTab === TAB_IDS.critical ? styles.tabActive : ''}`} onClick={() => { setActiveTab(TAB_IDS.critical); setPage(1) }}>
            Critical {summary?.criticalCount ? <span className={styles.tabBadgeCritical}>{summary.criticalCount}</span> : null}
          </button>
          <button type="button" className={`${styles.tabBtn} ${activeTab === TAB_IDS.warnings ? styles.tabActive : ''}`} onClick={() => { setActiveTab(TAB_IDS.warnings); setPage(1) }}>Warnings</button>
        </div>
        <div className={styles.toolbarActions}>
          <RowsPerPage storageKey="host.system-logs" value={pageSize} onChange={(size) => { setPageSize(size); setPage(1) }} />
          <button type="button" className={styles.refreshBtn} onClick={handleRefresh} disabled={isLoading}>
            <Icon.Activity width={15} height={15} />
            <span>Refresh</span>
          </button>
          <PermissionGate featureKey={FEATURE} capability="Export">
            <button type="button" className={styles.exportBtn} onClick={() => void handleExport()} disabled={exporting}>
              <Icon.FileText width={15} height={15} />
              <span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
            </button>
          </PermissionGate>
        </div>
      </div>

      {activeFilters.length > 0 && <FilterBar filters={activeFilters} onClearAll={handleClearFilters} />}

      {exportNotice && <div className={styles.errorBanner} role="status">{exportNotice}</div>}

      {listError ? (
        <EmptyState
          title="Failed to load system logs"
          description={listError}
          compact
        />
      ) : (
        <DataTable
          reserveHeight
          footer={
            <Pagination page={page} pageSize={pageSize} total={totalCount} itemLabel="log" onPageChange={setPage} />
          }
        >
          <ResponsiveRows
            columns={columns}
            rows={logs}
            rowKey={(l) => l.id}
            loading={isLoading}
            loadingRows={pageSize}
            empty={<EmptyState compact title="No system logs found matching your criteria." />}
          />
        </DataTable>
      )}

      {detailLog && (
        <SystemLogDetailDrawer
          log={detailLog}
          onClose={() => setDetailLog(null)}
          onViewRelated={(cid) => navigate(`/system/system-logs?correlationId=${cid}`)}
        />
      )}
    </div>
  )
}
