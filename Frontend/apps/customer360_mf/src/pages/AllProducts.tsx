import React, { useEffect, useState, type ChangeEvent } from 'react';
import { useCustomerStore } from '../store/customerStore';
import { useProductStore } from '../store/productStore';
import { useNavigationStore } from '../store/navigationStore';
import ProductDetailsModal from '../components/ProductDetailsModal';
import { ArrowLeft, Search, Eye, Layers, RefreshCw, X, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import type { CorporateProfile, IndividualProfile } from '../types/api';
import { getFriendlyErrorMessage } from '../utils/errorMessages';
import { C360CardListSkeleton } from '../components/common/PageSkeletons';

export default function AllProducts() {
  const { profile, customerType } = useCustomerStore();
  const { setActivePage } = useNavigationStore();
  const {
    products,
    loading,
    error,
    errorStatus,
    pageNumber,
    pageSize,
    totalCount,
    totalPages,
    setPageNumber,
    setPageSize,
    loadProducts,
    openProductModal,
  } = useProductStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const customerName =
    customerType === 'individual'
      ? (profile as IndividualProfile)?.fullName || 'Individual Customer'
      : (profile as CorporateProfile)?.organizationName || 'Corporate Customer';

  const customerId =
    customerType === 'individual'
      // `nric` isn't a real field on IndividualProfile (the primary identifier is `nationalId`) — this
      // silently fell through to `passport` every time, which is empty for most customers, so
      // customerId was frequently '' and the products-loading effect below never fired for them.
      ? (profile as IndividualProfile)?.nationalId || (profile as IndividualProfile)?.passport || ''
      : (profile as CorporateProfile)?.brn || '';

  useEffect(() => {
    if (customerId) {
      loadProducts(customerId);
    }
  }, [customerId, pageNumber, pageSize, loadProducts]);

  const handleBack = () => {
    setActivePage('customer-360');
  };

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  // Local filtering based on query
  const filteredProducts = products.filter((item) => {
    const matchesSearch =
      (item.accountNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.productName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.productCategory || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === '' || (item.type || '').toLowerCase() === typeFilter.toLowerCase();
    return matchesSearch && matchesType;
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
            <Layers size={24} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 className="c360-hero-title">Customer Product Portfolio</h1>
              <span className="c360-hero-pill">
                {totalCount || filteredProducts.length} Total Facilities
              </span>
            </div>
            <p className="c360-hero-subtitle">
              Comprehensive breakdown of all held accounts, financing, cards, and investments for {customerName}
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
              placeholder="Search product name, account number..."
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

          {/* Product Type Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="c360-input"
              style={{ width: '160px', height: '40px', cursor: 'pointer', appearance: 'auto', fontSize: '13px' }}
            >
              <option value="">All Categories</option>
              <option value="Deposit">Deposits</option>
              <option value="Loan">Financing / Loans</option>
              <option value="Card">Cards</option>
              <option value="Investment">Investments</option>
              <option value="Gold">Gold Account</option>
            </select>

            <button
              type="button"
              onClick={() => customerId && loadProducts(customerId)}
              title="Refresh Products"
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
        ) : error ? (
          // A genuine fetch failure used to fall straight into the "no products found" empty state
          // below — indistinguishable from a customer who simply has zero product accounts. This
          // gives an operator a real, actionable reason instead of a false "nothing here".
          <div className="error-container" style={{ margin: '20px' }}>
            <AlertTriangle size={20} style={{ color: '#dc2626', marginBottom: 8 }} />
            <h3>Unable to Load Products</h3>
            <p>{getFriendlyErrorMessage({ message: error, status: errorStatus ?? undefined })}</p>
            <button className="c360-btn-primary" onClick={() => customerId && loadProducts(customerId)} style={{ marginTop: 12 }}>
              Retry
            </button>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div style={{ padding: '64px 20px', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>💳</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
              No product accounts found
            </div>
            <div style={{ fontSize: '13px', color: '#64748b' }}>
              {searchTerm || typeFilter
                ? 'Try adjusting your search query or category filter.'
                : 'No active banking products found for this customer record.'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="c360-table">
              <thead>
                <tr>
                  <th>Product Category</th>
                  <th>Product Name</th>
                  <th>Account Number</th>
                  <th>Branch</th>
                  <th>Balance / Limit</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((prod, idx) => (
                  <tr key={prod.accountNumber || idx}>
                    <td>
                      <span
                        style={{
                          padding: '3px 10px',
                          borderRadius: '999px',
                          background: '#eff6ff',
                          color: '#1d4ed8',
                          fontSize: '11.5px',
                          fontWeight: 700,
                          border: '1px solid #bfdbfe',
                        }}
                      >
                        {prod.productCategory || prod.type || 'Banking Product'}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600, color: '#0f172a' }}>{prod.productName}</td>
                    <td style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", color: '#0f172a', fontWeight: 500 }}>
                      {prod.accountNumber}
                    </td>
                    {/* CustomerProduct carries no branch field at all (that's only present on the
                        customer's own profile, a different entity) — always '-', honestly, not a
                        fabricated value. */}
                    <td style={{ color: '#64748b' }}>{'-'}</td>
                    <td style={{ fontWeight: 700, color: '#059669' }}>
                      {prod.balances ? `RM ${Number(prod.balances).toLocaleString()}` : '-'}
                    </td>
                    <td>
                      {/* No single generic status field exists — derivedAccountStatus is the one the
                          backend explicitly provides as a normalized status across product types. The
                          fixed green "Active" fallback previously shown regardless of real status has
                          been removed: it's not just a wrong label, it's specifically the wrong
                          direction to fail in for something this label implies about an account. */}
                      {prod.derivedAccountStatus ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '3px 10px',
                            borderRadius: '999px',
                            background: '#ecfdf5',
                            color: '#047857',
                            fontSize: '11.5px',
                            fontWeight: 600,
                            border: '1px solid #a7f3d0',
                          }}
                        >
                          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#10b981' }} />
                          {prod.derivedAccountStatus}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '11.5px' }}>-</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        // openProductModal(accountNo, type) — was passing the whole product object as
                        // a single argument, matching neither parameter. Every "View Details" click
                        // here called it with the wrong shape entirely; see Customer360.tsx's own
                        // (correct) call sites for the real signature.
                        onClick={() => openProductModal(prod.accountNumber, prod.type as string)}
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
                ))}
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
              Showing <strong style={{ color: '#0f172a' }}>{filteredProducts.length}</strong> of{' '}
              <strong style={{ color: '#0f172a' }}>{totalCount}</strong> products
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

      <ProductDetailsModal />
    </div>
  );
}
