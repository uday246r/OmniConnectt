import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuthStore } from '../../auth/store/authStore'
import { Badge, Button, ColumnFilter, DataTable, EMPTY_VALUE, FilterBar, Icon, PageHeader, Pagination, ResponsiveRows, RowsPerPage, readStoredPageSize, type ActiveFilter, type BadgeTone } from '@omniremit/ui'
import { approvalsApi, type ApprovalFacetsDto, type ApprovalRequestListItemDto, type ApprovalStatus, type MyRequestsParams, type RevealTempPasswordResponse } from '../api/approvalsApi'
import { useApprovalRequests } from '../hooks/useApprovalRequests'
import { ApiError } from '../../../shared/api/httpClient'
import styles from './MyRequestsPage.module.css'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLiveRefetchInterval } from '../../../shared/query/invalidationBridge'
import { queryKeys } from '../../../shared/query/queryKeys'

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

const ACTION_ICONS: Record<string, typeof Icon.User> = {
  Create: Icon.Plus,
  Update: Icon.Edit,
  Delete: Icon.Trash,
  Enable: Icon.CheckCircle,
  Disable: Icon.X,
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

function humanizeKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
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

const FILTERS: { key: ApprovalStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'Pending', label: 'Pending' },
  { key: 'Approved', label: 'Approved' },
  { key: 'Rejected', label: 'Rejected' },
]

type SummaryTone = 'iconAmber' | 'iconGreen' | 'iconRed' | 'iconBlue'

const SUMMARY_CARDS: {
  key: string
  label: string
  tone: SummaryTone
  icon: ReactNode
  count: (items: ApprovalRequestListItemDto[], total: number) => number
}[] = [
  {
    key: 'pending',
    label: 'Pending',
    tone: 'iconAmber',
    icon: <Icon.Clock width={20} height={20} />,
    count: (items) => items.filter((r) => r.status === 'Pending').length,
  },
  {
    key: 'approved',
    label: 'Approved',
    tone: 'iconGreen',
    icon: <Icon.CheckCircle width={20} height={20} />,
    count: (items) => items.filter((r) => r.status === 'Approved').length,
  },
  {
    key: 'rejected',
    label: 'Rejected',
    tone: 'iconRed',
    icon: <Icon.AlertCircle width={20} height={20} />,
    count: (items) => items.filter((r) => r.status === 'Rejected').length,
  },
  {
    key: 'total',
    label: 'Total Submitted',
    tone: 'iconBlue',
    icon: <Icon.FileText width={20} height={20} />,
    count: (_items, total) => total,
  },
]

/**
 * The maker dashboard — every authenticated user's own submitted requests, regardless of whether they
 * hold Approval Center access (see approvalsApi.listMine's own doc comment: it's scoped to the caller's
 * own id server-side, so this never needs a special permission to view).
 */
