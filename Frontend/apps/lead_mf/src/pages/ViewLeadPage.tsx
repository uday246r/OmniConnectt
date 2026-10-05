import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye,
  Edit3,
  Trash2,
  Filter,
  RefreshCw,
  UserPlus,
  Search,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  X,
} from '@omniconnect/ui/icons';
import { Button, ColumnFilter, DataTable, FilterBar, PageHeader, Pagination, ResponsiveRows, RowsPerPage, SearchField, getInitials, sanitizeFilterInput, useDebouncedValue, type ActiveFilter, type SearchFieldSuggestion } from '@omniconnect/ui';
import { useLeadStore } from '../store/useLeadStore';
import { useHostNavigate } from '../navigation/HostNavigation';
import styles from './ViewLeadPage.module.css';
import shell from '../shared/leadPage.module.css';
import { LeadDetailsDrawer } from '../components/lead/LeadDetailsDrawer';
import { EditReasonDrawer } from '../components/lead/EditReasonDrawer';
import { EditLeadDrawer } from '../components/lead/EditLeadDrawer';
import { DeleteLeadDrawer } from '../components/lead/DeleteLeadDrawer';
import { LeadFilterPopover } from '../components/lead/LeadFilterPopover';
import { canEditLead, canDeleteLead, canCreateLead } from '../api/hostBridge';
import { isFieldVisible } from '../config/fieldControlRegistry';
import { applyMaskingRule, formatFieldValue } from '../utils/fieldMasking';
import { formatPhone } from '../shared/formatPhone';
import { useShallow } from 'zustand/react/shallow';

/** Renders '-' for genuinely empty values, else the masked/raw value per the common field config —
 * the View Leads table only ever reflects the common-field subset (see commonFieldConfig's own doc
 * comment in useLeadStore), so product-specific fields never appear here regardless of config. */
function renderMaskedCell(config: ReturnType<typeof useLeadStore.getState>['commonFieldConfig'], apiField: string, raw: unknown) {
  const formatted = formatFieldValue(raw);
  if (formatted === '-') return formatted;
  const entry = config.find((f) => f.apiField === apiField);
  if (!entry?.sensitive) return formatted;
  return applyMaskingRule(formatted, entry.maskingRule, entry.visibleCharCount);
}

