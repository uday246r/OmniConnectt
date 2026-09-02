import React, { useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import { Button, ColumnFilter, DataTable, EmptyState, FilterBar, PageHeader, Pagination, RowsPerPage, SearchField, type ActiveFilter } from '@omniremit/ui';
import { useLeadStore } from '../store/useLeadStore';
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

const getInitials = (name: string): string => {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/).filter((p) => !['bin', 'binti', 'a/l', 'a/p'].includes(p.toLowerCase()));
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

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
    products,
    states,
    branches,
    filterRules,
    setColumnFilter,
    clearAllFilters,
    setPage,
    setPageSize,
    fetchLeads,
    fetchMasterData,
    setActivePage,
    openDetailsDrawer,
    openEditWorkflow,
    openDeleteWorkflow,
    commonFieldConfig,
    fetchCommonFieldConfig,
  } = useLeadStore();

  const [showFilters, setShowFilters] = useState(false);
  const filterAnchorRef = useRef<HTMLDivElement>(null);
  const [localSearch, setLocalSearch] = useState(searchQuery);

  useEffect(() => {
    fetchLeads();
    if (products.length === 0 || states.length === 0) {
      fetchMasterData();
    }
    if (commonFieldConfig.length === 0) {
      void fetchCommonFieldConfig();
    }
  }, [fetchLeads, fetchMasterData, fetchCommonFieldConfig, products.length, states.length, commonFieldConfig.length]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(localSearch);
    fetchLeads();
  };

  const handleClearSearch = () => {
    setLocalSearch('');
    setSearchQuery('');
    fetchLeads();
  };

  const activeFilterCount = filterRules.filter((r) => r.value && r.value.trim().length > 0).length;

  // Per-column filters read and write the same rule list the toolbar's Filter popover edits, so the
  // two stay in sync: setting Product in the header shows up as an active rule in the popover and
  // counts toward "Filters (n)".
  const columnValue = (field: string) => filterRules.find((r) => r.field === field)?.value ?? '';
  const toOptions = (list: { value?: string; label?: string }[]) =>
    list.map((o) => ({ value: String(o.value ?? o.label ?? ''), label: o.label ?? String(o.value ?? '') }));
  const startIndex = totalRecords > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const endIndex = Math.min(currentPage * pageSize, totalRecords);

  return (
    <div className={shell.page}>
      {/* Hero banner — @omniremit/ui PageHeader. This screen previously hand-rolled the banner,
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
              onClick={() => setActivePage('create-lead')}
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
        {isLoadingLeads ? (
          <div className={shell.loadingRow}>
            <div className={shell.loadingInner}>
              <RefreshCw size={18} className={`animate-spin ${shell.loadingSpinner}`} />
              <span>Loading lead records from database...</span>
            </div>
          </div>
        ) : leads.length === 0 ? (
          <EmptyState
            icon={<FolderKanban size={32} />}
            title="No leads found"
            description={
              activeFilterCount > 0 || localSearch
                ? 'Try adjusting your search query or filter criteria.'
                : 'Get started by creating your first lead application.'
            }
          />
        ) : (
          <DataTable bare minWidth={780}>
              <thead>
                <tr>
                  <ColumnFilter
                    label="Customer Details"
                    title="Filter Name"
                    value={columnValue('name')}
                    onChange={(v) => setColumnFilter('name', v)}
                    options={[]}
                    allLabel={undefined}
                    freeText
                    searchPlaceholder="Type a customer name…"
                    emptyHint="Press Enter to filter by name."
                  />
                  <ColumnFilter
                    label="IC Number"
                    title="Filter IC Number"
                    value={columnValue('icNumber')}
                    onChange={(v) => setColumnFilter('icNumber', v)}
                    options={[]}
                    allLabel={undefined}
                    freeText
                    searchPlaceholder="Type an IC number…"
                    emptyHint="Press Enter to filter by IC number."
                  />
                  <ColumnFilter
                    label="Contact"
                    title="Filter Phone"
                    value={columnValue('phone')}
                    onChange={(v) => setColumnFilter('phone', v)}
                    options={[]}
                    allLabel={undefined}
                    freeText
                    searchPlaceholder="Type a phone number…"
                    emptyHint="Press Enter to filter by phone."
                  />
                  <ColumnFilter
                    label="Product"
                    value={columnValue('product')}
                    onChange={(v) => setColumnFilter('product', v)}
                    options={toOptions(products)}
                    allLabel="All Products"
                    searchable={products.length > 10}
                  />
                  <ColumnFilter
                    label="Branch"
                    value={columnValue('branch')}
                    onChange={(v) => setColumnFilter('branch', v)}
                    options={toOptions(branches)}
                    allLabel="All Branches"
                    searchable={branches.length > 10}
                  />
                  <ColumnFilter
                    label="Created Date"
                    title="Created On or After"
                    value={columnValue('createdFrom')}
                    onChange={(v) => setColumnFilter('createdFrom', v)}
                    options={[]}
                    allLabel={undefined}
                    freeText
                    searchPlaceholder="YYYY-MM-DD"
                    emptyHint="Enter a date, then press Enter."
                  />
                  <th className={styles.thRight}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, idx) => {
                  const initials = getInitials(lead.name);
                  const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length];

                  return (
                    <tr key={lead.id} id={`lead-row-${lead.id}`}>
                      {/* Customer — avatar + name only, no ID badge */}
                      <td>
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
                            {initials}
                          </div>
                          {/* Only the customer name — ID removed per user request */}
                          <span className={styles.customerName}>{lead.name}</span>
                        </div>
                      </td>

                      {/* IC Number — masked per Field Settings when the field is marked Sensitive */}
                      <td>
                        {isFieldVisible(commonFieldConfig, 'icNumber') && (
                          <div className={styles.monoValue}>
                            {renderMaskedCell(commonFieldConfig, 'icNumber', lead.icNumber)}
                          </div>
                        )}
                      </td>

                      {/* Contact */}
                      <td>
                        {isFieldVisible(commonFieldConfig, 'phoneNumber') && (
                          <div className={styles.strongValue}>{formatPhone(lead.phone)}</div>
                        )}
                      </td>

                      {/* Product */}
                      <td>
                        <div className={styles.productValue}>{lead.product}</div>
                      </td>

                      {/* Branch */}
                      <td>
                        {isFieldVisible(commonFieldConfig, 'branch') && (
                          <div className={styles.strongValue}>{lead.branch || 'Not Assigned'}</div>
                        )}
                      </td>

                      {/* Created Date */}
                      <td className={styles.dateCell}>
                        {lead.createdDate}
                      </td>

                      {/* Action Buttons */}
                      <td className={styles.actionsCellTd}>
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

                          {/* Edit */}
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

                          {/* Delete */}
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
          </DataTable>
        )}

        <Pagination
          page={currentPage}
          pageSize={pageSize}
          total={totalRecords}
          itemLabel="lead"
          onPageChange={setPage}
        />
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
