import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../../auth/store/authStore'
import { TOPICS, useDataRevision } from '../../../shared/stores/invalidationStore'
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
  type BadgeTone,
  type ResponsiveColumn,
  DateRangeFilterButton,
  EMPTY_DATE_RANGE,
  CsvExportError,
  describeDateRange,
  describeTruncation,
  isDateRangeActive,
  resolveDateRange,
  type DateRangeValue,
} from '@omniremit/ui'
import { PermissionGate } from '../../../shared/components/PermissionGate/PermissionGate'
import { ApiError } from '../../../shared/api/httpClient'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue'
import { systemLogsApi, type SystemLogDto, type SystemLogSummaryDto } from '../api/systemLogsApi'
import { Icon } from '../../../shared/components/Icon/Icon'
import { SystemLogDetailDrawer } from '../components/SystemLogDetailDrawer/SystemLogDetailDrawer'
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

function getTone(severity: string): BadgeTone {
  const s = severity.toLowerCase()
  if (s === 'critical') return 'danger'
  if (s === 'error') return 'danger'
  if (s === 'warning') return 'warning'
  if (s === 'info') return 'info'
  return 'neutral'
}

function getEnvTone(env: string | null | undefined): BadgeTone {
  if (!env) return 'neutral'
  const e = env.toLowerCase()
  if (e.includes('prod')) return 'danger'
  if (e.includes('stag')) return 'warning'
  if (e.includes('dev')) return 'info'
  return 'neutral'
}

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

  const [summary, setSummary] = useState<SystemLogSummaryDto | null>(null)
  const [logs, setLogs] = useState<SystemLogDto[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detailLog, setDetailLog] = useState<SystemLogDto | null>(null)

  // Pool of unique values for filter dropdowns
  const [cachedPool, setCachedPool] = useState<SystemLogDto[]>([])
  const availableServices = useMemo(() => [...new Set(cachedPool.map(r => r.serviceName))].sort(), [cachedPool])
  const availableEnvironments = useMemo(() => [...new Set(cachedPool.map(r => r.environment).filter(Boolean) as string[])].sort(), [cachedPool])
  const availableModules = useMemo(() => [...new Set(cachedPool.map(r => r.module).filter(Boolean) as string[])].sort(), [cachedPool])
  const availableEventCodes = useMemo(() => [...new Set(cachedPool.map(r => r.eventCode))].sort(), [cachedPool])

  /* Opening the drawer writes no audit row — see AuditLogsPage.handleOpenDetail for why. */
  const handleViewDetail = useCallback((log: SystemLogDto) => {
    setDetailLog(log)
  }, [])

  const revision = useDataRevision(TOPICS.systemLogs)

  // Tab-based severity mapping
  const finalSeverity = useMemo(() => {
    if (activeTab === TAB_IDS.errors) return 'Error'
    if (activeTab === TAB_IDS.warnings) return 'Warning'
    if (activeTab === TAB_IDS.critical) return 'Critical'
    return severityFilter
  }, [activeTab, severityFilter])

  const range = useMemo(() => resolveDateRange(dateRange), [dateRange])

  const fetchSummary = useCallback(async () => {
    if (!accessToken) return
    try {
      const data = await systemLogsApi.summary(accessToken, range)
      setSummary(data)
    } catch { /* background failure */ }
  }, [accessToken, range])

  const fetchLogs = useCallback(async (signal?: AbortSignal) => {
    if (!accessToken) return
    setIsLoading(true)
    setError(null)
    try {
      const res = await systemLogsApi.list(accessToken, {
        page,
        pageSize,
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
      }, signal)
      setLogs(res.items)
      setTotalCount(res.total)
      setCachedPool(prev => {
        const map = new Map(prev.map(r => [r.id, r]))
        res.items.forEach(r => map.set(r.id, r))
        const list = Array.from(map.values())
        return list.length > 2000 ? list.slice(-2000) : list
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof ApiError ? err.message : 'Failed to load system logs')
    } finally {
      setIsLoading(false)
    }
  }, [
    accessToken, page, pageSize, finalSeverity, serviceFilter, eventCodeFilter,
    messageSearch, environmentFilter, moduleFilter, range, sortDir, correlationSearch, correlationId,
  ])

  useEffect(() => {
    const ac = new AbortController()
    void fetchSummary()
    void fetchLogs(ac.signal)
    return () => ac.abort()
  }, [fetchSummary, fetchLogs, revision])

  // Reset page on filter change
  useEffect(() => { setPage(1) }, [activeTab, finalSeverity, serviceFilter, eventCodeFilter, messageSearch, environmentFilter, moduleFilter, range])

  const handleExport = async () => {
    if (!accessToken) return
    setExporting(true)
    try {
      const result = await systemLogsApi.exportCsv(accessToken, {
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
      })

      // A capped export is reported, not hidden. The file used to arrive containing the newest
      // 10,000 rows of a larger match, with a 200 and a filename and nothing to suggest that
      // anything was missing from it.
      const truncation = describeTruncation(result)
      if (truncation) setError(truncation)
    } catch (err) {
      setError(err instanceof CsvExportError ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const handleRefresh = () => {
    void fetchSummary()
    void fetchLogs()
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
    if (eventCodeFilter) active.push({ key: 'eventCode', label: 'Event Code', value: eventCodeFilter, onRemove: () => setEventCodeFilter('') })
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
      render: (l) => <Badge tone={getTone(l.severity)}>{l.severity}</Badge>
    },
    { key: 'service', label: 'SERVICE', priority: 'high', render: (l) => <Badge tone="neutral">{l.serviceName}</Badge> },
    {
      key: 'environment', label: 'ENV', priority: 'low',
      render: (l) => l.environment ? <Badge tone={getEnvTone(l.environment)}>{l.environment}</Badge> : <span className={styles.mutedText}>—</span>
    },
    { key: 'eventCode', label: 'EVENT CODE', priority: 'high', render: (l) => <code className={styles.eventCode}>{l.eventCode}</code> },
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
        <select className={styles.filterSelect} value={serviceFilter} onChange={e => setServiceFilter(e.target.value)}>
          <option value="">All Services</option>
          {availableServices.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Environment filter */}
        <select className={styles.filterSelect} value={environmentFilter} onChange={e => setEnvironmentFilter(e.target.value)}>
          <option value="">All Environments</option>
          {availableEnvironments.length > 0
            ? availableEnvironments.map(e => <option key={e} value={e}>{e}</option>)
            : ['Production', 'Staging', 'Development'].map(e => <option key={e} value={e}>{e}</option>)
          }
        </select>

        {/* Module filter */}
        {availableModules.length > 0 && (
          <select className={styles.filterSelect} value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}>
            <option value="">All Modules</option>
            {availableModules.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        )}

        {/* Event Code filter */}
        <select className={styles.filterSelect} value={eventCodeFilter} onChange={e => setEventCodeFilter(e.target.value)}>
          <option value="">All Event Codes</option>
          {availableEventCodes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

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

      {error ? (
        <EmptyState
          title="Failed to load system logs"
          description={error}
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
