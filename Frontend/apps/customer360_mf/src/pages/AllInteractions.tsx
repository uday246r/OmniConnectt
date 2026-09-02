import React, { useEffect, useState, type ChangeEvent } from 'react';
import { useCustomerStore } from '../store/customerStore';
import { useInteractionStore } from '../store/interactionStore';
import { useNavigationStore } from '../store/navigationStore';
import CaseDetailsModal from '../components/CaseDetailsModal';
import { ArrowLeft, Search, Eye, MessageSquare, RefreshCw, X, ChevronLeft, ChevronRight, Clock, AlertTriangle } from 'lucide-react';
import type { IndividualProfile, CorporateProfile } from '../types/api';
import { getFriendlyErrorMessage } from '../utils/errorMessages';
import { Button, ColumnFilter, DataTable, FilterBar, PageHeader, Pagination, RowAction, RowsPerPage, SearchField, type ActiveFilter } from '@omniremit/ui';
import styles from './AllInteractions.module.css';
import cc from '../shared/c360Common.module.css';

const getStatusBadge = (status?: string | null) => {
  const s = status?.toLowerCase() || 'new';
  if (s.includes('resolve') || s.includes('complete') || s.includes('close')) {
    return { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0', dot: '#10b981', label: status || 'Resolved' };
  }
  if (s.includes('progress') || s.includes('pending') || s.includes('investigat')) {
    return { bg: '#fffbeb', text: '#b45309', border: '#fde68a', dot: '#f59e0b', label: status || 'In Progress' };
  }
  if (s.includes('escalat') || s.includes('reject') || s.includes('urgent')) {
    return { bg: '#fff1f2', text: '#be123c', border: '#fecdd3', dot: '#f43f5e', label: status || 'Escalated' };
  }
  return { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe', dot: '#2563eb', label: status || 'New' };
};

/* Case-status vocabulary, moved out of the toolbar <select> into the column header, as every
   other table in the platform does. */
const CASE_STATUS_OPTIONS = [
  { value: 'New', label: 'New' },
  { value: 'In Progress', label: 'In Progress' },
  { value: 'Resolved', label: 'Resolved' },
  { value: 'Closed', label: 'Closed' },
];

export default function AllInteractions() {
  const { profile, customerType } = useCustomerStore();
  const { setActivePage } = useNavigationStore();
  const {
    interactions,
    loading,
    error: interactionsError,
    errorStatus: interactionsErrorStatus,
    pageNumber,
    pageSize,
    totalCount,
    totalPages,
    setPageNumber,
    setPageSize,
    loadInteractions,
    openCaseModal,
  } = useInteractionStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // Client-side, matching the status filter: this table narrows a page the API already returned.
  const [channelFilter, setChannelFilter] = useState('');
  const [officerFilter, setOfficerFilter] = useState('');

  /* Channel and Officer offer the values present in the loaded cases rather than an empty box. */
  const distinctOf = (pick: (i: typeof interactions[number]) => string | null | undefined) => {
    const seen = new Map<string, string>();
    for (const item of interactions) {
      const v = (pick(item) ?? '').trim();
      if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
  };
  const channelOptions = React.useMemo(() => distinctOf((i) => i.sourceName), [interactions]);
  const officerOptions = React.useMemo(() => distinctOf((i) => i.subRoleName), [interactions]);

  const customerName =
    customerType === 'individual'
      ? (profile as IndividualProfile)?.fullName || 'Individual Customer'
      : (profile as CorporateProfile)?.organizationName || 'Corporate Customer';

  const customerId =
    customerType === 'individual'
      // IndividualProfile has no `nric` field (the real one is `nationalId`) — that fallback could
      // never fire.
      ? (profile as IndividualProfile)?.nationalId || ''
      : (profile as CorporateProfile)?.brn || '';

  useEffect(() => {
    if (customerId) {
      loadInteractions(customerId);
    }
  }, [customerId, pageNumber, pageSize, loadInteractions]);

  const handleBack = () => {
    setActivePage('customer-360');
  };

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  // Filter local data based on search term & status.
  //
  // These field names previously didn't exist on Interaction at all (caseNumber, title, assignedTo,
  // source, status) — every one of them was `undefined` at runtime, every time, for every real
  // interaction. That didn't crash (JS doesn't throw on reading a missing optional property), it
  // silently filtered against empty strings and, worse, the table below rendered its hardcoded
  // fallback text ("Customer Inquiry", "Unassigned", "Branch Walk-in", a fabricated "CAS-100N" case
  // number) as if it were real CRM data for every single case. Mapped to the fields the backend
  // (Backend/Customer360Service/Models/Models.cs: Interaction) actually returns; see the table render
  // below for which mappings are exact vs. best-effort against a schema with no literal "title" or
  // "assigned to" column.
  const filteredInteractions = interactions.filter((item) => {
    if (channelFilter && !(item.sourceName || '').toLowerCase().includes(channelFilter.toLowerCase())) return false;
    if (officerFilter && !(item.subRoleName || '').toLowerCase().includes(officerFilter.toLowerCase())) return false;
    const matchesSearch =
      (item.caseId || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.classification || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.subRoleName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.sourceName || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === '' || (item.statusParent || '').toLowerCase() === statusFilter.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  return (
    <div className={styles.stack}>
      {/* Hero Banner — Host Pattern */}
      <PageHeader
        icon={<MessageSquare size={24} />}
        title="Customer Interactions & Cases"
        pill={`${totalCount || filteredInteractions.length} Total Cases`}
        subtitle={`Complete service history, customer tickets, inquiries, and complaints for ${customerName}`}
        actions={
          <Button variant="onHeader" onClick={handleBack} leadingIcon={<ArrowLeft size={15} />}>
            Back to Profile
          </Button>
        }
      />

      <FilterBar
        filters={[
          channelFilter && { key: 'channel', label: 'Channel', value: channelFilter, onRemove: () => setChannelFilter('') },
          officerFilter && { key: 'officer', label: 'Performed By', value: officerFilter, onRemove: () => setOfficerFilter('') },
          statusFilter && { key: 'status', label: 'Status', value: statusFilter, onRemove: () => setStatusFilter('') },
          searchTerm && { key: 'search', label: 'Search', value: `"${searchTerm}"`, onRemove: () => setSearchTerm('') },
        ].filter(Boolean) as ActiveFilter[]}
        onClearAll={() => {
          setChannelFilter('');
          setOfficerFilter('');
          setStatusFilter('');
          setSearchTerm('');
        }}
      />

      {/* Main Table Card */}
      <div className="c360-table-container">
        {/* Controls Toolbar */}
        <div className={cc.toolbar}
        >
          {/* Search Input */}
          <div className={cc.toolbarSearch}>
            <SearchField
              placeholder="Search case #, subject, assignee..."
              value={searchTerm}
              onValueChange={setSearchTerm}
            />
          </div>

          {/* Status Filter */}
          <div className={styles.row2}>
            <RowsPerPage storageKey="c360.interactions" value={pageSize} onChange={(n) => { setPageSize(n); setPageNumber(1); }} />

            <button
              type="button"
              onClick={() => customerId && loadInteractions(customerId)}
              title="Refresh Cases"
              className={styles.row3}
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Table Content */}
        {loading ? (
          <div className={styles.muted}>
            <div className={styles.row4}>
              <RefreshCw size={18} className={`animate-spin ${styles.text}`} />
              <span>Loading interaction and case logs...</span>
            </div>
          </div>
        ) : interactionsError ? (
          // A genuine fetch failure used to fall straight into the "no logs found" empty state below
          // — indistinguishable from a customer who simply has no interaction history.
          <div className={`error-container ${styles.rule}`}>
            <AlertTriangle size={20} className={styles.spacer} />
            <h3>Unable to Load Interactions</h3>
            <p>{getFriendlyErrorMessage({ message: interactionsError, status: interactionsErrorStatus ?? undefined })}</p>
            <Button className={styles.spacer2} onClick={() => customerId && loadInteractions(customerId)}>
              Retry
              </Button>
          </div>
        ) : filteredInteractions.length === 0 ? (
          <div className={styles.text2}>
            <div className={styles.heading}>💬</div>
            <div className={styles.strong}>
              No interaction logs found
            </div>
            <div className={styles.text3}>
              {searchTerm || statusFilter
                ? 'Try adjusting your search query or status filter.'
                : 'No recorded interactions or support tickets for this customer.'}
            </div>
          </div>
        ) : (
          <DataTable>
              <thead>
                <tr>
                  <th>Case #</th>
                  <th>Subject & Details</th>
                  <ColumnFilter
                    label="Channel / Source"
                    title="Filter Channel"
                    value={channelFilter}
                    onChange={setChannelFilter}
                    options={channelOptions}
                    allLabel="All Channels"
                    searchable={channelOptions.length > 6}
                    searchPlaceholder="Type to narrow channels…"
                    emptyHint="No channel here matches that."
                  />
                  <ColumnFilter
                    label="Assigned Officer"
                    title="Filter Officer"
                    value={officerFilter}
                    onChange={setOfficerFilter}
                    options={officerOptions}
                    allLabel="Everyone"
                    searchable={officerOptions.length > 6}
                    searchPlaceholder="Type a name to narrow…"
                    emptyHint="No officer here matches that."
                  />
                  <th>Created Date</th>
                  <ColumnFilter
                    label="Status"
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={CASE_STATUS_OPTIONS}
                    allLabel="All Statuses"
                  />
                  <th className={styles.rule2}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInteractions.map((item, idx) => {
                  const statusInfo = getStatusBadge(item.statusParent);

                  return (
                    <tr key={item.caseId || idx}>
                      <td className={cc.monoAccent}>
                        {/* caseId is the real case identifier — no fabricated "CAS-100N" placeholder */}
                        {item.caseId || '-'}
                      </td>
                      <td>
                        {/* The schema has no literal "title"/"subject" column — classification is the
                            closest real field for a one-line summary of what the case is about. */}
                        <div className={styles.text4}>{item.classification || 'Uncategorized'}</div>
                        <div className={styles.spacer3}>{item.category || item.main || '-'}</div>
                      </td>
                      <td>
                        <span
                          className={styles.panel2}
                        >
                          {item.sourceName || '-'}
                        </span>
                      </td>
                      {/* No literal "assigned to" column exists — subRoleName (the routing queue/role
                          the case sits in) is the closest real field to "who owns this right now". */}
                      <td className={styles.text5}>{item.subRoleName || '-'}</td>
                      <td className={styles.text6}>{item.createdDateParent || '-'}</td>
                      <td>
                        <span
                          className={cc.statusPill} style={{ '--pill-bg': statusInfo.bg, '--pill-text': statusInfo.text } as React.CSSProperties}
                        >
                          <span className={cc.statusDot} style={{ '--pill-dot': statusInfo.dot } as React.CSSProperties} />
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className={styles.rule2}>
                        <RowAction onClick={() => openCaseModal(item)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
        )}

        {/* Pagination Toolbar */}
        {totalCount > 0 && (
          <Pagination
            page={pageNumber}
            pageSize={pageSize}
            total={totalCount}
            itemLabel="case"
            onPageChange={setPageNumber}
          />
        )}
      </div>

      <CaseDetailsModal />
    </div>
  );
}
