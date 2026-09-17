/**
 * @omniconnect/ui — the platform's shared component layer.
 *
 * WHAT BELONGS HERE
 * -----------------
 * A component earns a place in this package when it is used by the HOST **and** at least one remote
 * for the same purpose. Anything used several times inside a single app belongs in that app's own
 * `src/shared/`; anything used once stays next to the page that renders it.
 *
 * THE HOST IS THE DESIGN REFERENCE
 * --------------------------------
 * Every visual value here is copied from the host, which is the finalized design. Where a host value
 * has no exact token equivalent it is kept raw and flagged in the stylesheet rather than snapped to
 * the nearest token, because snapping would silently restyle the reference.
 *
 * HOW STYLING REACHES A REMOTE
 * ----------------------------
 * Design tokens are NOT bundled with these components. The host defines every `--omni-*` on `:root`,
 * and because custom properties inherit, a remote rendered inside the host document picks them up
 * automatically — which means a token change in the host propagates to every remote at runtime with
 * no rebuild. Import `@omniconnect/ui/tokens.css` only for standalone rendering (a remote's own
 * `vite preview`, a Vercel preview URL); it is layered so it can never override the host.
 *
 * CONVENTION
 * ----------
 * No inline `style={{}}`. All styling lives in a sibling `.module.css`. The single exception is a
 * CSS custom-property hand-off for a genuinely runtime value (`style={{ '--x': v }}`), with the
 * declaration itself in the stylesheet — see DataTable, Drawer and Skeleton.
 */

// ── Primitives ───────────────────────────────────────────────
export { Button } from './primitives/Button/Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './primitives/Button/Button'

export { Badge } from './primitives/Badge/Badge'
export type { BadgeProps, BadgeTone } from './primitives/Badge/Badge'

export { Input } from './primitives/Input/Input'
export type { InputProps } from './primitives/Input/Input'

export { Select } from './primitives/Select/Select'
export type { SelectProps, SelectOption, SelectChangeEvent } from './primitives/Select/Select'

export { Combobox } from './primitives/Combobox/Combobox'
export type { ComboboxProps, ComboboxOption } from './primitives/Combobox/Combobox'

export { SearchField } from './primitives/SearchField/SearchField'
export type { SearchFieldProps, SearchFieldSuggestion } from './primitives/SearchField/SearchField'

export { useDebouncedValue } from './hooks/useDebouncedValue'
export { useSuggestions } from './hooks/useSuggestions'
export { useCommittedFilter } from './hooks/useCommittedFilter'
export type { CommittedFilter } from './hooks/useCommittedFilter'
export type { SuggestionSource, UseSuggestionsOptions, UseSuggestionsResult } from './hooks/useSuggestions'

export { Checkbox } from './primitives/Checkbox/Checkbox'
export type { CheckboxProps } from './primitives/Checkbox/Checkbox'

export { Switch } from './primitives/Switch/Switch'
export type { SwitchProps } from './primitives/Switch/Switch'

export { Tabs, TabPanel } from './primitives/Tabs/Tabs'
export type { TabsProps, TabItem, TabPanelProps } from './primitives/Tabs/Tabs'

export { Icon } from './primitives/Icon/Icon'
export type { IconProps } from './primitives/Icon/Icon'
export { resolveIcon } from './primitives/Icon/resolveIcon'
export type { IconComponent } from './primitives/Icon/resolveIcon'

// ── Data display ─────────────────────────────────────────────
export { DataTable, DataTableEmpty, dataTableStyles } from './data/DataTable/DataTable'
export { ResponsiveRows } from './data/DataTable/ResponsiveRows'
export type { ResponsiveRowsProps, ResponsiveColumn, ColumnPriority } from './data/DataTable/ResponsiveRows'
export type { DataTableProps, DataTableEmptyProps } from './data/DataTable/DataTable'

export { Pagination } from './data/Pagination/Pagination'
export { RowsPerPage } from './data/RowsPerPage/RowsPerPage'
export { readStoredPageSize } from './data/RowsPerPage/RowsPerPage'
export type { RowsPerPageProps } from './data/RowsPerPage/RowsPerPage'
export type { PaginationProps } from './data/Pagination/Pagination'

export { EmptyState } from './data/EmptyState/EmptyState'