export function MyRequestsPage() {
  const accessToken = useAuthStore((s) => s.accessToken)

  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | 'all'>('all')
  /*
   * Per-column filters, matching Approval Center — all applied by the server. They used to narrow only
   * the page already fetched, so a request on another page could not be found by filtering for it,
   * and each dropdown listed only what that page happened to contain.
   */
  const [moduleFilter, setModuleFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [checkerFilter, setCheckerFilter] = useState('')
  const [page, setPage] = useState(1)
  // Opens at whatever size this user last chose here — see RowsPerPage's storageKey.
  const [pageSize, setPageSize] = useState(() => readStoredPageSize('host.myRequests', DEFAULT_PAGE_SIZE))
  const queryClient = useQueryClient()
  const refetchInterval = useLiveRefetchInterval()

  const filterParams = useMemo<MyRequestsParams>(
    () => ({
      status: statusFilter === 'all' ? undefined : statusFilter,
      module: moduleFilter || undefined,
      action: (actionFilter || undefined) as MyRequestsParams['action'],
      checkerName: checkerFilter || undefined,
    }),
    [statusFilter, moduleFilter, actionFilter, checkerFilter],
  )
  const listParams = useMemo(() => ({ ...filterParams, page, pageSize }), [filterParams, page, pageSize])
  const fetcher = useCallback(
    (token: string, signal?: AbortSignal) => approvalsApi.listMine(token, listParams, signal),
    [listParams],
  )
  const { items, total, error } = useApprovalRequests(accessToken, queryKeys.approvals.mine(listParams), fetcher)

  // Options are a convenience; losing them must not look like losing the requests.
  const facetsQuery = useQuery({
    queryKey: queryKeys.approvals.mineFacets(filterParams),
    enabled: Boolean(accessToken),
    placeholderData: keepPreviousData,
    refetchInterval,
    queryFn: ({ signal }) => approvalsApi.mineFacets(accessToken!, filterParams, signal),
  })
  const facets: ApprovalFacetsDto | null = facetsQuery.data ?? null

  useEffect(() => {
    setPage(1)
  }, [filterParams])

  // Instant feedback: the fetched row still says hasTempPassword until the refetch lands, so the
  // button is hidden from this set immediately on success rather than flickering back.
  const [collectedIds, setCollectedIds] = useState<Set<string>>(new Set())
  const [revealing, setRevealing] = useState<string | null>(null) // request id in flight
  const [revealed, setRevealed] = useState<RevealTempPasswordResponse | null>(null) // modal payload
  const [revealError, setRevealError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleReveal(id: string) {
    if (!accessToken) return
    setRevealing(id)
    setRevealError(null)
    try {
      const result = await approvalsApi.revealTempPassword(accessToken, id)
      setCollectedIds((prev) => new Set(prev).add(id))
      setRevealed(result)
    } catch (err) {
      /*
       * Only a 410 means the password is genuinely gone (already collected — it is one-time).
       *
       * This used to mark the row collected for ANY failure, so a dropped connection or a
       * momentary 500 permanently hid the only button that can retrieve the credential: the flag
       * lives in component state, and nothing clears it short of a remount. The password was still
       * sitting on the server, unreachable. Every other error now leaves the button in place so the
       * operator can simply try again.
       */
      if (err instanceof ApiError && err.status === 410) {
        setCollectedIds((prev) => new Set(prev).add(id))
      }
      setRevealError(err instanceof ApiError ? err.message : 'Could not retrieve the temporary password.')
    } finally {
      setRevealing(null)
    }
  }

  function closeRevealModal() {
    setRevealed(null)
    setCopied(false)
    void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() }) // re-sync with server truth after the optimistic hide
  }

  const moduleOptions = (facets?.modules ?? []).map((m) => ({ value: m, label: formatModuleName(m) }))
  const actionOptions = (facets?.actions ?? []).map((a) => ({ value: a, label: ACTION_LABELS[a] ?? a }))
  const checkerOptions = (facets?.checkers ?? []).map((c) => ({ value: c, label: c }))
  const visibleItems = items


  return (
    <div className={styles.page}>
      {/* Same banner as Approval Center and Audit Logs. This page's header was a third hand-rolled
          copy, and the one that had drifted furthest — a plain white bar where its siblings carried
          the blue gradient. */}
      <PageHeader
        title="My Requests"
        pill={
          <>
            <span className={styles.liveDot} />
            Live Status
          </>
        }
        subtitle="Every action you've submitted for approval — status, assigned checker, and rejection reasons if any."
        actions={
          <Button
            type="button"
            variant="onHeader"
            onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() })}
            leadingIcon={<Icon.Activity width={15} height={15} />}
          >
            Refresh
          </Button>
        }
      />

      {/*
        * Summary metrics. Both sibling pages — Approval Center and Audit Logs — open with a row of
        * these and this one went straight from the banner to a filter strip, which is why it read
        * as a thinner page than its siblings. Counts come from the loaded page, so they describe
        * exactly what the table below is showing.
        */}
      <div className={styles.summaryGrid}>
        {SUMMARY_CARDS.map((card) => (
          <div key={card.key} className={styles.summaryCard}>
            <div className={`${styles.summaryIcon} ${styles[card.tone]}`}>{card.icon}</div>
            <div className={styles.summaryContent}>
              <span className={styles.summaryLabel}>{card.label}</span>
              <span className={styles.summaryValue}>
                {items === null ? '—' : card.count(items, total)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Status tab bar — All / Pending / Approved / Rejected — same navBar pattern as
          Approval Center and Audit Logs so the three sibling pages feel identical. */}
      <div className={styles.navBar}>
        <div className={styles.tabsList} role="tablist" aria-label="Request status">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={statusFilter === f.key}
              className={`${styles.tabBtn} ${statusFilter === f.key ? styles.tabActive : ''}`}
              onClick={() => { setStatusFilter(f.key); setPage(1) }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
          <RowsPerPage
            storageKey="host.myRequests"
            value={pageSize}
            onChange={(n) => {
              setPageSize(n)
              setPage(1)
            }}
          />
        </div>
      </div>

      <FilterBar
        filters={[
          moduleFilter && { key: 'module', label: 'Module', value: formatModuleName(moduleFilter), onRemove: () => setModuleFilter('') },
          actionFilter && { key: 'action', label: 'Action', value: ACTION_LABELS[actionFilter] ?? actionFilter, onRemove: () => setActionFilter('') },
          checkerFilter && { key: 'checker', label: 'Checker', value: checkerFilter, onRemove: () => setCheckerFilter('') },
        ].filter(Boolean) as ActiveFilter[]}
        onClearAll={() => {
          setModuleFilter('')
          setActionFilter('')
          setCheckerFilter('')
        }}
      />


      {error && <div className={styles.errorBanner}>{error}</div>}
      {revealError && <div className={styles.errorBanner}>{revealError}</div>}

      {/* Shared chrome. This page had a THIRD variant of the same table — 11px header padding and a
          1px #eaecf0 rule against the 12px / 1.5px #e2e8f0 used by Audit Logs and Approval Center —
          so it now renders from the same source as its sibling pages. */}
      <DataTable footer={<Pagination page={page} pageSize={pageSize} total={total} itemLabel="request" onPageChange={setPage} />}>
        <ResponsiveRows
          rows={visibleItems ?? []}
          rowKey={(r) => String(r.id)}
          loading={visibleItems === null}
          loadingRows={pageSize}
          empty={
            statusFilter === 'all'
              ? "You haven't submitted any requests yet."
              : `No ${statusFilter.toLowerCase()} requests.`
          }
          columns={[
            {
              key: 'requestedAt',
              label: 'DATE SUBMITTED',
              priority: 'always',
              render: (r) => <span className={styles.timeCell}>{formatDateOnly(r.requestedAt)}</span>,
            },
            {
              key: 'module',
              label: 'Module',
              priority: 'high',
              header: (
                <ColumnFilter
                  key="module"
                  label="Module"
                  value={moduleFilter}
                  onChange={setModuleFilter}
                  options={moduleOptions}
                  allLabel="All Modules"
                  searchable
                />
              ),
              render: (r) => <Badge tone="info">{formatModuleName(r.module)}</Badge>,
            },
            {
              key: 'action',
              label: 'Action',
              priority: 'always',
              header: (
                <ColumnFilter
                  key="action"
                  label="Action"
                  value={actionFilter}
                  onChange={setActionFilter}
                  options={actionOptions}
                  allLabel="All Actions"
                  searchable
                />
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
              key: 'record',
              label: 'RECORD',
              priority: 'high',
              render: (r) =>
                r.entityLabel ? (
                  <span className={styles.entityLabel}>{r.entityLabel}</span>
                ) : (
                  <span className={styles.mutedText}>{EMPTY_VALUE}</span>
                ),
            },
            {
              key: 'checker',
              label: 'Checker',
              priority: 'low',
              header: (
                <ColumnFilter
                  key="checker"
                  label="Checker"
                  value={checkerFilter}
                  onChange={setCheckerFilter}
                  options={checkerOptions}
                  allLabel="Everyone"
                  searchable
                  filterType="alpha"
                />
              ),
              render: (r) =>
                r.checkerName ? (
                  <div className={styles.actorCell}>
                    <span className={styles.checkerAvatar}>
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
              label: 'Status',
              priority: 'always',
              render: (r) => <Badge tone={STATUS_TONES[r.status]} dot>{r.status}</Badge>,
            },
            {
              key: 'password',
              label: 'PASSWORD',
              priority: 'low',
              render: (r) =>
                r.hasTempPassword && !collectedIds.has(r.id) ? (
                  <button
                    type="button"
                    className={styles.revealBtn}
                    disabled={revealing === r.id}
                    onClick={() => handleReveal(r.id)}
                  >
                    <Icon.Key width={13} height={13} />
                    <span>{revealing === r.id ? 'Retrieving…' : 'Get password'}</span>
                  </button>
                ) : (
                  <span className={styles.mutedText}>{EMPTY_VALUE}</span>
                ),
            },
            {
              key: 'rejectionReason',
              clamp: true,
              label: 'REJECTION REASON',
              priority: 'low',
              render: (r) => (
                <span className={styles.reasonCell}>
                  {r.rejectionReason ?? <span className={styles.mutedText}>{EMPTY_VALUE}</span>}
                </span>
              ),
            },
          ]}
        />
      </DataTable>

      {revealed && (
        <div className={styles.modalBackdrop} onClick={closeRevealModal}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalIconWrap}>
              <Icon.ShieldCheck width={34} height={34} />
            </div>
            <h3 className={styles.modalTitle}>Temporary Password</h3>
            <p className={styles.modalText}>
              Share this securely with <strong>{revealed.userName}</strong> ({revealed.userEmail}). They will be
              required to choose their own password the first time they sign in.
            </p>
            <div className={styles.tempPassBox}>
              <code className={styles.tempPassValue}>{revealed.temporaryPassword}</code>
              <button
                type="button"
                className={styles.copyBtn}
                onClick={() => { void navigator.clipboard.writeText(revealed.temporaryPassword).then(() => setCopied(true)) }}
              >
                <Icon.Copy width={13} height={13} />
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p className={styles.modalWarning} role="alert">
              <Icon.AlertCircle width={15} height={15} />
              <span>This is the only time it will be shown. Once you close this, it cannot be retrieved again — the account would have to be re-created.</span>
            </p>
            <button type="button" className={styles.modalDoneBtn} onClick={closeRevealModal}>
              I&apos;ve saved it — close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
