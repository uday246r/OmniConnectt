import React, { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useCustomerStore } from '../store/customerStore';
import { useProductStore } from '../store/productStore';
import { useHostNavigate } from '../navigation/HostNavigation';
import ProductDetailsModal from '../components/ProductDetailsModal';
import { ArrowLeft, Search, Eye, Layers, RefreshCw, X, ChevronLeft, ChevronRight, AlertTriangle } from '@omniconnect/ui/icons';
import type { CorporateProfile, IndividualProfile } from '../types/api';
import { getFriendlyErrorMessage } from '../utils/errorMessages';
import { Button, ColumnFilter, DataTable, EMPTY_VALUE, FilterBar, PageHeader, Pagination, ResponsiveRows, RowAction, RowsPerPage, SearchField, useDebouncedValue, type ActiveFilter } from '@omniconnect/ui';
import { StatusBadge } from '../shared/StatusBadge';
import { formatCurrency, resolveProductStatus } from '../shared/formatValue';
import styles from './AllProducts.module.css';
import cc from '../shared/c360Common.module.css';
import { useShallow } from 'zustand/react/shallow';

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
  const { profile, customerType } = useCustomerStore(useShallow((s) => ({ profile: s.profile, customerType: s.customerType })));
  const navigate = useHostNavigate();
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
  } = useProductStore(useShallow((s) => ({ products: s.products, loading: s.loading, error: s.error, errorStatus: s.errorStatus, pageNumber: s.pageNumber, pageSize: s.pageSize, totalCount: s.totalCount, totalPages: s.totalPages, setPageNumber: s.setPageNumber, setPageSize: s.setPageSize, loadProducts: s.loadProducts, openProductModal: s.openProductModal })));

  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('');

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
    navigate('customer-360');
  };

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  // The box stays bound to the raw `searchTerm` so typing never feels laggy; only the filtering
  // below — recomputed on every render — waits for the debounce, so a fast typist doesn't refilter
  // and re-render the whole table once per keystroke.
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 200);

  // Recommends matching products as the operator types, rather than only narrowing the table
  // silently.
  const searchSuggestions = (() => {
    const query = debouncedSearchTerm.trim().toLowerCase();
    if (!query) return [];
    return products
      .filter(
        (item) =>
          (item.accountNumber || '').toLowerCase().includes(query) ||
          (item.productName || '').toLowerCase().includes(query) ||
          (item.productCategory || '').toLowerCase().includes(query),
      )
      .slice(0, 8)
      .map((item) => ({
        id: item.productName || item.accountNumber || '',
        label: (
          <span className={styles.suggestionRow}>
            <span className={styles.suggestionPrimary}>{item.productName || 'Untitled Product'}</span>
            <span className={styles.suggestionSecondary}>{item.productCategory} · {item.accountNumber}</span>
          </span>
        ),
      }));
  })();

  /*
   * Per-column recommendations, from the products already loaded — no extra request, and never a
   * value this table could not show. Category qualifies a product name; the product name qualifies
   * a bare account number.
   */
  const namePool = useMemo(
    () => products.map((p) => ({ value: p.productName ?? '', meta: p.productCategory || undefined })),
    [products],
  );
  const accountPool = useMemo(
    () => products.map((p) => ({ value: p.accountNumber ?? '', meta: p.productName || undefined })),
    [products],
  );

  // Local filtering based on query
  const filteredProducts = products.filter((item) => {
    if (accountFilter && !(item.accountNumber || '').toLowerCase().includes(accountFilter.toLowerCase())) return false;
    if (nameFilter && !(item.productName || '').toLowerCase().includes(nameFilter.toLowerCase())) return false;
    if (statusFilter) {
      const st = resolveProductStatus(item).toLowerCase();
      if (statusFilter === 'ACTIVE' ? !st.includes('active') : st.includes('active')) return false;
    }
    const matchesSearch =
      (item.accountNumber || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
      (item.productName || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
      (item.productCategory || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase());
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
          accountFilter && { key: 'account', label: 'Account #', value: `"${accountFilter}"`, onRemove: () => setAccountFilter('') },
          nameFilter && { key: 'name', label: 'Product Name', value: `"${nameFilter}"`, onRemove: () => setNameFilter('') },
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
          setAccountFilter('');
          setNameFilter('');
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
              suggestions={searchSuggestions}
              onSelectSuggestion={(s) => setSearchTerm(s.id)}
              emptyHint="No matching products."
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
        {error ? (
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
        ) : (
          <DataTable footer={<Pagination page={pageNumber} pageSize={pageSize} total={totalCount} itemLabel="product" onPageChange={setPageNumber} />}>
            <ResponsiveRows
              rows={filteredProducts}
              loading={loading}
              loadingRows={pageSize}
              rowKey={(prod, i) => prod.accountNumber || String(i)}
              empty={
                searchTerm || typeFilter || statusFilter || nameFilter || accountFilter
                  ? 'No products found matching the selected filters. Try adjusting your search query or filters.'
                  : 'No active banking products found for this customer record.'
              }
              columns={[
                {
                  key: 'category',
                  label: 'Product Category',
                  priority: 'always',
                  header: (
                    <ColumnFilter
                      key="category"
                      label="Product Category"
                      title="Filter Category"
                      value={typeFilter}
                      onChange={setTypeFilter}
                      options={PRODUCT_CATEGORY_OPTIONS}
                      allLabel="All Categories"
                      searchPlaceholder="Type to filter categories…"
                    />
                  ),
                  render: (prod) => (
                    <span className={styles.strong2}>
                      {prod.productCategory || prod.type || 'Banking Product'}
                    </span>
                  ),
                },
                {
                  key: 'name',
                  label: 'Product Name',
                  priority: 'always',
                  header: (
                    <ColumnFilter
                      key="name"
                      label="Product Name"
                      title="Filter Product Name"
                      value={nameFilter}
                      onChange={setNameFilter}
                      options={[]}
                      allLabel={undefined}
                      freeText
                      searchPlaceholder="Type to filter name…"
                      suggestFrom={namePool}
                      emptyHint="No matching product."
                    />
                  ),
                  render: (prod) => <span className={styles.text4}>{prod.productName}</span>,
                },
                {
                  key: 'account',
                  label: 'Account Number',
                  priority: 'high',
                  header: (
                    <ColumnFilter
                      key="account"
                      label="Account Number"
                      title="Filter Account #"
                      value={accountFilter}
                      onChange={setAccountFilter}
                      options={[]}
                      allLabel={undefined}
                      freeText
                      filterType="numeric"
                      searchPlaceholder="Type to filter account #…"
                      suggestFrom={accountPool}
                      emptyHint="No matching account number."
                    />
                  ),
                  render: (prod) => <span className={cc.monoValue}>{prod.accountNumber}</span>,
                },
                {
                  key: 'branch',
                  label: 'Branch',
                  priority: 'low',
                  /* CustomerProduct carries no branch field at all (that lives on the customer's own
                     profile, a different entity) — always the empty marker, honestly, rather than a
                     fabricated value. Not filterable for the same reason. */
                  render: () => <span className={styles.text5}>{EMPTY_VALUE}</span>,
                },
                {
                  key: 'balance',
                  label: 'Balance / Limit',
                  priority: 'low',
                  render: (prod) => (
                    <span className={styles.strong3} style={{ whiteSpace: 'nowrap' }}>
                      {formatCurrency(prod.balances)}
                    </span>
                  ),
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
                      options={PRODUCT_STATUS_OPTIONS}
                      allLabel="All Statuses"
                    />
                  ),
                  render: (prod) => (
                    <StatusBadge status={resolveProductStatus(prod)} dot={true} />
                  ),
                },
                {
                  key: 'actions',
                  label: 'Actions',
                  priority: 'always',
                  align: 'right',
                  render: (prod) => (
                    <RowAction
                      onClick={() => openProductModal(prod.accountNumber, prod.type as string)}
                    />
                  ),
                },
              ]}
            />
          </DataTable>
        )}
      </div>

      <ProductDetailsModal />
    </div>
  );
}