export { ColumnFilter, columnFilterStyles } from './data/ColumnFilter/ColumnFilter'
export type { ColumnFilterProps, ColumnFilterOption } from './data/ColumnFilter/ColumnFilter'

export { FilterBar } from './data/FilterBar/FilterBar'
export type { FilterBarProps, ActiveFilter } from './data/FilterBar/FilterBar'

export { RowAction } from './data/RowAction/RowAction'
export type { RowActionProps } from './data/RowAction/RowAction'

export { ActorCell } from './data/ActorCell/ActorCell'
export type { ActorCellProps } from './data/ActorCell/ActorCell'
export type { EmptyStateProps } from './data/EmptyState/EmptyState'

// ── Layout ───────────────────────────────────────────────────
export { Card } from './layout/Card/Card'
export type { CardProps } from './layout/Card/Card'

export { PageHeader, pageHeaderStyles } from './layout/PageHeader/PageHeader'
export type { PageHeaderProps } from './layout/PageHeader/PageHeader'

// ── Navigation ───────────────────────────────────────────────
export { NavItem, navItemStyles } from './navigation/NavItem/NavItem'
export type { NavItemProps } from './navigation/NavItem/NavItem'

// ── Overlays ─────────────────────────────────────────────────
export { Drawer, drawerStyles } from './overlay/Drawer/Drawer'
export type { DrawerProps } from './overlay/Drawer/Drawer'

export { Modal } from './overlay/Modal/Modal'
export type { ModalProps } from './overlay/Modal/Modal'

// ── Feedback ─────────────────────────────────────────────────
export { SkeletonBlock, SkeletonText, SkeletonAvatar, SkeletonTable, TableSkeleton } from './feedback/Skeleton/Skeleton'
export type {
  SkeletonBlockProps,
  SkeletonTextProps,
  SkeletonAvatarProps,
  SkeletonTableProps,
  TableSkeletonProps,
} from './feedback/Skeleton/Skeleton'

// ── Utilities ────────────────────────────────────────────────
export { classNames } from './utils/classNames'

export { getInitials } from './utils/getInitials'
export type { GetInitialsOptions } from './utils/getInitials'
export type { ClassValue } from './utils/classNames'

export { formatDate, formatDateTime, formatTime, formatRelativeTime, formatAuditTimestamp, EMPTY_VALUE } from './utils/formatDate'

export { sanitizeFilterInput, filterInputMode, filterTypeBlockedMessage } from './utils/filterInput'
export type { FilterInputType } from './utils/filterInput'

export { DetailSection, DetailSections, DetailGrid, DetailField, isEmptyDetailValue } from './data/DetailPanel/DetailPanel'
export type { DetailSectionProps, DetailFieldProps } from './data/DetailPanel/DetailPanel'

// ── Date range ───────────────────────────────────────────────────────────────
export { DateRangeColumnFilter } from './data/DateRange/DateRangeColumnFilter'
export type { DateRangeColumnFilterProps } from './data/DateRange/DateRangeColumnFilter'
export { DateRangeFilterButton } from './data/DateRange/DateRangeFilterButton'
export type { DateRangeFilterButtonProps } from './data/DateRange/DateRangeFilterButton'
export { DateRangeFields } from './data/DateRange/DateRangeFields'
export type { DateRangeFieldsProps } from './data/DateRange/DateRangeFields'
export {
  DATE_RANGE_PRESETS,
  EMPTY_DATE_RANGE,
  describeDateRange,
  isDateRangeActive,
  parseDateRange,
  resolveDateRange,
  serializeDateRange,
} from './data/DateRange/dateRange'
export type { DateRangeInstants, DateRangePreset, DateRangeValue } from './data/DateRange/dateRange'

export { useAnchoredPopover } from './hooks/useAnchoredPopover'
export type { AnchoredPopover, AnchoredPopoverOptions } from './hooks/useAnchoredPopover'

// ── Export ───────────────────────────────────────────────────────────────────
export { downloadCsv, describeTruncation, CsvExportError } from './utils/downloadCsv'
export type { CsvDownloadRequest, CsvDownloadResult } from './utils/downloadCsv'

export { createRequestCache } from './utils/requestCache'
export type { RequestCache, RequestCacheOptions, RequestCacheGetOptions } from './utils/requestCache'
