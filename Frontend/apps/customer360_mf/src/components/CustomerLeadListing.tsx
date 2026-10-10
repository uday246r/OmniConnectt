import React, { useEffect, useMemo } from 'react';
import { useLeadStore, type LeadFilterCriteria } from '../store/leadStore';
import {
  FolderKanban,
  RefreshCw,
  Eye,
  Layers,
} from '@omniconnect/ui/icons';
import {
  Button,
  ColumnFilter,
  DataTable,
  EMPTY_VALUE,
  EmptyState,
  FilterBar,
  Pagination,
  ResponsiveRows,
  RowsPerPage,
  SearchField,
  type ActiveFilter,
  useDebouncedValue,
} from '@omniconnect/ui';
import { StatusBadge } from '../shared/StatusBadge';
import { formatValue, formatCurrency as formatMoney } from '../shared/formatValue';
import { getFriendlyErrorMessage } from '../utils/errorMessages';
import LeadDetailsDrawer from './LeadDetailsDrawer';
import cc from '../shared/c360Common.module.css';
import styles from '../pages/Customer360.module.css';
import { useShallow } from 'zustand/react/shallow';

interface CustomerLeadListingProps {
  criteria: LeadFilterCriteria;
}

export default function CustomerLeadListing({ criteria }: CustomerLeadListingProps) {
  const {
    leads,
    loading,
    error,
    errorStatus,
    pageNumber,
    pageSize,
    totalCount,
    searchQuery,
    statusFilter,
    setSearchQuery,
    setStatusFilter,
    setPageNumber,
    setPageSize,
    openLeadDrawer,
    loadCustomerLeads,
  } = useLeadStore(
    useShallow((s) => ({
      leads: s.leads,
      loading: s.loading,
      error: s.error,
      errorStatus: s.errorStatus,
      pageNumber: s.pageNumber,
      pageSize: s.pageSize,
      totalCount: s.totalCount,
      searchQuery: s.searchQuery,
      statusFilter: s.statusFilter,
      setSearchQuery: s.setSearchQuery,
      setStatusFilter: s.setStatusFilter,
      setPageNumber: s.setPageNumber,
      setPageSize: s.setPageSize,
      openLeadDrawer: s.openLeadDrawer,
      loadCustomerLeads: s.loadCustomerLeads,
    }))
  );

  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  // Fetch leads when criteria, pagination, or filters change
  useEffect(() => {
    loadCustomerLeads({
      ...criteria,
      search: debouncedSearch || undefined,
    });
  }, [criteria.icNumber, criteria.name, criteria.phone, pageNumber, pageSize, debouncedSearch, statusFilter]);

  const uniqueStatuses = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => {
      if (l.status) set.add(l.status);
    });
    return Array.from(set);
  }, [leads]);

  const uniqueProducts = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => {
      if (l.product) set.add(l.product);
    });
    return Array.from(set);
  }, [leads]);

  const activeFilters = useMemo(() => {
    const list: ActiveFilter[] = [];
    if (statusFilter) {
      list.push({
        key: 'status',
        label: 'Status',
        value: statusFilter,
        onRemove: () => {
          setStatusFilter('');
          setPageNumber(1);
        },
      });
    }
    if (searchQuery) {
      list.push({
        key: 'search',
        label: 'Search',
        value: searchQuery,
        onRemove: () => {
          setSearchQuery('');
          setPageNumber(1);
        },
      });
    }
    return list;
  }, [statusFilter, searchQuery, setStatusFilter, setSearchQuery, setPageNumber]);

  return (
    <div className={cc.card}>
      {/* Summary Highlights Strip */}
      <div className={styles.tableSummaryBar}>
        <div className={styles.summaryBadgeGroup}>
          <span className={`${styles.summaryPill} ${styles.summaryPillPrimary}`}>
            <FolderKanban size={13} />
            {totalCount} {totalCount === 1 ? 'Lead Record' : 'Lead Records'}
          </span>
          {uniqueProducts.length > 0 && (
            <span className={styles.summaryPill}>
              <Layers size={13} />
              {uniqueProducts.length} {uniqueProducts.length === 1 ? 'Product' : 'Products'}
            </span>
          )}
        </div>
      </div>

      {/* Controls Toolbar */}
      <div className={cc.toolbar}>
        <div className={cc.toolbarSearch}>
          <SearchField
            placeholder="Search leads by ID, product, branch..."
            value={searchQuery}
            onValueChange={(val) => {
              setSearchQuery(val);
              setPageNumber(1);
            }}
          />
        </div>

        <div className={cc.toolbarActions}>
          <RowsPerPage
            storageKey="c360.lead.pageSize"
            value={pageSize}
            onChange={(s) => {
              setPageSize(s);
              setPageNumber(1);
            }}
          />

          <Button
            variant="secondary"
            size="sm"
            onClick={() => loadCustomerLeads(criteria, { fresh: true })}
            disabled={loading}
            leadingIcon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
            title="Refresh lead records"
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Filter Chips Bar */}
      {activeFilters.length > 0 && (
        <FilterBar
          filters={activeFilters}
          onClearAll={() => {
            setStatusFilter('');
            setSearchQuery('');
            setPageNumber(1);
          }}
        />
      )}

      {/* Error State */}
      {error ? (
        <div className="error-container">
          <p>{getFriendlyErrorMessage({ message: error, status: errorStatus ?? undefined })}</p>
          <Button
            onClick={() => loadCustomerLeads(criteria, { fresh: true })}
            className={styles.spacer9}
          >
            Retry
          </Button>
        </div>
      ) : (
        <DataTable
          bare
          minWidth={850}
          footer={
            <Pagination
              page={pageNumber}
              pageSize={pageSize}
              total={totalCount}
              itemLabel="lead"
              onPageChange={setPageNumber}
            />
          }
        >
          <ResponsiveRows
            rows={leads}
            loading={loading}
            loadingRows={pageSize}
            rowKey={(lead, index) => String(lead.id || `lead-${index}`) + `-${index}`}
            empty={
              <EmptyState
                compact
                title={searchQuery || statusFilter ? 'No matching leads' : 'No lead records found'}
                description={
                  searchQuery || statusFilter
                    ? 'No leads match your current search or filter criteria. Try adjusting or clearing filters.'
                    : 'There are no active lead records associated with this customer profile.'
                }
              />
            }
            columns={[
              {
                key: 'id',
                label: 'Lead Ref',
                priority: 'always',
                render: (lead) => (
                  <span className={cc.monoValue}>{formatValue(lead.id)}</span>
                ),
              },
              {
                key: 'name',
                label: 'Customer Name',
                priority: 'always',
                render: (lead) => (
                  <div>
                    <div className={styles.leadCustomerName}>{formatValue(lead.name)}</div>
                    {lead.icNumber && (
                      <div className={styles.leadCustomerIc}>{formatValue(lead.icNumber)}</div>
                    )}
                  </div>
                ),
              },
              {
                key: 'product',
                label: 'Product',
                priority: 'always',
                render: (lead) => (
                  <div>
                    <span className={styles.leadProductName}>{formatValue(lead.product)}</span>
                    {lead.categoryName && (
                      <span className={styles.leadCategoryName}> ({lead.categoryName})</span>
                    )}
                  </div>
                ),
              },
              {
                key: 'branch',
                label: 'Branch / State',
                priority: 'low',
                render: (lead) => {
                  const location = [lead.branch, lead.state].filter(Boolean).join(', ');
                  return <span>{location || EMPTY_VALUE}</span>;
                },
              },
              {
                key: 'status',
                label: 'Status',
                priority: 'always',
                header: (
                  <ColumnFilter
                    label="Status"
                    value={statusFilter}
                    onChange={(v) => {
                      setStatusFilter(v);
                      setPageNumber(1);
                    }}
                    options={uniqueStatuses.map((s) => ({ value: s, label: s }))}
                    allLabel="All Statuses"
                  />
                ),
                render: (lead) => <StatusBadge status={lead.status} />,
              },
              {
                key: 'createdDate',
                label: 'Created Date',
                priority: 'low',
                render: (lead) => <span>{formatValue(lead.createdDate)}</span>,
              },
              {
                key: 'appliedAmount',
                label: 'Applied Amount',
                priority: 'low',
                render: (lead) => (
                  <span className={cc.monoValue}>
                    {lead.appliedAmount ? formatMoney(lead.appliedAmount) : EMPTY_VALUE}
                  </span>
                ),
              },
              {
                key: 'actions',
                label: 'Actions',
                priority: 'always',
                align: 'right',
                render: (lead) => (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => openLeadDrawer(lead)}
                    leadingIcon={<Eye size={13} />}
                    title="View lead details"
                  >
                    View
                  </Button>
                ),
              },
            ]}
          />
        </DataTable>
      )}

      {/* Slide-out details drawer */}
      <LeadDetailsDrawer />
    </div>
  );
}
