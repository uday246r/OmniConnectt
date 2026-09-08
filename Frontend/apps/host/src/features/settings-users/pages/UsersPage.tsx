import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../auth/store/authStore'
import { useSettingsDrawerStore } from '../../../shared/stores/settingsDrawerStore'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue'
import { TOPICS, useDataRevision } from '../../../shared/stores/invalidationStore'
import { ApiError } from '../../../shared/api/httpClient'
import { Icon } from '../../../shared/components/Icon/Icon'
import { usersApi, type UserListItemDto } from '../api/usersApi'
import { DateTimeRangeFilter, type DateTimeRangeValue } from '../../../shared/components/DateTimeRangeFilter/DateTimeRangeFilter'
import {
  ActorCell,
  Badge,
  Button,
  ColumnFilter,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Pagination,
  ResponsiveRows,
  RowAction,
  RowsPerPage,
  SearchField,
  formatDateTime,
  readStoredPageSize,
  type ActiveFilter,
  type ColumnFilterOption,
  type ResponsiveColumn,
  type SearchFieldSuggestion,
} from '@omniremit/ui'
import styles from './UsersPage.module.css'

// A generous fixed pool, not the whole directory — matching Approval Center and Audit Logs, which
// fetch one large page from the server and do every further filter/sort/paginate pass client-side
// against it. Role options are drawn from this SAME pool (see roleOptions below), not a separate
// roles round-trip, so a filter never offers a choice that couldn't actually appear in the table.
const POOL_SIZE = 200

function roleLabelOf(u: UserListItemDto): string {
  return u.roleName ?? (u.isAdministrator ? 'Administrator' : 'No Role')
}

const STATUS_OPTIONS: ColumnFilterOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

