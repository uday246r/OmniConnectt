import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, isSuperAdminOrAdmin } from '../../auth/store/authStore'
import { useSettingsDrawerStore } from '../../../shared/stores/settingsDrawerStore'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue'
import { queryKeys } from '../../../shared/query/queryKeys'
import { useLiveRefetchInterval } from '../../../shared/query/invalidationBridge'
import { ApiError } from '../../../shared/api/httpClient'
import { toast } from '../../../shared/stores/toastStore'
import { Icon } from '../../../shared/components/Icon/Icon'
import { NO_ROLE_LABEL, usersApi, type UserFilterParams, type UserListItemDto } from '../api/usersApi'
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
  RowsPerPage,
  SearchField,
  formatDateTime,
  readStoredPageSize,
  type ActiveFilter,
  type ColumnFilterOption,
  type ResponsiveColumn,
  type SearchFieldSuggestion,
  DateRangeColumnFilter,
  EMPTY_DATE_RANGE,
  describeDateRange,
  isDateRangeActive,
  resolveDateRange,
  type DateRangeValue,
} from '@omniconnect/ui'
import styles from './UsersPage.module.css'

/** How many matches a type-ahead dropdown shows. */
const SUGGESTION_LIMIT = 8
/** Type-ahead that hits the server waits for a pause in typing — the platform's server type-ahead delay. */
const TYPEAHEAD_DEBOUNCE_MS = 250

function roleLabelOf(u: UserListItemDto): string {
  return u.roleName ?? (u.isAdministrator ? 'Administrator' : NO_ROLE_LABEL)
}

const STATUS_OPTIONS: ColumnFilterOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

function errorMessageOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback
}

/**
 * Users matching one type-ahead box, fetched from the whole directory.
 *
 * Suggestions used to be drawn from the one page the table had loaded, so a user outside it could not
 * be suggested at all. Each keystroke pause asks the server for the first few matches instead; results
 * are cached per text, so backspacing to an earlier value is instant.
 */
function useUserSuggestions(accessToken: string | null, field: 'search' | 'name' | 'phone', needle: string, limit = SUGGESTION_LIMIT) {
  const query = useQuery({
    queryKey: queryKeys.userDirectory.suggest(field, needle),
    enabled: Boolean(accessToken) && needle.length > 0,
    staleTime: 60_000,
    queryFn: ({ signal }) => usersApi.list(accessToken!, { page: 1, pageSize: limit, [field]: needle }, signal),
  })
  return needle ? (query.data?.items ?? []) : []
}

