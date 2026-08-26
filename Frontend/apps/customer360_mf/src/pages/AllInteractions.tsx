import React, { useEffect, useState, type ChangeEvent } from 'react';
import { useCustomerStore } from '../store/customerStore';
import { useInteractionStore } from '../store/interactionStore';
import { useNavigationStore } from '../store/navigationStore';
import CaseDetailsModal from '../components/CaseDetailsModal';
import { ArrowLeft, Search, Eye, MessageSquare, RefreshCw, X, ChevronLeft, ChevronRight, Clock, AlertTriangle } from 'lucide-react';
import type { IndividualProfile, CorporateProfile } from '../types/api';
import { getFriendlyErrorMessage } from '../utils/errorMessages';
import { C360CardListSkeleton } from '../components/common/PageSkeletons';

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
    const matchesSearch =
      (item.caseId || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.classification || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.subRoleName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.sourceName || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === '' || (item.statusParent || '').toLowerCase() === statusFilter.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Hero Banner — Host Pattern */}
      <div className="c360-hero-banner">
        <div style={{ position: 'absolute', top: '-40px', right: '-40px', width: '180px', height: '180px', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.08)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '-50px', right: '120px', width: '130px', height: '130px', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.05)', pointerEvents: 'none' }} />

        <div className="c360-hero-left">
          <div
            style={{
              width: '50px',
              height: '50px',
              borderRadius: '14px',
              background: 'rgba(255, 255, 255, 0.18)',
              border: '1.5px solid rgba(255, 255, 255, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              flexShrink: 0,
            }}
          >
            <MessageSquare size={24} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 className="c360-hero-title">Customer Interactions & Cases</h1>
              <span className="c360-hero-pill">
                {totalCount || filteredInteractions.length} Total Cases
              </span>
            </div>
            <p className="c360-hero-subtitle">
              Complete service history, customer tickets, inquiries, and complaints for {customerName}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '7px',
            height: '40px',
            padding: '0 18px',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.35)',
            background: 'rgba(255, 255, 255, 0.95)',
            color: '#1d4ed8',
            fontSize: '13.5px',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.12)',
            transition: 'all 0.15s ease',
            fontFamily: 'inherit',
            flexShrink: 0,
            position: 'relative',
            zIndex: 1,
          }}
        >
          <ArrowLeft size={15} />
          <span>Back to Profile</span>
        </button>
      </div>

      {/* Main Table Card */}
      <div className="c360-table-container">
        {/* Controls Toolbar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 20px',
            borderBottom: '1px solid #eaecf0',
            background: '#ffffff',
            flexWrap: 'wrap',
          }}
        >
          {/* Search Input */}
          <div style={{ position: 'relative', width: '100%', maxWidth: '380px' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: '14px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#94a3b8',
                pointerEvents: 'none',
              }}
            />
            <input
              type="text"
              placeholder="Search case #, subject, assignee..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="c360-input"
              style={{ height: '40px', paddingLeft: '38px', paddingRight: searchTerm ? '32px' : '14px', fontSize: '13px' }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '2px',
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Status Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="c360-input"
              style={{ width: '160px', height: '40px', cursor: 'pointer', appearance: 'auto', fontSize: '13px' }}
            >
              <option value="">All Statuses</option>
              <option value="New">New</option>
              <option value="In Progress">In Progress</option>
              <option value="Resolved">Resolved</option>
              <option value="Closed">Closed</option>
            </select>

            <button
              type="button"
              onClick={() => customerId && loadInteractions(customerId)}
              title="Refresh Cases"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                border: '1.5px solid #e2e8f0',
                background: '#ffffff',
                color: '#475569',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Table Content */}
        {loading ? (
          <C360CardListSkeleton />
        ) : interactionsError ? (
          // A genuine fetch failure used to fall straight into the "no logs found" empty state below
          // — indistinguishable from a customer who simply has no interaction history.
          <div className="error-container" style={{ margin: '20px' }}>
            <AlertTriangle size={20} style={{ color: '#dc2626', marginBottom: 8 }} />
            <h3>Unable to Load Interactions</h3>
            <p>{getFriendlyErrorMessage({ message: interactionsError, status: interactionsErrorStatus ?? undefined })}</p>
            <button className="c360-btn-primary" onClick={() => customerId && loadInteractions(customerId)} style={{ marginTop: 12 }}>
              Retry
            </button>
          </div>
        ) : filteredInteractions.length === 0 ? (
          <div style={{ padding: '64px 20px', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>💬</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
              No interaction logs found
            </div>
            <div style={{ fontSize: '13px', color: '#64748b' }}>
              {searchTerm || statusFilter
                ? 'Try adjusting your search query or status filter.'
                : 'No recorded interactions or support tickets for this customer.'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="c360-table">
              <thead>
                <tr>
                  <th>Case #</th>
                  <th>Subject & Details</th>
                  <th>Channel / Source</th>
                  <th>Assigned Officer</th>
                  <th>Created Date</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInteractions.map((item, idx) => {
                  const statusInfo = getStatusBadge(item.statusParent);

                  return (
                    <tr key={item.caseId || idx}>
                      <td style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", fontWeight: 600, color: '#2563eb' }}>
                        {/* caseId is the real case identifier — no fabricated "CAS-100N" placeholder */}
                        {item.caseId || '-'}
                      </td>
                      <td>
                        {/* The schema has no literal "title"/"subject" column — classification is the
                            closest real field for a one-line summary of what the case is about. */}
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>{item.classification || 'Uncategorized'}</div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{item.category || item.main || '-'}</div>
                      </td>
                      <td>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '6px',
                            background: '#f1f5f9',
                            color: '#475569',
                            fontSize: '11.5px',
                            fontWeight: 600,
                          }}
                        >
                          {item.sourceName || '-'}
                        </span>
                      </td>
                      {/* No literal "assigned to" column exists — subRoleName (the routing queue/role
                          the case sits in) is the closest real field to "who owns this right now". */}
                      <td style={{ color: '#0f172a', fontWeight: 500 }}>{item.subRoleName || '-'}</td>
                      <td style={{ color: '#64748b', fontSize: '12.5px' }}>{item.createdDateParent || '-'}</td>
                      <td>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '3px 10px',
                            borderRadius: '999px',
                            background: statusInfo.bg,
                            color: statusInfo.text,
                            fontSize: '11.5px',
                            fontWeight: 600,
                            border: `1px solid ${statusInfo.border}`,
                          }}
                        >
                          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: statusInfo.dot }} />
                          {statusInfo.label}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => openCaseModal(item)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '5px 11px',
                            borderRadius: '8px',
                            border: '1px solid #bfdbfe',
                            background: '#eff6ff',
                            color: '#1d4ed8',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            transition: 'all 0.12s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#dbeafe';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#eff6ff';
                          }}
                        >
                          <Eye size={13} />
                          <span>Inspect</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Toolbar */}
        {totalCount > 0 && (
          <div
            style={{
              padding: '14px 20px',
              borderTop: '1px solid #eaecf0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f8fafc',
              fontSize: '13px',
              color: '#64748b',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div>
              Showing <strong style={{ color: '#0f172a' }}>{filteredInteractions.length}</strong> of{' '}
              <strong style={{ color: '#0f172a' }}>{totalCount}</strong> records
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontSize: '12.5px',
                    color: '#0f172a',
                    cursor: 'pointer',
                  }}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  disabled={pageNumber <= 1}
                  onClick={() => setPageNumber(pageNumber - 1)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    border: '1.5px solid #e2e8f0',
                    background: '#ffffff',
                    color: '#0f172a',
                    cursor: pageNumber <= 1 ? 'not-allowed' : 'pointer',
                    opacity: pageNumber <= 1 ? 0.4 : 1,
                  }}
                >
                  <ChevronLeft size={14} />
                </button>
                <span style={{ fontWeight: 600, color: '#0f172a', padding: '0 4px' }}>
                  {pageNumber} / {totalPages || 1}
                </span>
                <button
                  type="button"
                  disabled={pageNumber >= totalPages}
                  onClick={() => setPageNumber(pageNumber + 1)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    border: '1.5px solid #e2e8f0',
                    background: '#ffffff',
                    color: '#0f172a',
                    cursor: pageNumber >= totalPages ? 'not-allowed' : 'pointer',
                    opacity: pageNumber >= totalPages ? 0.4 : 1,
                  }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <CaseDetailsModal />
    </div>
  );
}
