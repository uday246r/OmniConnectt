import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  Badge,
  Button,
  ColumnFilter,
  CsvExportError,
  DataTable,
  DateRangeColumnFilter,
  EMPTY_DATE_RANGE,
  EMPTY_VALUE,
  EmptyState,
  FilterBar,
  Pagination,
  ResponsiveRows,
  RowAction,
  describeDateRange,
  describeTruncation,
  formatAuditTimestamp,
  isDateRangeActive,
  resolveDateRange,
  type ActiveFilter,
  type ColumnFilterOption,
  type DateRangeValue,
  type ResponsiveColumn,
} from '@omniremit/ui'
import { useAuthStore } from '../../../auth/store/authStore'
import { ApiError } from '../../../../shared/api/httpClient'
import { Icon } from '../../../../shared/components/Icon/Icon'
import { toast } from '../../../../shared/stores/toastStore'
import { TOPICS, useDataRevision } from '../../../../shared/stores/invalidationStore'
import { useDebouncedValue } from '../../../../shared/hooks/useDebouncedValue'
import {
  auditLogsApi,
  type AuditLogDto,
  type AuditResult,
  type ListAuditLogsParams,
} from '../../../system-audit-logs/api/auditLogsApi'
import { actionBadgeTone, formatActionLabel } from '../../../system-audit-logs/utils/auditLogFormatting'
import { AuditLogDetailDrawer } from '../../../system-audit-logs/components/AuditLogDetailDrawer/AuditLogDetailDrawer'
import styles from './UserActivityTab.module.css'

export const USER_ACTIVITY_PAGE_SIZE = 10

type Involvement = '' | 'by' | 'about'

const INVOLVEMENT_OPTIONS: ColumnFilterOption[] = [
  { value: 'by', label: 'By this user' },
  { value: 'about', label: 'About this user' },
]

const RESULT_OPTIONS: ColumnFilterOption[] = [
  { value: 'Success', label: 'Success' },
  { value: 'Failure', label: 'Failure' },
]

interface UserActivityTabProps {
  userId: string
  userName: string
}

/**
 * A user's audit history: what they did, and what was done to them.
 *
 * It used to fetch a fixed pool of this user's most recent rows (asking for 200, which the server
 * capped at 100) and filter and page that pool in the browser. Anything older than the pool could not
 * be reached however the filters were set, and the filters' option lists described the pool rather
 * than the history. It also showed only rows where the user was the actor, so "who changed this
 * person's role?" had no answer here.
 *
 * Everything is now a server query: paging, every filter, the dropdown options (from the facets
 * endpoint, under the same filters) and the export — one parameter set for all of them.
 */
