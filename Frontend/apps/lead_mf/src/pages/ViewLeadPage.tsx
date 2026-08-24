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
import { useLeadStore } from '../store/useLeadStore';
import { LeadDetailsDrawer } from '../components/lead/LeadDetailsDrawer';
import { EditReasonDrawer } from '../components/lead/EditReasonDrawer';
import { EditLeadDrawer } from '../components/lead/EditLeadDrawer';
import { DeleteLeadDrawer } from '../components/lead/DeleteLeadDrawer';
import { LeadFilterPopover } from '../components/lead/LeadFilterPopover';
import { canEditLead, canDeleteLead, canCreateLead } from '../api/hostBridge';
import { isFieldVisible } from '../config/fieldControlRegistry';
import { applyMaskingRule, formatFieldValue } from '../utils/fieldMasking';

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
    filterRules,
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
  const startIndex = totalRecords > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const endIndex = Math.min(currentPage * pageSize, totalRecords);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        maxWidth: '1340px',
        width: '100%',
        paddingBottom: '32px',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        boxSizing: 'border-box',
      }}
    >
      {/* Hero Banner — Host Pattern */}
      <div
        style={{
          borderRadius: '18px',
          padding: '24px 30px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '20px',
          flexWrap: 'wrap',
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(120deg, #1e40af 0%, #2563eb 45%, #3b82f6 100%)',
          boxShadow: '0 4px 20px rgba(37, 99, 235, 0.25), 0 1px 4px rgba(37, 99, 235, 0.15)',
          boxSizing: 'border-box',
        }}
      >
        {/* Background decorative glass circles — matching host's exact sizes/offsets/opacity */}
        <div
          style={{
            position: 'absolute',
            top: '-50px',
            right: '-50px',
            width: '220px',
            height: '220px',
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.07)',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-60px',
            right: '120px',
            width: '160px',
            height: '160px',
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.05)',
            pointerEvents: 'none',
          }}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '18px',
            minWidth: 0,
            position: 'relative',
            zIndex: 1,
          }}
        >
          <div
            style={{
              width: '50px',
              height: '50px',
              borderRadius: '14px',
              background: 'rgba(255, 255, 255, 0.18)',
              border: '1.5px solid rgba(255, 255, 255, 0.3)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
            }}
          >
            <FolderKanban size={24} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1
                style={{
                  fontSize: '20px',
                  fontWeight: 800,
                  color: '#ffffff',
                  margin: 0,
                  letterSpacing: '-0.025em',
                  lineHeight: 1.2,
                  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                }}
              >
                Lead Directory
              </h1>
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: '999px',
                  background: 'rgba(255, 255, 255, 0.2)',
                  color: '#ffffff',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                {totalRecords} Total Records
              </span>
            </div>
            <p
              style={{
                fontSize: '13px',
                color: 'rgba(255, 255, 255, 0.85)',
                margin: 0,
              }}
            >
              Browse, filter, inspect and manage customer financing applications across all branches
            </p>
          </div>
        </div>

        {/* Right side: Quick Action Button */}
        {canCreateLead() && (
          <button
            type="button"
            onClick={() => setActivePage('create-lead')}
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
              position: 'relative',
              zIndex: 1,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#ffffff';
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.18)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.95)';
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.12)';
            }}
          >
            <UserPlus size={15} />
            <span>Create Lead</span>
          </button>
        )}
      </div>

      {/* Main Table Container Card */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eaecf0',
          boxShadow: '0 1px 4px rgba(15, 23, 42, 0.04)',
          /* overflow must NOT be hidden here — that would clip the inner overflowX:auto scroll container */
          overflow: 'visible',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Table Controls Toolbar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 20px',
            borderBottom: '1px solid #eaecf0',
            background: '#ffffff',
          }}
        >
          {/* Left Controls: Search Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, maxWidth: '420px' }}>
            <form onSubmit={handleSearchSubmit} style={{ position: 'relative', width: '100%' }}>
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
                placeholder="Search name, IC, phone, branch..."
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                className="form-input"
                style={{
                  height: '40px',
                  paddingLeft: '38px',
                  paddingRight: localSearch ? '34px' : '14px',
                  fontSize: '13px',
                }}
              />
              {localSearch && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '2px',
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </form>
          </div>

          {/* Right Controls: Filter + Refresh */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* Filter Popover Button */}
            <div style={{ position: 'relative' }} ref={filterAnchorRef}>
              <button
                type="button"
                onClick={() => setShowFilters(!showFilters)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                  height: '40px',
                  padding: '0 16px',
                  borderRadius: '12px',
                  border: activeFilterCount > 0 ? '1.5px solid #2563eb' : '1.5px solid #e2e8f0',
                  background: showFilters || activeFilterCount > 0 ? '#eff6ff' : '#ffffff',
                  color: showFilters || activeFilterCount > 0 ? '#1d4ed8' : '#334155',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  fontFamily: 'inherit',
                  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
                }}
              >
                <Filter size={14} />
                <span>{activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filter'}</span>
              </button>

              <LeadFilterPopover isOpen={showFilters} onClose={() => setShowFilters(false)} anchorRef={filterAnchorRef} />
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={() => fetchLeads()}
              title="Reload Lead Data"
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
                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f8fafc';
                e.currentTarget.style.borderColor = '#c8d4e0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#ffffff';
                e.currentTarget.style.borderColor = '#e2e8f0';
              }}
            >
              <RefreshCw size={15} className={isLoadingLeads ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Table Content */}
        {isLoadingLeads ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: '#94a3b8', fontSize: '13.5px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <RefreshCw size={18} className="animate-spin" style={{ color: '#2563eb' }} />
              <span>Loading lead records from database...</span>
            </div>
          </div>
        ) : leads.length === 0 ? (
          <div style={{ padding: '64px 20px', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📂</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
              No leads found
            </div>
            <div style={{ fontSize: '13px', color: '#64748b' }}>
              {activeFilterCount > 0 || localSearch
                ? 'Try adjusting your search query or filter criteria.'
                : 'Get started by creating your first lead application.'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', minWidth: '780px', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)', borderBottom: '1px solid #eaecf0' }}>
                  <th style={{ padding: '13px 18px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#475569', whiteSpace: 'nowrap' }}>
                    Customer Details
                  </th>
                  <th style={{ padding: '13px 18px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#475569', whiteSpace: 'nowrap' }}>
                    IC Number
                  </th>
                  <th style={{ padding: '13px 18px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#475569', whiteSpace: 'nowrap' }}>
                    Contact
                  </th>
                  <th style={{ padding: '13px 18px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#475569', whiteSpace: 'nowrap' }}>
                    Product
                  </th>
                  <th style={{ padding: '13px 18px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#475569', whiteSpace: 'nowrap' }}>
                    Branch
                  </th>
                  <th style={{ padding: '13px 18px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#475569', whiteSpace: 'nowrap' }}>
                    Created Date
                  </th>
                  <th style={{ padding: '13px 18px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#475569', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, idx) => {
                  const initials = getInitials(lead.name);
                  const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length];

                  return (
                    <tr
                      key={lead.id}
                      id={`lead-row-${lead.id}`}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        transition: 'background 0.12s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#f8fafc';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      {/* Customer — avatar + name only, no ID badge */}
                      <td style={{ padding: '13px 18px', verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
                          <div
                            style={{
                              width: '34px',
                              height: '34px',
                              borderRadius: '50%',
                              background: avatarColor.bg,
                              color: avatarColor.text,
                              fontSize: '11.5px',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              border: `1px solid ${avatarColor.border}`,
                            }}
                          >
                            {initials}
                          </div>
                          {/* Only the customer name — ID removed per user request */}
                          <span style={{ fontWeight: 600, color: '#0f172a' }}>{lead.name}</span>
                        </div>
                      </td>

                      {/* IC Number — masked per Field Settings when the field is marked Sensitive */}
                      <td style={{ padding: '13px 18px', verticalAlign: 'middle' }}>
                        {isFieldVisible(commonFieldConfig, 'icNumber') && (
                          <div style={{ color: '#0f172a', fontWeight: 500, fontSize: '13px', fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
                            {renderMaskedCell(commonFieldConfig, 'icNumber', lead.icNumber)}
                          </div>
                        )}
                      </td>

                      {/* Contact */}
                      <td style={{ padding: '13px 18px', verticalAlign: 'middle' }}>
                        {isFieldVisible(commonFieldConfig, 'phoneNumber') && (
                          <div style={{ color: '#0f172a', fontWeight: 500 }}>{lead.phone}</div>
                        )}
                      </td>

                      {/* Product */}
                      <td style={{ padding: '13px 18px', verticalAlign: 'middle' }}>
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>{lead.product}</div>
                      </td>

                      {/* Branch */}
                      <td style={{ padding: '13px 18px', verticalAlign: 'middle' }}>
                        {isFieldVisible(commonFieldConfig, 'branch') && (
                          <div style={{ color: '#0f172a', fontWeight: 500 }}>{lead.branch || 'Not Assigned'}</div>
                        )}
                      </td>

                      {/* Created Date */}
                      <td style={{ padding: '13px 18px', verticalAlign: 'middle', color: '#64748b', fontSize: '12.5px', whiteSpace: 'nowrap' }}>
                        {lead.createdDate}
                      </td>

                      {/* Action Buttons */}
                      <td style={{ padding: '13px 18px', textAlign: 'right', verticalAlign: 'middle' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                          {/* View — text + icon */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openDetailsDrawer(lead);
                            }}
                            id={`view-lead-${lead.id}`}
                            title="View Lead Details"
                            style={{
                              padding: '5px 11px',
                              borderRadius: '8px',
                              background: '#eff6ff',
                              border: '1px solid #bfdbfe',
                              color: '#1d4ed8',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              fontSize: '12px',
                              fontWeight: 600,
                              transition: 'all 0.12s ease',
                              fontFamily: 'inherit',
                              whiteSpace: 'nowrap',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = '#dbeafe'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = '#eff6ff'; }}
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
                              style={{
                                width: '30px',
                                height: '30px',
                                borderRadius: '8px',
                                background: '#fefce8',
                                border: '1px solid #fef08a',
                                color: '#a16207',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                transition: 'all 0.12s ease',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = '#fef9c3'; e.currentTarget.style.borderColor = '#fde047'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = '#fefce8'; e.currentTarget.style.borderColor = '#fef08a'; }}
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
                              style={{
                                width: '30px',
                                height: '30px',
                                borderRadius: '8px',
                                background: '#fff1f2',
                                border: '1px solid #fecdd3',
                                color: '#be185d',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                transition: 'all 0.12s ease',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = '#ffe4e6'; e.currentTarget.style.borderColor = '#fda4af'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = '#fff1f2'; e.currentTarget.style.borderColor = '#fecdd3'; }}
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
            </table>
          </div>
        )}

        {/* Footer Pagination Toolbar */}
        {totalRecords > 0 && (
          <div
            style={{
              padding: '14px 20px',
              borderTop: '1px solid #eaecf0',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              background: '#f8fafc',
              fontSize: '13px',
              color: '#64748b',
            }}
          >
            <div>
              Showing <strong style={{ color: '#0f172a' }}>{startIndex}</strong> to{' '}
              <strong style={{ color: '#0f172a' }}>{endIndex}</strong> of{' '}
              <strong style={{ color: '#0f172a' }}>{totalRecords}</strong> records
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {/* Records Per Page */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '8px',
                    border: '1.5px solid #e2e8f0',
                    background: '#ffffff',
                    fontSize: '12.5px',
                    color: '#0f172a',
                    cursor: 'pointer',
                    outline: 'none',
                    fontWeight: 500,
                  }}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>

              {/* Prev / Next Page Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
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
                    cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
                    opacity: currentPage <= 1 ? 0.4 : 1,
                    transition: 'all 0.12s ease',
                  }}
                >
                  <ChevronLeft size={14} />
                </button>
                <span style={{ fontWeight: 600, color: '#0f172a', padding: '0 4px' }}>
                  {currentPage} / {totalPages || 1}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(currentPage + 1)}
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
                    cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
                    opacity: currentPage >= totalPages ? 0.4 : 1,
                    transition: 'all 0.12s ease',
                  }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
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
