import React, { useEffect, useState, type ChangeEvent } from 'react';
import { useCustomerStore } from '../store/customerStore';
import { useProductStore } from '../store/productStore';
import { useNavigationStore } from '../store/navigationStore';
import ProductDetailsModal from '../components/ProductDetailsModal';
import { ArrowLeft, Search, Eye, Layers, RefreshCw, X, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import type { CorporateProfile, IndividualProfile } from '../types/api';
import { getFriendlyErrorMessage } from '../utils/errorMessages';
import { Button, ColumnFilter, DataTable, FilterBar, PageHeader, Pagination, RowAction, RowsPerPage, SearchField, type ActiveFilter } from '@omniremit/ui';
import styles from './AllProducts.module.css';
import cc from '../shared/c360Common.module.css';

/* The category vocabulary, lifted out of the toolbar <select> it used to live in — every other
   table in the platform puts this control in the column header. */
const PRODUCT_CATEGORY_OPTIONS = [
  { value: 'Deposit', label: 'Deposits' },
  { value: 'Loan', label: 'Financing / Loans' },
  { value: 'Card', label: 'Cards' },
  { value: 'Investment', label: 'Investments' },
  { value: 'Gold', label: 'Gold Account' },
];

const PRODUCT_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive / Closed' },
];
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
  // Client-side, like the category filter above it — this table renders a page the API already
  // returned rather than re-querying.
  const [statusFilter, setStatusFilter] = useState('');

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
    if (statusFilter) {
      const st = (item.derivedAccountStatus || item.financingStatus || '').toLowerCase();
      if (statusFilter === 'ACTIVE' ? !st.includes('active') : st.includes('active')) return false;
    }
    const matchesSearch =
      (item.accountNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.productName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.productCategory || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === '' || (item.type || '').toLowerCase() === typeFilter.toLowerCase();
    return matchesSearch && matchesType;
  });

  return (
    <div className={styles.stack}>
      {/* Hero Banner — Host Pattern */}
      <PageHeader
        icon={<Layers size={24} />}
        title="Customer Product Portfolio"
        pill={`${totalCount || filteredProducts.length} Total Facilities`}
        subtitle={`Comprehensive breakdown of all held accounts, financing, cards, and investments for ${customerName}`}
        actions={
          <Button variant="onHeader" onClick={handleBack} leadingIcon={<ArrowLeft size={15} />}>
            Back to Profile
          </Button>
        }
      />

      <FilterBar
        filters={[
          typeFilter && {
            key: 'category',
            label: 'Category',
            value: PRODUCT_CATEGORY_OPTIONS.find((o) => o.value === typeFilter)?.label ?? typeFilter,
            onRemove: () => setTypeFilter(''),
          },
          statusFilter && {
            key: 'status',
            label: 'Status',
            value: PRODUCT_STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? statusFilter,
            onRemove: () => setStatusFilter(''),
          },
          searchTerm && { key: 'search', label: 'Search', value: `"${searchTerm}"`, onRemove: () => setSearchTerm('') },
        ].filter(Boolean) as ActiveFilter[]}
        onClearAll={() => {
          setTypeFilter('');
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
              placeholder="Search product name, account number..."
              value={searchTerm}
              onValueChange={setSearchTerm}
            />
          </div>

          {/* Product Type Filter */}
          <div className={styles.row2}>
            <RowsPerPage storageKey="c360.products" value={pageSize} onChange={(n) => { setPageSize(n); setPageNumber(1); }} />

            <button
              type="button"
              onClick={() => customerId && loadProducts(customerId)}
              title="Refresh Products"
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
              <span>Loading customer product accounts...</span>
            </div>
          </div>
        ) : error ? (
          // A genuine fetch failure used to fall straight into the "no products found" empty state
          // below — indistinguishable from a customer who simply has zero product accounts. This
          // gives an operator a real, actionable reason instead of a false "nothing here".
          <div className={`error-container ${styles.rule}`}>
            <AlertTriangle size={20} className={styles.spacer} />
            <h3>Unable to Load Products</h3>
            <p>{getFriendlyErrorMessage({ message: error, status: errorStatus ?? undefined })}</p>
            <Button className={styles.spacer2} onClick={() => customerId && loadProducts(customerId)}>
              Retry
              </Button>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className={styles.text2}>
            <div className={styles.heading}>💳</div>
            <div className={styles.strong}>
              No product accounts found
            </div>
            <div className={styles.text3}>
              {searchTerm || typeFilter
                ? 'Try adjusting your search query or category filter.'
                : 'No active banking products found for this customer record.'}
            </div>
          </div>
        ) : (
          <DataTable>
              <thead>
                <tr>
                  <ColumnFilter
                    label="Product Category"
                    value={typeFilter}
                    onChange={setTypeFilter}
                    options={PRODUCT_CATEGORY_OPTIONS}
                    allLabel="All Categories"
                  />
                  <th>Product Name</th>
                  <th>Account Number</th>
                  {/* Not filterable: CustomerProduct carries no branch field — this column renders
                      a literal "-" for every row. It needs the product API to return a branch
                      before a filter here could do anything. */}
                  <th>Branch</th>
                  <th>Balance / Limit</th>
                  <ColumnFilter
                    label="Status"
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={PRODUCT_STATUS_OPTIONS}
                    allLabel="All Statuses"
                  />
                  <th className={styles.rule2}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((prod, idx) => (
                  <tr key={prod.accountNumber || idx}>
                    <td>
                      <span
                        className={styles.strong2}
                      >
                        {prod.productCategory || prod.type || 'Banking Product'}
                      </span>
                    </td>
                    <td className={styles.text4}>{prod.productName}</td>
                    <td className={cc.monoValue}>
                      {prod.accountNumber}
                    </td>
                    {/* CustomerProduct carries no branch field at all (that's only present on the
                        customer's own profile, a different entity) — always '-', honestly, not a
                        fabricated value. */}
                    <td className={styles.text5}>{'-'}</td>
                    <td className={styles.strong3}>
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
                          className={styles.pill}
                        >
                          <span className={styles.avatar} />
                          {prod.derivedAccountStatus}
                        </span>
                      ) : (
                        <span className={styles.muted2}>-</span>
                      )}
                    </td>
                    <td className={styles.rule2}>
                      <RowAction onClick={() => openProductModal(prod.accountNumber, prod.type as string)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
        )}

        {/* Pagination Toolbar */}
        {totalCount > 0 && (
          <Pagination
            page={pageNumber}
            pageSize={pageSize}
            total={totalCount}
            itemLabel="product"
            onPageChange={setPageNumber}
          />
        )}
      </div>

      <ProductDetailsModal />
    </div>
  );
}