export function UsersPage() {
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAdministrator = Boolean(useAuthStore((s) => s.user)?.isAdministrator)
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const pushLayer = useSettingsDrawerStore((s) => s.pushLayer)
  const dataRevision = useDataRevision(TOPICS.users)

  const canCreate = isAdministrator || hasCapability('host.settings.users', 'Create')

  const [pool, setPool] = useState<UserListItemDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nameFilter, setNameFilter] = useState('')
  const [mobileFilter, setMobileFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [lastLoginRange, setLastLoginRange] = useState<DateTimeRangeValue>({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => readStoredPageSize('host.users', 10))
  const [refreshKey, setRefreshKey] = useState(0)

  // Raw, per-keystroke text driving the suggestion dropdowns — distinct from nameFilter/mobileFilter,
  // which only change once a suggestion is picked or Enter commits. Debounced at 200ms, the delay
  // this app already uses for filtering an in-memory pool (AuditLogsPage, ApprovalCenterPage) rather
  // than the 250ms reserved for type-ahead that actually hits the server.
  const [nameSearchInput, setNameSearchInput] = useState('')
  const [mobileSearchInput, setMobileSearchInput] = useState('')
  const debouncedNameSearchInput = useDebouncedValue(nameSearchInput, 200)
  const debouncedMobileSearchInput = useDebouncedValue(mobileSearchInput, 200)

  const debouncedName = useDebouncedValue(nameFilter, 300)

  // Toolbar quick search — the empty space next to Rows/Refresh, on every other list page in the
  // platform (Audit Logs, Approval Center, lead_mf's View Leads) this is where a broad search box
  // lives; the per-column Name/Mobile filters stay for precise, single-field narrowing. Same
  // suggestion-dropdown treatment as the Name column filter (now built into SearchField itself),
  // and the same 200ms pool-filtering debounce used throughout this page.
  const [quickSearchInput, setQuickSearchInput] = useState('')
  const debouncedQuickSearch = useDebouncedValue(quickSearchInput, 200)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    setError(null)
    usersApi
      .list(accessToken, { page: 1, pageSize: POOL_SIZE })
      .then((res) => {
        if (!cancelled) setPool(res.items)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load users.')
        setPool([])
      })
    return () => {
      cancelled = true
    }
  }, [accessToken, dataRevision, refreshKey])

  const debouncedMobile = useDebouncedValue(mobileFilter, 300)

  // Any filter change resets the page.
  useEffect(() => {
    setPage(1)
  }, [debouncedQuickSearch, debouncedName, debouncedMobile, roleFilter, statusFilter, lastLoginRange])

  const roleOptions: ColumnFilterOption[] = useMemo(() => {
    if (!pool) return []
    const seen = new Map<string, string>()
    for (const u of pool) {
      const label = roleLabelOf(u)
      if (!seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }))
  }, [pool])

  const nameSuggestions: ColumnFilterOption[] = useMemo(() => {
    if (!pool) return []
    const needle = debouncedNameSearchInput.trim().toLowerCase()
    if (!needle) return []
    return pool
      .filter((u) => u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle))
      .slice(0, 8)
      .map((u) => ({
        value: u.name,
        label: (
          <span className={styles.suggestionRow}>
            <span className={styles.suggestionPrimary}>{u.name}</span>
            <span className={styles.suggestionSecondary}>{u.email}</span>
          </span>
        ),
      }))
  }, [pool, debouncedNameSearchInput])

  const mobileSuggestions: ColumnFilterOption[] = useMemo(() => {
    if (!pool) return []
    const needle = debouncedMobileSearchInput.replace(/\D/g, '')
    if (!needle) return []
    // Grouped by the number itself, not by user — more than one account can share a phone number
    // (this seed data has exactly that), and the suggestion list should show one row per number,
    // not one indistinguishable duplicate per account.
    const byNumber = new Map<string, UserListItemDto[]>()
    for (const u of pool) {
      const digits = (u.phoneNumber ?? '').replace(/\D/g, '')
      if (digits && digits.includes(needle)) {
        const existing = byNumber.get(u.phoneNumber!)
        if (existing) existing.push(u)
        else byNumber.set(u.phoneNumber!, [u])
      }
    }
    return Array.from(byNumber.entries())
      .slice(0, 8)
      .map(([number, users]) => ({
        value: number,
        label: (
          <span className={styles.suggestionRow}>
            <span className={styles.suggestionPrimary}>{number}</span>
            <span className={styles.suggestionSecondary}>
              {users.length === 1 ? users[0].name : `${users.length} users`}
            </span>
          </span>
        ),
      }))
  }, [pool, debouncedMobileSearchInput])

  // Matches the broad quick search against name, email, mobile and role in one pass — this is what
  // powers both the toolbar's suggestion dropdown and (once debounced) the table filter itself.
  const matchesQuickSearch = (u: UserListItemDto, needle: string) => {
    if (!needle) return true
    const digits = needle.replace(/\D/g, '')
    return (
      u.name.toLowerCase().includes(needle) ||
      u.email.toLowerCase().includes(needle) ||
      roleLabelOf(u).toLowerCase().includes(needle) ||
      (digits.length > 0 && (u.phoneNumber ?? '').replace(/\D/g, '').includes(digits))
    )
  }

  const quickSearchSuggestions: SearchFieldSuggestion[] = useMemo(() => {
    if (!pool) return []
    const needle = debouncedQuickSearch.trim().toLowerCase()
    if (!needle) return []
    return pool
      .filter((u) => matchesQuickSearch(u, needle))
      .slice(0, 8)
      .map((u) => ({
        // Keyed by user id, not name: two people genuinely share the name "Tushar" here, and using
        // the name collapsed them into duplicate React keys ("Encountered two children with the
        // same key"). They stay as two rows — different email, different role — and the handler
        // below resolves the id back to the name it puts in the box.
        id: u.id,
        label: (
          <>
            <span className={styles.suggestionRow}>
              <span className={styles.suggestionPrimary}>{u.name}</span>
              <span className={styles.suggestionSecondary}>{u.email}</span>
            </span>
            <Badge tone="primary">{roleLabelOf(u)}</Badge>
          </>
        ),
      }))
  }, [pool, debouncedQuickSearch])

  const visibleUsers = useMemo(() => {
    if (!pool) return null
    const needle = debouncedName.trim().toLowerCase()
    // Phone numbers carry formatting (+91, spaces) the operator won't type — compare digits only.
    const mobileDigits = debouncedMobile.replace(/\D/g, '')
    const fromMs = lastLoginRange.from ? new Date(lastLoginRange.from).getTime() : undefined
    const toMs = lastLoginRange.to ? new Date(lastLoginRange.to).getTime() : undefined
    const quickNeedle = debouncedQuickSearch.trim().toLowerCase()

    return pool.filter((u) => {
      if (quickNeedle && !matchesQuickSearch(u, quickNeedle)) return false
      if (needle && !u.name.toLowerCase().includes(needle) && !u.email.toLowerCase().includes(needle)) return false
      if (mobileDigits && !(u.phoneNumber ?? '').replace(/\D/g, '').includes(mobileDigits)) return false
      if (roleFilter && roleLabelOf(u) !== roleFilter) return false
      if (statusFilter === 'active' && !u.isActive) return false
      if (statusFilter === 'inactive' && u.isActive) return false
      if (fromMs !== undefined || toMs !== undefined) {
        const loginMs = u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : undefined
        if (loginMs === undefined) return false
        if (fromMs !== undefined && loginMs < fromMs) return false
        if (toMs !== undefined && loginMs > toMs) return false
      }
      return true
    })
  }, [pool, debouncedQuickSearch, debouncedName, debouncedMobile, roleFilter, statusFilter, lastLoginRange])

  const total = visibleUsers?.length ?? 0
  const pagedUsers = useMemo(() => {
    if (!visibleUsers) return []
    const start = (page - 1) * pageSize
    return visibleUsers.slice(start, start + pageSize)
  }, [visibleUsers, page, pageSize])

  const summary = useMemo(() => {
    const items = pool ?? []
    return {
      total: items.length,
      active: items.filter((u) => u.isActive).length,
      inactive: items.filter((u) => !u.isActive).length,
      admins: items.filter((u) => u.isAdministrator).length,
    }
  }, [pool])

  const activeFilters: ActiveFilter[] = [
    debouncedQuickSearch && { key: 'search', label: 'Search', value: `"${debouncedQuickSearch}"`, onRemove: () => setQuickSearchInput('') },
    debouncedName && { key: 'name', label: 'Name', value: `"${debouncedName}"`, onRemove: () => setNameFilter('') },
    debouncedMobile && { key: 'mobile', label: 'Mobile', value: `"${debouncedMobile}"`, onRemove: () => setMobileFilter('') },
    roleFilter && { key: 'role', label: 'Role', value: roleFilter, onRemove: () => setRoleFilter('') },
    statusFilter && {
      key: 'status',
      label: 'Status',
      value: statusFilter === 'active' ? 'Active' : 'Inactive',
      onRemove: () => setStatusFilter(''),
    },
    (lastLoginRange.from || lastLoginRange.to) && {
      key: 'lastLogin',
      label: 'Last Login',
      value: `${lastLoginRange.from ? formatDateTime(lastLoginRange.from) : '…'} → ${lastLoginRange.to ? formatDateTime(lastLoginRange.to) : '…'}`,
      onRemove: () => setLastLoginRange({}),
    },
  ].filter(Boolean) as ActiveFilter[]

  const columns: ResponsiveColumn<UserListItemDto>[] = [
    {
      key: 'name',
      label: 'Name',
      priority: 'always',
      header: (
        <ColumnFilter
          label="Name"
          value={nameFilter}
          onChange={setNameFilter}
          options={[]}
          freeText
          filterType="text"
          searchPlaceholder="Search by name or email..."
          emptyHint="No matching users — press Enter to search anyway."
          suggestions={nameSuggestions}
          onSearchChange={setNameSearchInput}
        />
      ),
      render: (u) => <ActorCell name={u.name} meta={u.email} fallback={u.email} />,
    },
    {
      key: 'phone',
      label: 'Mobile',
      priority: 'high',
      header: (
        <ColumnFilter
          label="Mobile"
          value={mobileFilter}
          onChange={setMobileFilter}
          options={[]}
          freeText
          filterType="numeric"
          searchPlaceholder="Search by mobile number..."
          emptyHint="No matching numbers — press Enter to search anyway."
          suggestions={mobileSuggestions}
          onSearchChange={setMobileSearchInput}
        />
      ),
      render: (u) => u.phoneNumber ?? '—',
    },
    {
      key: 'role',
      label: 'Role',
      priority: 'always',
      header: (
        <ColumnFilter
          label="Role"
          value={roleFilter}
          onChange={setRoleFilter}
          options={roleOptions}
          allLabel="All Roles"
          searchable={roleOptions.length > 6}
          filterType="alpha"
        />
      ),
      render: (u) => <Badge tone="primary">{roleLabelOf(u)}</Badge>,
    },
    {
      key: 'status',
      label: 'Status',
      priority: 'always',
      header: (
        <ColumnFilter
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_OPTIONS}
          allLabel="All Statuses"
          searchable={false}
        />
      ),
      render: (u) => (
        <Badge tone={u.isActive ? 'success' : 'neutral'} dot>
          {u.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'lastLogin',
      label: 'Last Login',
      priority: 'low',
      header: <DateTimeRangeFilter label="Last Login" value={lastLoginRange} onChange={setLastLoginRange} />,
      render: (u) => formatDateTime(u.lastLoginAt),
    },
    {
      key: 'actions',
      label: '',
      priority: 'always',
      align: 'right',
      render: (u) => <RowAction onClick={() => navigate(`/settings/users/${u.id}`)}>View</RowAction>,
    },
  ]

  return (
    <div className={styles.page}>
      <PageHeader
        title="Users"
        subtitle="Manage platform user accounts and their assigned roles."
        actions={
          canCreate && (
            <Button leadingIcon={<Icon.Plus width={16} height={16} />} onClick={() => pushLayer({ type: 'user-form' })}>
              Add User
            </Button>
          )
        }
      />

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconBlue}`}>
            <Icon.Users width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Total Users</span>
            <span className={styles.summaryValue}>{pool === null ? '—' : summary.total}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconGreen}`}>
            <Icon.CheckCircle width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Active</span>
            <span className={styles.summaryValue}>{pool === null ? '—' : summary.active}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconGray}`}>
            <Icon.X width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Inactive</span>
            <span className={styles.summaryValue}>{pool === null ? '—' : summary.inactive}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconPurple}`}>
            <Icon.Crown width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Administrators</span>
            <span className={styles.summaryValue}>{pool === null ? '—' : summary.admins}</span>
          </div>
        </div>
      </div>

      <FilterBar
        filters={activeFilters}
        onClearAll={() => {
          setQuickSearchInput('')
          setNameFilter('')
          setMobileFilter('')
          setRoleFilter('')
          setStatusFilter('')
          setLastLoginRange({})
        }}
      />

      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}

      <div className={styles.card}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarSearch}>
            <SearchField
              placeholder="Search by name, email, mobile, or role…"
              value={quickSearchInput}
              onValueChange={setQuickSearchInput}
              suggestions={quickSearchSuggestions}
              onSelectSuggestion={(s) => setQuickSearchInput(pool?.find((u) => u.id === s.id)?.name ?? s.id)}
              emptyHint="No matching users."
            />
          </div>
          <div className={styles.toolbarActions}>
            <RowsPerPage storageKey="host.users" value={pageSize} onChange={setPageSize} />
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Icon.Activity width={15} height={15} />}
              onClick={() => setRefreshKey((k) => k + 1)}
            >
              Refresh
            </Button>
          </div>
        </div>

        <DataTable
          bare
          reserveHeight
          footer={<Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} itemLabel="user" />}
        >
          <ResponsiveRows
            columns={columns}
            rows={pagedUsers}
            rowKey={(u) => u.id}
            loading={pool === null}
            loadingRows={pageSize > 15 ? 10 : pageSize}
            empty={<EmptyState compact title="No users found matching the selected filters." />}
          />
        </DataTable>
      </div>
    </div>
  )
}