export function UsersPage() {
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAdministrator = useAuthStore((s) => isSuperAdminOrAdmin(s.user))
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const pushLayer = useSettingsDrawerStore((s) => s.pushLayer)
  const queryClient = useQueryClient()
  const refetchInterval = useLiveRefetchInterval()

  const canCreate = isAdministrator || hasCapability('host.settings.users', 'Create')
  const canEdit = isAdministrator || hasCapability('host.settings.users', 'Edit')

  const [resendingInviteFor, setResendingInviteFor] = useState<string | null>(null)

  async function handleResendInvite(user: UserListItemDto) {
    if (!accessToken) return
    setResendingInviteFor(user.id)
    try {
      const { emailed } = await usersApi.resendInvite(accessToken, user.id)
      if (emailed) {
        toast.success(`A new set-password link is on its way to ${user.email}.`, 'Invite sent')
      } else {
        // The server accepted the request but the mail did not go out, so the account is still
        // unreachable — saying "sent" here would be the one message the operator must not believe.
        toast.warning(
          `The invite for ${user.email} could not be delivered. Check the SMTP settings, then try again.`,
          'Invite not delivered',
        )
      }
      // The row stops offering Resend once the user redeems, so re-read rather than trusting the page.
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all() })
    } catch (err) {
      toast.error(errorMessageOf(err, 'Could not resend the invite.'), 'Invite not sent')
    } finally {
      setResendingInviteFor(null)
    }
  }

  const [nameFilter, setNameFilter] = useState('')
  const [mobileFilter, setMobileFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [lastLoginRange, setLastLoginRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => readStoredPageSize('host.users', 10))

  // Raw, per-keystroke text driving the suggestion dropdowns — distinct from nameFilter/mobileFilter,
  // which only change once a suggestion is picked or Enter commits.
  const [nameSearchInput, setNameSearchInput] = useState('')
  const [mobileSearchInput, setMobileSearchInput] = useState('')
  const debouncedNameSearchInput = useDebouncedValue(nameSearchInput, TYPEAHEAD_DEBOUNCE_MS).trim()
  const debouncedMobileSearchInput = useDebouncedValue(mobileSearchInput, TYPEAHEAD_DEBOUNCE_MS).replace(/\D/g, '')

  const debouncedName = useDebouncedValue(nameFilter, 300)
  const debouncedMobile = useDebouncedValue(mobileFilter, 300)

  // Toolbar quick search — the broad search box every list page in the platform has; the per-column
  // Name/Mobile filters stay for precise, single-field narrowing.
  const [quickSearchInput, setQuickSearchInput] = useState('')
  const debouncedQuickSearch = useDebouncedValue(quickSearchInput, TYPEAHEAD_DEBOUNCE_MS).trim()

  // Any filter change resets the page.
  useEffect(() => {
    setPage(1)
  }, [debouncedQuickSearch, debouncedName, debouncedMobile, roleFilter, statusFilter, lastLoginRange, pageSize])

  /*
   * Every filter is sent to the server, which filters, counts and pages the whole directory. The page
   * used to fetch one page of users (asking for 200; the server allows 100) and filter it here, so past
   * 100 accounts the rest of the directory was unreachable and the counts described a sample.
   */
  const filterParams: UserFilterParams = useMemo(() => {
    // Resolved when the filters change rather than stored, so a preset like "Last 7 Days" is anchored
    // to when it was chosen, and the query key stays stable between renders.
    const bounds = resolveDateRange(lastLoginRange)
    const mobileDigits = debouncedMobile.replace(/\D/g, '')
    return {
      search: debouncedQuickSearch || undefined,
      name: debouncedName.trim() || undefined,
      phone: mobileDigits || undefined,
      role: roleFilter || undefined,
      isActive: statusFilter === 'active' ? true : statusFilter === 'inactive' ? false : undefined,
      lastLoginFrom: bounds.from || undefined,
      lastLoginTo: bounds.to || undefined,
    }
  }, [debouncedQuickSearch, debouncedName, debouncedMobile, roleFilter, statusFilter, lastLoginRange])

  const listParams = useMemo(() => ({ ...filterParams, page, pageSize }), [filterParams, page, pageSize])

  // Cached queries: returning to Users renders what was already loaded, and a user created, edited or
  // deleted anywhere marks them stale through the invalidation bridge (they share the 'users' prefix).
  const listQuery = useQuery({
    queryKey: queryKeys.userDirectory.page(listParams),
    enabled: Boolean(accessToken),
    placeholderData: keepPreviousData,
    refetchInterval,
    queryFn: ({ signal }) => usersApi.list(accessToken!, listParams, signal),
  })
  const summaryQuery = useQuery({
    queryKey: queryKeys.userDirectory.summary(),
    enabled: Boolean(accessToken),
    refetchInterval,
    queryFn: ({ signal }) => usersApi.summary(accessToken!, signal),
  })
  const facetsParams = useMemo(() => ({ ...filterParams, role: undefined }), [filterParams])
  const facetsQuery = useQuery({
    queryKey: queryKeys.userDirectory.facets(facetsParams),
    enabled: Boolean(accessToken),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => usersApi.facets(accessToken!, facetsParams, signal),
  })

  const users: UserListItemDto[] | null = listQuery.isError ? [] : (listQuery.data?.items ?? null)
  const total = listQuery.data?.total ?? 0
  const summary = summaryQuery.data
  const error = listQuery.isError ? errorMessageOf(listQuery.error, 'Could not load users.') : null

  // A page past the end (the last user on it was deleted, or a filter narrowed the set) moves back to
  // the last page that has rows instead of showing an empty table under a non-zero count.
  useEffect(() => {
    if (!listQuery.data || listQuery.isPlaceholderData) return
    const lastPage = Math.max(1, Math.ceil(listQuery.data.total / pageSize))
    if (page > lastPage) setPage(lastPage)
  }, [listQuery.data, listQuery.isPlaceholderData, page, pageSize])

  const roleOptions: ColumnFilterOption[] = useMemo(() => {
    const roles = [...(facetsQuery.data?.roles ?? [])]
    // Keep a chosen role selectable even when the other filters leave nobody holding it.
    if (roleFilter && !roles.some((r) => r === roleFilter)) roles.push(roleFilter)
    return roles.map((v) => ({ value: v, label: v }))
  }, [facetsQuery.data, roleFilter])

  const nameMatches = useUserSuggestions(accessToken, 'name', debouncedNameSearchInput)
  const nameSuggestions: ColumnFilterOption[] = useMemo(
    () =>
      nameMatches.map((u) => ({
        value: u.name,
        label: (
          <span className={styles.suggestionRow}>
            <span className={styles.suggestionPrimary}>{u.name}</span>
            <span className={styles.suggestionSecondary}>{u.email}</span>
          </span>
        ),
      })),
    [nameMatches],
  )

  // Fetches more than it shows: the dropdown is one row per number, and several accounts can share one.
  const mobileMatches = useUserSuggestions(accessToken, 'phone', debouncedMobileSearchInput, SUGGESTION_LIMIT * 3)
  const mobileSuggestions: ColumnFilterOption[] = useMemo(() => {
    const byNumber = new Map<string, UserListItemDto[]>()
    for (const u of mobileMatches) {
      if (!u.phoneNumber) continue
      const existing = byNumber.get(u.phoneNumber)
      if (existing) existing.push(u)
      else byNumber.set(u.phoneNumber, [u])
    }
    return Array.from(byNumber.entries())
      .slice(0, SUGGESTION_LIMIT)
      .map(([number, holders]) => ({
        value: number,
        label: (
          <span className={styles.suggestionRow}>
            <span className={styles.suggestionPrimary}>{number}</span>
            <span className={styles.suggestionSecondary}>
              {holders.length === 1 ? holders[0].name : `${holders.length} users`}
            </span>
          </span>
        ),
      }))
  }, [mobileMatches])

  const quickMatches = useUserSuggestions(accessToken, 'search', debouncedQuickSearch)
  const quickSearchSuggestions: SearchFieldSuggestion[] = useMemo(
    () =>
      quickMatches.map((u) => ({
        // Keyed by user id, not name: two people can share a name, and the handler below resolves the
        // id back to the name it puts in the box.
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
      })),
    [quickMatches],
  )

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
    isDateRangeActive(lastLoginRange) && {
      key: 'lastLogin',
      label: 'Last Login',
      value: describeDateRange(lastLoginRange),
      onRemove: () => setLastLoginRange(EMPTY_DATE_RANGE),
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
          searchable
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
          searchable
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
      header: <DateRangeColumnFilter label="Last Login" value={lastLoginRange} onChange={setLastLoginRange} />,
      render: (u) => formatDateTime(u.lastLoginAt),
    },
    {
      key: 'actions',
      label: 'Actions',
      priority: 'always',
      align: 'right',
      render: (u) => (
        <div className={styles.rowActions}>
          <button
            type="button"
            className={styles.actionView}
            onClick={() => navigate(`/settings/users/${u.id}`)}
            title="View user details"
          >
            <Icon.Eye width={12} height={12} />
            <span>View</span>
          </button>
          {canEdit && (
            <button
              type="button"
              className={`${styles.actionIconBtn} ${styles.actionEdit}`}
              onClick={() => pushLayer({ type: 'user-form', userId: u.id })}
              title="Edit user"
            >
              <Icon.Edit width={13} height={13} />
            </button>
          )}
          {canEdit && u.awaitingPasswordSetup && (
            <button
              type="button"
              className={`${styles.actionIconBtn} ${styles.actionInvite}`}
              disabled={resendingInviteFor === u.id}
              onClick={() => void handleResendInvite(u)}
              title={resendingInviteFor === u.id ? 'Sending…' : 'Resend invite email'}
            >
              {resendingInviteFor === u.id ? (
                <Icon.Loader width={13} height={13} className={styles.spin} />
              ) : (
                <Icon.Mail width={13} height={13} />
              )}
            </button>
          )}
        </div>
      ),
    },
  ]

  const summaryValue = (value: number | undefined) => (value === undefined ? '—' : value.toLocaleString())

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
            <span className={styles.summaryValue}>{summaryValue(summary?.total)}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconGreen}`}>
            <Icon.CheckCircle width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Active</span>
            <span className={styles.summaryValue}>{summaryValue(summary?.active)}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconGray}`}>
            <Icon.UserMinus width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Inactive</span>
            <span className={styles.summaryValue}>{summaryValue(summary?.inactive)}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconPurple}`}>
            <Icon.Crown width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Administrators</span>
            <span className={styles.summaryValue}>{summaryValue(summary?.administrators)}</span>
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
          setLastLoginRange(EMPTY_DATE_RANGE)
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
              onSelectSuggestion={(s) => setQuickSearchInput(quickMatches.find((u) => u.id === s.id)?.name ?? s.id)}
              emptyHint="No matching users."
            />
          </div>
          <div className={styles.toolbarActions}>
            <RowsPerPage storageKey="host.users" value={pageSize} onChange={setPageSize} />
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Icon.Activity width={15} height={15} />}
              onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.users.all() })}
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
            rows={users ?? []}
            rowKey={(u) => u.id}
            loading={users === null}
            loadingRows={pageSize > 15 ? 10 : pageSize}
            empty={<EmptyState compact title="No users found matching the selected filters." />}
          />
        </DataTable>
      </div>
    </div>
  )
}
