import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '../../auth/store/authStore'
import { Badge, type BadgeTone } from '../../../shared/components/Badge/Badge'
import { SkeletonBlock } from '../../../shared/components/Skeleton'
import { approvalsApi, type ApprovalStatus, type RevealTempPasswordResponse } from '../api/approvalsApi'
import { useApprovalRequests } from '../hooks/useApprovalRequests'
import { Icon } from '../../../shared/components/Icon/Icon'
import { ApiError } from '../../../shared/api/httpClient'
import styles from './MyRequestsPage.module.css'
import { TOPICS, useDataRevision } from '../../../shared/stores/invalidationStore'

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

/**
 * The maker dashboard — every authenticated user's own submitted requests, regardless of whether they
 * hold Approval Center access (see approvalsApi.listMine's own doc comment: it's scoped to the caller's
 * own id server-side, so this never needs a special permission to view).
 */
export function MyRequestsPage() {
  const accessToken = useAuthStore((s) => s.accessToken)

  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | 'all'>('all')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(DEFAULT_PAGE_SIZE)
  const [refreshKey, setRefreshKey] = useState(0)
  const dataRevision = useDataRevision(TOPICS.approvals)

  const fetcher = useCallback(
    (token: string) =>
      approvalsApi.listMine(token, { page, pageSize, status: statusFilter === 'all' ? undefined : statusFilter }),
    [page, pageSize, statusFilter],
  )
  const { items, total, error } = useApprovalRequests(accessToken, fetcher, [page, pageSize, statusFilter, refreshKey, dataRevision])

  useEffect(() => {
    setPage(1)
  }, [statusFilter])

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
    setRefreshKey((k) => k + 1) // re-sync with server truth after the optimistic hide
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <div className={styles.titleHeaderRow}>
            <h1 className={styles.title}>My Requests</h1>
            <span className={styles.liveStreamBadge}>
              <span className={styles.liveDot} />
              Live Status
            </span>
          </div>
          <p className={styles.subtitle}>Every action you've submitted for approval — status, assigned checker, and rejection reasons if any.</p>
        </div>
        <button type="button" className={styles.refreshBtn} onClick={() => setRefreshKey((k) => k + 1)}>
          <Icon.Activity width={15} height={15} />
          <span>Refresh</span>
        </button>
      </div>

      <div className={styles.filterPills} role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={statusFilter === f.key}
            className={statusFilter === f.key ? styles.pillActive : styles.pill}
            onClick={() => setStatusFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}
      {revealError && <div className={styles.errorBanner}>{revealError}</div>}

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>SUBMITTED</th>
              <th>MODULE</th>
              <th>ACTION</th>
              <th>ENTITY</th>
              <th>CHECKER</th>
              <th>STATUS</th>
              <th>PASSWORD</th>
              <th>REJECTION REASON</th>
            </tr>
          </thead>
          <tbody>
            {items === null ? (
              Array.from({ length: pageSize }).map((_, i) => (
                <tr key={i}><td colSpan={8}><SkeletonBlock height={20} radius="4px" /></td></tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className={styles.emptyCell}>
                  {statusFilter === 'all' ? "You haven't submitted any requests yet." : `No ${statusFilter.toLowerCase()} requests.`}
                </td>
              </tr>
            ) : (
              items.map((r) => {
                const ActionIcon = ACTION_ICONS[r.action] ?? Icon.Edit
                return (
                  <tr key={r.id}>
                    <td className={styles.timeCell}>{formatDateOnly(r.requestedAt)}</td>
                    <td><Badge tone="info">{formatModuleName(r.module)}</Badge></td>
                    <td>
                      <span className={`${styles.actionCell} ${styles[`action_${r.action}`] ?? ''}`}>
                        <ActionIcon width={12} height={12} />
                        <span>{ACTION_LABELS[r.action] ?? r.action}</span>
                      </span>
                    </td>
                    <td>{r.entityLabel ? <span className={styles.entityLabel}>{r.entityLabel}</span> : <span className={styles.mutedText}>—</span>}</td>
                    <td>
                      {r.checkerName ? (
                        <div className={styles.actorCell}>
                          <span className={styles.checkerAvatar}>{r.checkerName.charAt(0).toUpperCase()}</span>
                          <span className={styles.actorName}>{r.checkerName}</span>
                        </div>
                      ) : (
                        <span className={styles.unassignedChip}>Unassigned</span>
                      )}
                    </td>
                    <td><Badge tone={STATUS_TONES[r.status]} dot>{r.status}</Badge></td>
                    <td>
                      {r.hasTempPassword && !collectedIds.has(r.id) ? (
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
                        <span className={styles.mutedText}>—</span>
                      )}
                    </td>
                    <td className={styles.reasonCell}>
                      {r.rejectionReason ?? <span className={styles.mutedText}>—</span>}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

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