const AVATAR_COLORS = [
  { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  { bg: '#ede9fe', text: '#6d28d9', border: '#ddd6fe' },
  { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' },
  { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  { bg: '#fdf2f8', text: '#be185d', border: '#fbcfe8' },
  { bg: '#f0fdfa', text: '#0f766e', border: '#99f6e4' },
];

/* Column key -> the name shown on its filter chip. */
const TOOLBAR_FILTER_LABELS: { field: string; label: string }[] = [
  { field: 'name', label: 'Customer' },
  { field: 'icNumber', label: 'IC Number' },
  { field: 'phone', label: 'Contact' },
  { field: 'product', label: 'Product' },
  { field: 'branch', label: 'Branch' },
  { field: 'createdFrom', label: 'Created From' },
  { field: 'createdTo', label: 'Created To' },
  { field: 'status', label: 'Status' },
  { field: 'salesExecutive', label: 'Executive' },
  { field: 'state', label: 'State' },
];

export const ViewLeadPage: React.FC = () => {
  const {
    leads,
    totalRecords,
    totalPages,
    currentPage,
    pageSize,
    isLoadingLeads,
    searchQuery,
    setSearchQuery,
    productFilterOptions,
    states,
    branches,
    filterRules,
    setColumnFilter,
    clearAllFilters,
    setPage,
    setPageSize,
    fetchLeads,
    fetchMasterData,
    openDetailsDrawer,
    openEditWorkflow,
    openDeleteWorkflow,
    commonFieldConfig,
    fetchCommonFieldConfig,
  } = useLeadStore(useShallow((s) => ({ leads: s.leads, totalRecords: s.totalRecords, totalPages: s.totalPages, currentPage: s.currentPage, pageSize: s.pageSize, isLoadingLeads: s.isLoadingLeads, searchQuery: s.searchQuery, setSearchQuery: s.setSearchQuery, productFilterOptions: s.productFilterOptions, states: s.states, branches: s.branches, filterRules: s.filterRules, setColumnFilter: s.setColumnFilter, clearAllFilters: s.clearAllFilters, setPage: s.setPage, setPageSize: s.setPageSize, fetchLeads: s.fetchLeads, fetchMasterData: s.fetchMasterData, openDetailsDrawer: s.openDetailsDrawer, openEditWorkflow: s.openEditWorkflow, openDeleteWorkflow: s.openDeleteWorkflow, commonFieldConfig: s.commonFieldConfig, fetchCommonFieldConfig: s.fetchCommonFieldConfig })));
  const navigate = useHostNavigate();

  const [showFilters, setShowFilters] = useState(false);
  const filterAnchorRef = useRef<HTMLDivElement>(null);
  const [localSearch, setLocalSearch] = useState(searchQuery);

  /*
   * Leads load once on arrival. Filter, search and pagination changes call fetchLeads() themselves.
   *
   * This used to sit in one effect together with the reference-data loads below, and that effect
   * listed states.length / commonFieldConfig.length as dependencies. Those lengths
   * go 0 → N the moment fetchMasterData() resolves, so the effect re-ran and fetched the leads a
   * SECOND time — and because fetchLeads() flips isLoadingLeads on the way in and out, the table
   * visibly went skeleton → rows → skeleton → rows on every refresh.
   */
  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  /*
   * Reference data, fetched once if this session does not have it yet. The length checks are a
   * "do we already have it" guard, NOT an input — keeping them out of the dependency array is what
   * stops the fetch from re-triggering itself as its own result arrives.
   */
  useEffect(() => {
    if (states.length === 0) {
      fetchMasterData();
    }
    if (commonFieldConfig.length === 0) {
      void fetchCommonFieldConfig();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * The toolbar search used to reach the server only on Enter, which made it the one search box in
   * the platform that did nothing while you typed. 300ms because a real request sits behind it —
   * setSearchQuery resets to page 1 and refetches on its own, so this effect must not also call
   * fetchLeads or every keystroke burst would fire twice.
   */
  const debouncedSearch = useDebouncedValue(localSearch, 300);
  const searchPrimedRef = useRef(false);

  /*
   * Whether a field may appear in a recommendation at all.
   *
   * The table masks any field the config marks Sensitive (renderMaskedCell) and drops any it marks
   * hidden. A suggestion list is the same data by another route, so it has to honour the same rule
   * — otherwise the IC column would show `*******9184` while the dropdown beside it printed the
   * number in full.
   */
  const suggestable = (apiField: string) => {
    const entry = commonFieldConfig.find((f) => f.apiField === apiField);
    return isFieldVisible(commonFieldConfig, apiField) && !entry?.sensitive;
  };

  useEffect(() => {
    // Skip the first run: the mount effect above already fetched, and searchQuery seeds localSearch,
    // so firing here would be a duplicate request before the operator has typed anything.
    if (!searchPrimedRef.current) {
      searchPrimedRef.current = true;
      return;
    }
    if (debouncedSearch === searchQuery) return;
    setSearchQuery(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Enter still applies immediately rather than waiting out the debounce.
    if (localSearch === searchQuery) return;
    setSearchQuery(localSearch);
  };

  const handleClearSearch = () => {
    setLocalSearch('');
    if (searchQuery === '') return;
    setSearchQuery('');
  };

  /*
   * Recommendations for the toolbar search, drawn from the leads already on this page — no extra
   * request, and nothing offered that the directory could not show. Name on top, IC/phone beneath
   * so two customers with the same name stay tellable apart.
   */
  const searchSuggestions: SearchFieldSuggestion[] = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set<string>();
    const out: SearchFieldSuggestion[] = [];
    for (const lead of leads) {
      const name = lead.name?.trim();
      if (!name) continue;
      const haystack = `${name} ${lead.icNumber ?? ''} ${lead.phone ?? ''} ${lead.branch ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // Only fields the config allows in the clear appear on the second line — otherwise this
      // dropdown would print in full what the table's own cells mask.
      const meta = [
        suggestable('icNumber') && lead.icNumber,
        suggestable('phoneNumber') && lead.phone && formatPhone(lead.phone),
      ]
        .filter(Boolean)
        .join(' · ');
      out.push({
        id: name,
        label: (
          <span className={styles.suggestionRow}>
            <span className={styles.suggestionPrimary}>{name}</span>
            {meta && <span className={styles.suggestionSecondary}>{meta}</span>}
          </span>
        ),
      });
      if (out.length >= 8) break;
    }
    return out;
  }, [leads, debouncedSearch]);

  const activeFilterCount = filterRules.filter((r) => r.value && r.value.trim().length > 0).length;

  // Per-column filters read and write the same rule list the toolbar's Filter popover edits, so the
  // two stay in sync: setting Product in the header shows up as an active rule in the popover and
  // counts toward "Filters (n)".
  const columnValue = (field: string) => filterRules.find((r) => r.field === field)?.value ?? '';
  const toOptions = (list: { value?: string; label?: string }[]) =>
    list.map((o) => ({ value: String(o.value ?? o.label ?? ''), label: o.label ?? String(o.value ?? '') }));
  /*
   * Per-column recommendations, taken from the leads already loaded — a header filter should only
   * ever offer a value this directory actually holds, and typing must not cost a request.
   *
   * A column the field config hides, or marks Sensitive, is deliberately given NO pool (see
   * `suggestable` above): the table masks those cells, and a dropdown listing the unmasked IC
   * numbers would hand back exactly what the masking rule exists to withhold.
   */

  // The IC only qualifies the name when the config lets it be shown — otherwise the second line
  // would print in full exactly what the IC column masks.
  const namePool = useMemo(
    () =>
      leads.map((l) => ({
        value: l.name ?? '',
        meta: suggestable('icNumber') ? l.icNumber || undefined : undefined,
      })),
    [leads, commonFieldConfig],
  );
  const icPool = useMemo(
    () => (suggestable('icNumber') ? leads.map((l) => ({ value: l.icNumber ?? '', meta: l.name || undefined })) : []),
    [leads, commonFieldConfig],
  );
  /*
   * Phone rows are stored with a doubled prefix (`+60 +60 17-234 5678`) — the reason formatPhone
   * exists — and this filter box strips `+` outright, so the stored string is neither what the cell
   * shows nor something the box could ever hold: recommending it verbatim displayed the doubled
   * prefix and matched no rows when picked. Show the collapsed form the table shows, commit the
   * digits-and-separators form the operator would have typed from it.
   */
  const phonePool = useMemo(
    () =>
      suggestable('phoneNumber')
        ? leads.map((l) => {
            const shown = formatPhone(l.phone);
            return {
              value: sanitizeFilterInput(shown, 'numeric').trim(),
              label: shown,
              meta: l.name || undefined,
            };
          })
        : [],
    [leads, commonFieldConfig],
  );
  const createdPool = useMemo(
    () => leads.map((l) => ({ value: l.createdDate ?? '' })),
    [leads],
  );

  const startIndex = totalRecords > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const endIndex = Math.min(currentPage * pageSize, totalRecords);

  return (
    <div className={shell.page}>
      {/* Hero banner — @omniconnect/ui PageHeader. This screen previously hand-rolled the banner,
          its two decorative blooms and a white CTA with three JS mouse handlers, at a radius,
          padding, gradient angle and title size that had all drifted from the host's. */}
      <PageHeader
        icon={<FolderKanban size={24} />}
        title="Lead Directory"
        pill={`${totalRecords} Total Records`}
        subtitle="Browse, filter, inspect and manage customer financing applications across all branches"
        actions={
          canCreateLead() ? (
            <Button
              type="button"
              variant="onHeader"
              onClick={() => navigate('create-lead')}
              leadingIcon={<UserPlus size={15} />}
            >
              Create Lead
            </Button>
          ) : null
        }
      />

      {/* Main Table Container Card */}
      {/*
        * Active-filter readout. Column filters and the toolbar popover both write into the same
        * `filterRules`, so this is the one place that shows what is actually in force — without it
        * a filter set from a column header is invisible unless you reopen that column.
        */}
      <FilterBar
        filters={[
          ...TOOLBAR_FILTER_LABELS.map(({ field, label }) => {
            const value = columnValue(field);
            return value
              ? { key: field, label, value, onRemove: () => setColumnFilter(field, '') }
              : null;
          }),
          localSearch && {
            key: 'search',
            label: 'Search',
            value: `"${localSearch}"`,
            onRemove: () => handleClearSearch(),
          },
        ].filter(Boolean) as ActiveFilter[]}
        onClearAll={() => {
          clearAllFilters();
          setLocalSearch('');
        }}
      />

      <div className={shell.card}>
        {/* Table Controls Toolbar */}
        <div className={shell.toolbar}>
          {/* Left Controls: Search Bar */}
          <div className={shell.toolbarLeft}>
            <form onSubmit={handleSearchSubmit} className={shell.searchForm}>
              <SearchField
                placeholder="Search name, IC, phone, branch..."
                value={localSearch}
                onValueChange={(v) => (v === '' ? handleClearSearch() : setLocalSearch(v))}
                suggestions={searchSuggestions}
                onSelectSuggestion={(s) => setLocalSearch(s.id)}
                emptyHint="No matching lead on this page."
              />
            </form>
          </div>

          {/* Right Controls: Filter + Refresh */}
          <div className={shell.toolbarRight}>
            {/* Filter Popover Button */}
            <div className={shell.filterAnchor} ref={filterAnchorRef}>
              <button
                type="button"
                onClick={() => setShowFilters(!showFilters)}
                className={`${shell.toolbarBtn} ${shell.filterBtn}${
                  showFilters || activeFilterCount > 0 ? ` ${shell.filterBtnActive}` : ''
                }`}
              >
                <Filter size={14} />
                <span>{activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filter'}</span>
              </button>

              <LeadFilterPopover isOpen={showFilters} onClose={() => setShowFilters(false)} anchorRef={filterAnchorRef} />
            </div>

            {/* Refresh Button */}
            <RowsPerPage storageKey="lead.directory" value={pageSize} onChange={(n) => { setPageSize(n); setPage(1); }} />

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fetchLeads()}
              leadingIcon={<RefreshCw size={15} className={isLoadingLeads ? 'animate-spin' : ''} />}
            >
              Refresh
            </Button>
          </div>
        </div>

        {/* Table Content */}
        <DataTable bare footer={<Pagination page={currentPage} pageSize={pageSize} total={totalRecords} itemLabel="lead" onPageChange={setPage} />}>
          <ResponsiveRows
            rows={leads}
            rowKey={(lead) => String(lead.id)}
            rowId={(lead) => `lead-row-${lead.id}`}
            loading={isLoadingLeads}
            loadingRows={pageSize}
            empty={
              activeFilterCount > 0 || localSearch || searchQuery
                ? 'No leads found matching the selected filters. Try adjusting your search query or filter criteria.'
                : 'No leads found. Get started by creating your first lead application.'
            }
            columns={[
                {
                  key: 'name',
                  label: 'Customer Details',
                  priority: 'always',
                  header: (
                    <ColumnFilter
                      key="name"
                      label="Customer Details"
                      title="Filter Name"
                      value={columnValue('name')}
                      onChange={(v) => setColumnFilter('name', v)}
                      options={[]}
                      allLabel={undefined}
                      freeText
                      filterType="alpha"
                      searchPlaceholder="Type a customer name…"
                      suggestFrom={namePool}
                      emptyHint="No matching customer on this page."
                    />
                  ),
                  render: (lead, idx) => {
                    const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length];
                    return (
                      <div className={styles.customerCell}>
                        {/* Avatar palette is chosen per row from AVATAR_COLORS, so the three
                            colours arrive as CSS custom properties; the declarations that use
                            them live in ViewLeadPage.module.css. */}
                        <div
                          className={styles.avatar}
                          style={
                            {
                              '--lead-avatar-bg': avatarColor.bg,
                              '--lead-avatar-text': avatarColor.text,
                              '--lead-avatar-border': avatarColor.border,
                            } as React.CSSProperties
                          }
                        >
                          {getInitials(lead.name)}
                        </div>
                        <span className={styles.customerName}>{lead.name}</span>
                      </div>
                    );
                  },
                },
                {
                  key: 'icNumber',
                  label: 'IC Number',
                  priority: 'high',
                  header: (
                    <ColumnFilter
                      key="icNumber"
                      label="IC Number"
                      title="Filter IC Number"
                      value={columnValue('icNumber')}
                      onChange={(v) => setColumnFilter('icNumber', v)}
                      options={[]}
                      allLabel={undefined}
                      freeText
                      filterType="numeric"
                      searchPlaceholder="Type an IC number…"
                      suggestFrom={icPool}
                      emptyHint="No matching IC number on this page."
                    />
                  ),
                  /* Masked per Field Settings when the field is marked Sensitive. */
                  render: (lead) =>
                    isFieldVisible(commonFieldConfig, 'icNumber') ? (
                      <div className={styles.monoValue}>
                        {renderMaskedCell(commonFieldConfig, 'icNumber', lead.icNumber)}
                      </div>
                    ) : null,
                },
                {
                  key: 'phone',
                  label: 'Contact',
                  priority: 'high',
                  header: (
                    <ColumnFilter
                      key="phone"
                      label="Contact"
                      title="Filter Phone"
                      value={columnValue('phone')}
                      onChange={(v) => setColumnFilter('phone', v)}
                      options={[]}
                      allLabel={undefined}
                      freeText
                      filterType="numeric"
                      searchPlaceholder="Type a phone number…"
                      suggestFrom={phonePool}
                      emptyHint="No matching phone number on this page."
                    />
                  ),
                  render: (lead) =>
                    isFieldVisible(commonFieldConfig, 'phoneNumber') ? (
                      <div className={styles.strongValue}>{formatPhone(lead.phone)}</div>
                    ) : null,
                },
                {
                  key: 'product',
                  label: 'Product',
                  priority: 'low',
                  header: (
                    <ColumnFilter
                      key="product"
                      label="Product"
                      value={columnValue('product')}
                      onChange={(v) => setColumnFilter('product', v)}
                      options={toOptions(productFilterOptions)}
                      allLabel="All Products"
                      searchable
                    />
                  ),
                  render: (lead) => <div className={styles.productValue}>{lead.product}</div>,
                },
                {
                  key: 'branch',
                  label: 'Branch',
                  priority: 'low',
                  header: (
                    <ColumnFilter
                      key="branch"
                      label="Branch"
                      value={columnValue('branch')}
                      onChange={(v) => setColumnFilter('branch', v)}
                      options={toOptions(branches)}
                      allLabel="All Branches"
                      searchable
                    />
                  ),
                  render: (lead) =>
                    isFieldVisible(commonFieldConfig, 'branch') ? (
                      <div className={styles.strongValue}>{lead.branch || 'Not Assigned'}</div>
                    ) : null,
                },
                {
                  key: 'createdDate',
                  label: 'Created Date',
                  priority: 'low',
                  header: (
                    <ColumnFilter
                      key="createdFrom"
                      label="Created Date"
                      title="Created On or After"
                      value={columnValue('createdFrom')}
                      onChange={(v) => setColumnFilter('createdFrom', v)}
                      options={[]}
                      allLabel={undefined}
                      freeText
                      filterType="numeric"
                      searchPlaceholder="YYYY-MM-DD"
                      suggestFrom={createdPool}
                      emptyHint="No lead created on a matching date."
                    />
                  ),
                  render: (lead) => <span className={styles.dateCell}>{lead.createdDate}</span>,
                },
                {
                  key: 'actions',
                  label: 'Actions',
                  priority: 'always',
                  align: 'right',
                  render: (lead) => (
                    <div className={styles.actions}>
                      {/* View — text + icon */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetailsDrawer(lead);
                        }}
                        id={`view-lead-${lead.id}`}
                        title="View Lead Details"
                        className={`${styles.rowAction} ${styles.actionView}`}
                      >
                        <Eye size={13} />
                        <span>View</span>
                      </button>

                      {canEditLead() && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditWorkflow(lead);
                          }}
                          id={`edit-lead-${lead.id}`}
                          title="Edit Lead"
                          className={`${styles.rowAction} ${styles.actionEdit}`}
                        >
                          <Edit3 size={14} />
                        </button>
                      )}

                      {canDeleteLead() && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDeleteWorkflow(lead);
                          }}
                          id={`delete-lead-${lead.id}`}
                          title="Delete Lead"
                          className={`${styles.rowAction} ${styles.actionDelete}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </DataTable>
      </div>

      {/* Drawers */}
      <LeadDetailsDrawer />
      <EditReasonDrawer />
      <EditLeadDrawer />
      <DeleteLeadDrawer />
    </div>
  );
};

export default ViewLeadPage;
