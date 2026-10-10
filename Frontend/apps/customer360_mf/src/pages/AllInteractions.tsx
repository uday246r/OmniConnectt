import React, { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useCustomerStore } from '../store/customerStore';
import { useInteractionStore } from '../store/interactionStore';
import { useHostNavigate } from '../navigation/HostNavigation';
import CaseDetailsModal from '../components/CaseDetailsModal';
import { ArrowLeft, Search, Eye, MessageSquare, RefreshCw, X, ChevronLeft, ChevronRight, Clock, AlertTriangle } from '@omniconnect/ui/icons';
import type { IndividualProfile, CorporateProfile } from '../types/api';
import { getFriendlyErrorMessage } from '../utils/errorMessages';
import { Button, ColumnFilter, DataTable, EMPTY_VALUE, FilterBar, PageHeader, Pagination, ResponsiveRows, RowAction, RowsPerPage, SearchField, useDebouncedValue, type ActiveFilter } from '@omniconnect/ui';
import styles from './AllInteractions.module.css';
import cc from '../shared/c360Common.module.css';
import { useShallow } from 'zustand/react/shallow';

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
  const { profile, customerType } = useCustomerStore(useShallow((s) => ({ profile: s.profile, customerType: s.customerType })));
  const navigate = useHostNavigate();
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
  } = useInteractionStore(useShallow((s) => ({ interactions: s.interactions, loading: s.loading, error: s.error, errorStatus: s.errorStatus, pageNumber: s.pageNumber, pageSize: s.pageSize, totalCount: s.totalCount, totalPages: s.totalPages, setPageNumber: s.setPageNumber, setPageSize: s.setPageSize, loadInteractions: s.loadInteractions, openCaseModal: s.openCaseModal })));

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // Client-side, matching the status filter: this table narrows a page the API already returned.
  const [channelFilter, setChannelFilter] = useState('');
  const [officerFilter, setOfficerFilter] = useState('');
  const [caseIdFilter, setCaseIdFilter] = useState('');

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
    navigate('customer-360');
  };

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  // The box stays bound to the raw `searchTerm` so typing never feels laggy; only the filtering
  // below waits for the debounce, so a fast typist doesn't refilter and re-render the whole table
  // once per keystroke.
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 200);

  // Recommends matching interactions as the operator types, rather than only narrowing the table
  // silently.
  const searchSuggestions = (() => {
    const query = debouncedSearchTerm.trim().toLowerCase();
    if (!query) return [];
    return interactions
      .filter(
        (item) =>
          (item.caseId || '').toLowerCase().includes(query) ||
          (item.classification || '').toLowerCase().includes(query) ||
          (item.subRoleName || '').toLowerCase().includes(query) ||
          (item.sourceName || '').toLowerCase().includes(query),
      )
      .slice(0, 8)
      .map((item) => ({
        id: String(item.caseId ?? ''),
        label: (
          <span className={styles.suggestionRow}>
            <span className={styles.suggestionPrimary}>{item.caseId}</span>
            <span className={styles.suggestionSecondary}>{item.classification}</span>
          </span>
        ),
      }));
  })();

  /*
   * Case-number recommendations, from the interactions already loaded — no extra request, and never
   * a case this table could not show. Classification qualifies an otherwise opaque case id.
   */
  const caseIdPool = useMemo(
    () => interactions.map((i) => ({ value: i.caseId ?? '', meta: i.classification || undefined })),
    [interactions],
  );

  // Filter local data based on search term & status.
  const filteredInteractions = interactions.filter((item) => {
    if (caseIdFilter && !(item.caseId || '').toLowerCase().includes(caseIdFilter.toLowerCase())) return false;
    if (channelFilter && !(item.sourceName || '').toLowerCase().includes(channelFilter.toLowerCase())) return false;
    if (officerFilter && !(item.subRoleName || '').toLowerCase().includes(officerFilter.toLowerCase())) return false;
    const matchesSearch =
      (item.caseId || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
      (item.classification || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
      (item.subRoleName || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
      (item.sourceName || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase());
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
          caseIdFilter && { key: 'caseId', label: 'Case #', value: `"${caseIdFilter}"`, onRemove: () => setCaseIdFilter('') },
          channelFilter && { key: 'channel', label: 'Channel', value: channelFilter, onRemove: () => setChannelFilter('') },
          officerFilter && { key: 'officer', label: 'Performed By', value: officerFilter, onRemove: () => setOfficerFilter('') },
          statusFilter && { key: 'status', label: 'Status', value: statusFilter, onRemove: () => setStatusFilter('') },
          searchTerm && { key: 'search', label: 'Search', value: `"${searchTerm}"`, onRemove: () => setSearchTerm('') },
        ].filter(Boolean) as ActiveFilter[]}
        onClearAll={() => {
          setCaseIdFilter('');
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
        {interactionsError ? (
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
        ) : (
          <DataTable footer={<Pagination page={pageNumber} pageSize={pageSize} total={totalCount} itemLabel="case" onPageChange={setPageNumber} />}>
            <ResponsiveRows
              rows={filteredInteractions}
              loading={loading}
              loadingRows={pageSize}
              rowKey={(item, i) => item.caseId || String(i)}
              empty={
                searchTerm || statusFilter || channelFilter || officerFilter || caseIdFilter
                  ? 'No interactions found matching the selected filters. Try adjusting your search query or filters.'
                  : 'No recorded interactions or support tickets for this customer.'
              }
              columns={[
                {
                  key: 'caseId',
                  label: 'Case #',
                  priority: 'always',
                  header: (
                    <ColumnFilter
                      key="caseId"
                      label="Case #"
                      title="Filter Case #"
                      value={caseIdFilter}
                      onChange={setCaseIdFilter}
                      options={[]}
                      allLabel={undefined}
                      freeText
                      searchPlaceholder="Type to filter case #…"
                      suggestFrom={caseIdPool}
                      emptyHint="No matching case."
                    />
                  ),
                  /* caseId is the real case identifier — no fabricated "CAS-100N" placeholder */
                  render: (item) => <span className={cc.monoAccent}>{item.caseId || EMPTY_VALUE}</span>,
                },
                {
                  key: 'subject',
                  clamp: true,
                  label: 'Subject & Details',
                  priority: 'always',
                  /* The schema has no literal "title"/"subject" column — classification is the
                     closest real field for a one-line summary of what the case is about. */
                  render: (item) => (
                    <>
                      <div className={styles.text4}>{item.classification || 'Uncategorized'}</div>
                      <div className={styles.spacer3}>{item.category || item.main || EMPTY_VALUE}</div>
                    </>
                  ),
                },
                {
                  key: 'channel',
                  label: 'Channel / Source',
                  priority: 'low',
                  header: (
                    <ColumnFilter
                      key="channel"
                      label="Channel / Source"
                      title="Filter Channel"
                      value={channelFilter}
                      onChange={setChannelFilter}
                      options={channelOptions}
                      allLabel="All Channels"
                      searchable
                      searchPlaceholder="Type to narrow channels…"
                      emptyHint="No channel here matches that."
                    />
                  ),
                  render: (item) => <span className={styles.panel2}>{item.sourceName || EMPTY_VALUE}</span>,
                },
                {
                  key: 'officer',
                  label: 'Assigned Officer',
                  priority: 'low',
                  header: (
                    <ColumnFilter
                      key="officer"
                      label="Assigned Officer"
                      title="Filter Officer"
                      value={officerFilter}
                      onChange={setOfficerFilter}
                      options={officerOptions}
                      allLabel="Everyone"
                      searchable
                      filterType="alpha"
                      searchPlaceholder="Type a name to narrow…"
                      emptyHint="No officer here matches that."
                    />
                  ),
                  /* No literal "assigned to" column exists — subRoleName (the routing queue/role the
                     case sits in) is the closest real field to "who owns this right now". */
                  render: (item) => <span className={styles.text5}>{item.subRoleName || EMPTY_VALUE}</span>,
                },
                {
                  key: 'created',
                  label: 'Created Date',
                  priority: 'high',
                  render: (item) => <span className={styles.text6}>{item.createdDateParent || EMPTY_VALUE}</span>,
                },
                {
                  key: 'status',
                  label: 'Status',
                  priority: 'always',
                  header: (
                    <ColumnFilter
                      key="status"
                      label="Status"
                      value={statusFilter}
                      onChange={setStatusFilter}
                      options={CASE_STATUS_OPTIONS}
                      allLabel="All Statuses"
                    />
                  ),
                  render: (item) => {
                    const info = getStatusBadge(item.statusParent);
                    return (
                      <span
                        className={cc.statusPill}
                        style={{ '--pill-bg': info.bg, '--pill-text': info.text } as React.CSSProperties}
                      >
                        <span
                          className={cc.statusDot}
                          style={{ '--pill-dot': info.dot } as React.CSSProperties}
                        />
                        {info.label}
                      </span>
                    );
                  },
                },
                {
                  key: 'actions',
                  label: 'Actions',
                  priority: 'always',
                  align: 'right',
                  render: (item) => <RowAction onClick={() => openCaseModal(item)} />,
                },
              ]}
            />
          </DataTable>
        )}
      </div>

      <CaseDetailsModal />
    </div>
  );
}
