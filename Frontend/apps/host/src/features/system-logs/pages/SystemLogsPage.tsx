import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
} from '@omniremit/ui'
import { PermissionGate } from '../../../shared/components/PermissionGate/PermissionGate'
import { ApiError } from '../../../shared/api/httpClient'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue'
import { systemLogsApi, type SystemLogDto, type SystemLogSummaryDto } from '../api/systemLogsApi'
import { auditLogsApi } from '../../system-audit-logs/api/auditLogsApi'
import { Icon } from '../../../shared/components/Icon/Icon'
import { SystemLogDetailDrawer } from '../components/SystemLogDetailDrawer/SystemLogDetailDrawer'
import styles from './SystemLogsPage.module.css'

const FEATURE = 'host.system.system-logs'
const DEFAULT_PAGE_SIZE = 10

type DateFilterMode = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'

const DATE_RANGES: { key: DateFilterMode; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'Last 7 Days' },
  { key: 'month', label: 'Last 30 Days' },
  { key: 'custom', label: 'Custom' },
]

function computeRange(
  preset: DateFilterMode,
  customFrom?: string,
  customTo?: string,
  customFromTime?: string,
  customToTime?: string,
): { from?: string; to?: string } {
  if (preset === 'custom') {
    return {
      from: customFrom ? new Date(`${customFrom}T${customFromTime || '00:00'}:00`).toISOString() : undefined,
      to: customTo ? new Date(`${customTo}T${customToTime || '23:59'}:59`).toISOString() : undefined,
    }
  }
  const now = new Date()
  switch (preset) {
    case 'today': {
      const start = new Date(now); start.setHours(0, 0, 0, 0)
      return { from: start.toISOString() }
    }
    case 'yesterday': {
      const start = new Date(now); start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0)
      const end = new Date(start); end.setHours(23, 59, 59, 999)
      return { from: start.toISOString(), to: end.toISOString() }
    }
    case 'week': {
      const start = new Date(now); start.setDate(start.getDate() - 7)
      return { from: start.toISOString() }
    }
    case 'month': {
      const start = new Date(now); start.setDate(start.getDate() - 30)
      return { from: start.toISOString() }
    }
    default: return {}
  }
}

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

  // Date range
  const [dateMode, setDateMode] = useState<DateFilterMode>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [customFromTime, setCustomFromTime] = useState('')
  const [customToTime, setCustomToTime] = useState('')
  const [customDraftFrom, setCustomDraftFrom] = useState('')
  const [customDraftTo, setCustomDraftTo] = useState('')
  const [showCustomDate, setShowCustomDate] = useState(false)
  const customDateRef = useRef<HTMLDivElement>(null)

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

  const handleViewDetail = useCallback((log: SystemLogDto) => {
    setDetailLog(log)
    if (accessToken) {
      auditLogsApi.recordActivity(accessToken, {
        page: 'system-logs',
        module: 'System',
        sourceApplication: 'Host',
        action: 'system_log.details_viewed',
        actionCategory: 'ViewDetails',
        entityType: 'SystemLog',
        entityId: log.id,
        entityLabel: `${log.serviceName} — ${log.eventCode}`,
        details: `Viewed system log ${log.id} (${log.eventCode} - ${log.severity} on ${log.serviceName})`,
      }).catch(() => {})
    }
  }, [accessToken])

  const revision = useDataRevision(TOPICS.systemLogs)

  // Tab-based severity mapping
  const finalSeverity = useMemo(() => {
    if (activeTab === TAB_IDS.errors) return 'Error'
    if (activeTab === TAB_IDS.warnings) return 'Warning'
    if (activeTab === TAB_IDS.critical) return 'Critical'
    return severityFilter
  }, [activeTab, severityFilter])

  const range = useMemo(
    () => computeRange(dateMode, customFrom, customTo, customFromTime, customToTime),
    [dateMode, customFrom, customTo, customFromTime, customToTime]
  )

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
  useEffect(() => { setPage(1) }, [activeTab, finalSeverity, serviceFilter, eventCodeFilter, messageSearch, environmentFilter, moduleFilter, dateMode, customFrom, customTo])

  const handleExport = async () => {
    if (!accessToken) return
    setExporting(true)
    try {
      await systemLogsApi.exportCsv(accessToken, {
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Export failed')
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
    setDateMode('all'); setCustomFrom(''); setCustomTo('')
    setCustomFromTime(''); setCustomToTime('')
    setCorrelationSearch(''); setPage(1)
  }

  const activeFilters = useMemo(() => {
    const active: ActiveFilter[] = []
    if (dateMode !== 'all') active.push({ key: 'time', label: 'Time', value: DATE_RANGES.find(r => r.key === dateMode)?.label ?? dateMode, onRemove: () => { setDateMode('all'); setCustomFrom(''); setCustomTo('') } })
    if (serviceFilter) active.push({ key: 'service', label: 'Service', value: serviceFilter, onRemove: () => setServiceFilter('') })
    if (environmentFilter) active.push({ key: 'env', label: 'Environment', value: environmentFilter, onRemove: () => setEnvironmentFilter('') })
    if (moduleFilter) active.push({ key: 'module', label: 'Module', value: moduleFilter, onRemove: () => setModuleFilter('') })
    if (eventCodeFilter) active.push({ key: 'eventCode', label: 'Event Code', value: eventCodeFilter, onRemove: () => setEventCodeFilter('') })
    if (severityFilter && activeTab === TAB_IDS.allEvents) active.push({ key: 'severity', label: 'Severity', value: severityFilter, onRemove: () => setSeverityFilter('') })
    if (messageSearchRaw) active.push({ key: 'message', label: 'Message', value: `"${messageSearchRaw}"`, onRemove: () => setMessageSearchRaw('') })
    if (correlationSearch) active.push({ key: 'cid', label: 'Correlation ID', value: correlationSearch.slice(0, 8) + '…', onRemove: () => setCorrelationSearch('') })
    return active
  }, [serviceFilter, environmentFilter, moduleFilter, eventCodeFilter, severityFilter, messageSearchRaw, correlationSearch, activeTab, dateMode])

  // Close custom date popover on outside click
  useEffect(() => {
    if (!showCustomDate) return
    const handler = (e: MouseEvent) => {
      if (customDateRef.current && !customDateRef.current.contains(e.target as Node)) setShowCustomDate(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showCustomDate])

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
          <div className={styles.dateRangeGroup} role="group" aria-label="Date range">
            {DATE_RANGES.filter(r => r.key !== 'custom').map((r) => (
              <button
                key={r.key}
                type="button"
                className={r.key === dateMode ? styles.dateRangeActive : styles.dateRangeButton}
                onClick={() => { setDateMode(r.key); setCustomFrom(''); setCustomTo('') }}
              >
                {r.label}
              </button>
            ))}
            <div ref={customDateRef} style={{ position: 'relative' }}>
              <button
                type="button"
                className={dateMode === 'custom' ? styles.dateRangeActive : styles.dateRangeButton}
                onClick={() => setShowCustomDate(v => !v)}
              >
                {dateMode === 'custom' && customFrom ? `${customFrom} → ${customTo || '…'}` : 'Custom'}
              </button>
              {showCustomDate && (
                <div className={styles.customDateDropdown}>
                  <div className={styles.customDateRow}>
                    <label className={styles.customDateLabel}>From</label>
                    <input type="date" className={styles.dateInput} value={customDraftFrom} onChange={e => setCustomDraftFrom(e.target.value)} />
                  </div>
                  <div className={styles.customDateRow}>
                    <label className={styles.customDateLabel}>To</label>
                    <input type="date" className={styles.dateInput} value={customDraftTo} onChange={e => setCustomDraftTo(e.target.value)} />
                  </div>
                  <button
                    type="button"
                    className={styles.applyDateBtn}
                    disabled={!customDraftFrom}
                    onClick={() => {
                      setCustomFrom(customDraftFrom); setCustomTo(customDraftTo)
                      setDateMode('custom'); setShowCustomDate(false)
                    }}
                  >Apply</button>
                </div>
              )}
            </div>
          </div>
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