export function UserActivityTab({ userId, userName }: UserActivityTabProps) {
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAdministrator = Boolean(useAuthStore((s) => s.user?.isAdministrator))
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const canView = isAdministrator || hasCapability('host.system.audit-logs', 'View')
  const canExport = isAdministrator || hasCapability('host.system.audit-logs', 'Export')
  const auditRevision = useDataRevision(TOPICS.auditLogs)

  const [page, setPage] = useState(1)
  const [involvement, setInvolvement] = useState<Involvement>('')
  const [action, setAction] = useState('')
  const [result, setResult] = useState('')
  const [application, setApplication] = useState('')
  const [recordSearch, setRecordSearch] = useState('')
  const [timeRange, setTimeRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE)
  const [viewing, setViewing] = useState<AuditLogDto | null>(null)
  const [exporting, setExporting] = useState(false)
  const record = useDebouncedValue(recordSearch, 300)

  // Resolved when used, never stored — a stored "Last 7 days" would freeze into one particular week.
  const bounds = useMemo(() => resolveDateRange(timeRange), [timeRange])

  const filters: ListAuditLogsParams = useMemo(
    () => ({
      ...(involvement === 'by' ? { actorUserId: userId } : { involvingUserId: userId }),
      ...(involvement === 'about' ? { excludeActorUserId: userId } : {}),
      action: action || undefined,
      result: (result as AuditResult) || undefined,
      service: application || undefined,
      entityId: record.trim() || undefined,
      ...bounds,
    }),
    [userId, involvement, action, result, application, record, bounds],
  )

  useEffect(() => {
    setPage(1)
  }, [filters])

  const listQuery = useQuery({
    queryKey: ['auditLogs', 'user', userId, filters, page, auditRevision],
    enabled: canView && Boolean(accessToken),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      auditLogsApi.list(accessToken!, { ...filters, page, pageSize: USER_ACTIVITY_PAGE_SIZE, sortDir: 'desc' }, signal),
  })

  const facetsQuery = useQuery({
    queryKey: ['auditLogs', 'user-facets', userId, filters, auditRevision],
    enabled: canView && Boolean(accessToken),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => auditLogsApi.facets(accessToken!, filters, signal),
  })

  const actionOptions = useMemo<ColumnFilterOption[]>(
    () =>
      (facetsQuery.data?.actions ?? [])
        .map((a) => ({ value: a.action, label: formatActionLabel(a.action) }))
        .sort((a, b) => String(a.label).localeCompare(String(b.label))),
    [facetsQuery.data],
  )

  const applicationOptions = useMemo<ColumnFilterOption[]>(
    () => (facetsQuery.data?.services ?? []).map((s) => ({ value: s, label: s })),
    [facetsQuery.data],
  )

  const rows = listQuery.data?.items ?? []
  const total = listQuery.data?.total ?? 0
  const forbidden = !canView || (listQuery.error instanceof ApiError && listQuery.error.status === 403)

  const activeFilters = [
    involvement && {
      key: 'involvement',
      label: 'Involvement',
      value: involvement === 'by' ? 'By this user' : 'About this user',
      onRemove: () => setInvolvement(''),
    },
    action && { key: 'action', label: 'Action', value: formatActionLabel(action), onRemove: () => setAction('') },
    application && { key: 'app', label: 'Application', value: application, onRemove: () => setApplication('') },
    result && { key: 'result', label: 'Result', value: result, onRemove: () => setResult('') },
    record && { key: 'record', label: 'Record', value: `"${record}"`, onRemove: () => setRecordSearch('') },
    isDateRangeActive(timeRange) && {
      key: 'time',
      label: 'Time',
      value: describeDateRange(timeRange),
      onRemove: () => setTimeRange(EMPTY_DATE_RANGE),
    },
  ].filter(Boolean) as ActiveFilter[]

  function clearAll() {
    setInvolvement('')
    setAction('')
    setApplication('')
    setResult('')
    setRecordSearch('')
    setTimeRange(EMPTY_DATE_RANGE)
  }

  async function handleExport() {
    if (!accessToken) return
    setExporting(true)
    try {
      const download = await auditLogsApi.exportCsv(accessToken, { ...filters, sortDir: 'desc' })
      const truncation = describeTruncation(download)
      if (truncation) toast.warning(truncation)
      else toast.success(`Audit history for ${userName} downloaded.`)
    } catch (err) {
      toast.error(err instanceof CsvExportError ? err.message : 'Could not download the audit history. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  const columns: ResponsiveColumn<AuditLogDto>[] = [
    {
      key: 'time',
      label: 'Time',
      priority: 'always',
      header: <DateRangeColumnFilter label="Time" value={timeRange} onChange={setTimeRange} />,
      render: (l) => formatAuditTimestamp(l.occurredAt),
    },
    {
      key: 'actor',
      label: 'Done by',
      priority: 'always',
      header: (
        <ColumnFilter
          label="Done by"
          value={involvement}
          onChange={(v) => setInvolvement(v as Involvement)}
          options={INVOLVEMENT_OPTIONS}
          allLabel="Everything"
          searchable
        />
      ),
      render: (l) =>
        l.actorUserId === userId ? (
          <span>
            {userName}
            <span className={styles.qualifier}> · this user</span>
          </span>
        ) : (
          <span>
            {l.actorName || 'System'}
            <span className={styles.qualifier}> · about this user</span>
          </span>
        ),
    },
    {
      key: 'action',
      label: 'Action',
      priority: 'always',
      header: (
        <ColumnFilter label="Action" value={action} onChange={setAction} options={actionOptions} allLabel="All actions" searchable />
      ),
      render: (l) => <Badge tone={actionBadgeTone(l.action)}>{formatActionLabel(l.action)}</Badge>,
    },
    {
      key: 'details',
      label: 'What happened',
      priority: 'high',
      render: (l) => <span className={styles.details}>{l.details || EMPTY_VALUE}</span>,
    },
    {
      key: 'app',
      label: 'Application',
      priority: 'high',
      header: (
        <ColumnFilter
          label="Application"
          value={application}
          onChange={setApplication}
          options={applicationOptions}
          allLabel="All applications"
          searchable
        />
      ),
      render: (l) => <Badge tone="neutral">{l.sourceApplication || l.serviceName}</Badge>,
    },
    {
      key: 'record',
      label: 'Record',
      priority: 'low',
      header: (
        <ColumnFilter
          label="Record"
          value={recordSearch}
          onChange={setRecordSearch}
          options={[]}
          freeText
          filterType="text"
          searchPlaceholder="Search by record name..."
          suggestFrom={rows.map((l) => ({ value: l.entityLabel ?? l.entityType ?? '', meta: l.entityLabel ? l.entityType ?? undefined : undefined }))}
          emptyHint="No matching record on this page."
        />
      ),
      render: (l) => l.entityLabel ?? l.entityType ?? EMPTY_VALUE,
    },
    {
      key: 'result',
      label: 'Result',
      priority: 'always',
      header: <ColumnFilter label="Result" value={result} onChange={setResult} options={RESULT_OPTIONS} allLabel="All results" searchable />,
      render: (l) => <Badge tone={l.result === 'Success' ? 'success' : 'danger'}>{l.result}</Badge>,
    },
    {
      key: 'view',
      label: '',
      priority: 'always',
      align: 'right',
      render: (l) => <RowAction onClick={() => setViewing(l)}>View</RowAction>,
    },
  ]

  if (forbidden) {
    return (
      <EmptyState
        compact
        title="You can't see audit history"
        description="Viewing a user's audit history needs access to Audit Logs. Ask an administrator if you need it."
      />
    )
  }

  return (
    <>
      <div className={styles.toolbar}>
        {canExport && (
          <Button variant="secondary" leadingIcon={<Icon.Download width={15} height={15} />} loading={exporting} onClick={handleExport}>
            Export Report
          </Button>
        )}
      </div>
      <FilterBar filters={activeFilters} onClearAll={clearAll} />
      <DataTable
        reserveHeight
        footer={<Pagination page={page} pageSize={USER_ACTIVITY_PAGE_SIZE} total={total} onPageChange={setPage} itemLabel="event" />}
      >
        <ResponsiveRows
          columns={columns}
          rows={rows}
          rowKey={(l) => l.id}
          loading={listQuery.isPending}
          loadingRows={USER_ACTIVITY_PAGE_SIZE}
          empty={
            listQuery.isError ? (
              <EmptyState compact title="Could not load the audit history." description="Please try again in a moment." />
            ) : (
              <EmptyState compact title="No activity found matching the selected filters." />
            )
          }
        />
      </DataTable>

      {viewing && (
        <AuditLogDetailDrawer
          log={viewing}
          accessToken={accessToken}
          onClose={() => setViewing(null)}
          onViewRelated={(cid) => navigate(`/system/audit-logs?correlationId=${encodeURIComponent(cid)}`)}
        />
      )}
    </>
  )
}
