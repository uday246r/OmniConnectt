import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProductStore } from './productStore';
import { useCustomerStore } from './customerStore';
import { api } from '../services/api';
import type { CustomerProduct } from '../types/api';

describe('useProductStore modal isolation and fallback', () => {
  const sampleProduct: CustomerProduct = {
    accountNumber: 'ACC-12345',
    productName: 'Premier Savings Account',
    productCategory: 'Deposit',
    type: 'CASA',
    balances: '50000.00',
    derivedAccountStatus: 'ACTIVE',
    tenure: '12',
    accountOpeningDate: '2023-01-15',
  };

  beforeEach(() => {
    useProductStore.setState({
      products: [sampleProduct],
      loading: false,
      error: null,
      errorStatus: null,
      modalOpen: false,
      selectedProductDetails: null,
      modalDetailsError: null,
      loadingDetails: false,
    });

    useCustomerStore.setState({
      customerType: 'individual',
      activeIndividualId: 'IND-999',
      individualProfile: {
        phprId: 'PHPR-1',
        nationalId: 'IND-999',
        fullName: 'Jane Doe',
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to summary product data when deep-dive API fails, without setting store error', async () => {
    // Simulate deep dive API 404 failure
    vi.spyOn(api, 'getDepositProduct').mockRejectedValueOnce({
      name: 'ApiError',
      message: 'Not Found',
      status: 404,
    });

    await useProductStore.getState().openProductModal('ACC-12345', 'Deposit');

    const state = useProductStore.getState();

    // The store's root error and errorStatus MUST remain null so the main page table is not broken!
    expect(state.error).toBeNull();
    expect(state.errorStatus).toBeNull();

    // The modal should be open and populated with the summary product item fallback
    expect(state.modalOpen).toBe(true);
    expect(state.selectedProductDetails).not.toBeNull();
    expect(state.selectedProductDetails?.accountNumber).toBe('ACC-12345');
    expect(state.selectedProductDetails?.productName).toBe('Premier Savings Account');
    expect(state.loadingDetails).toBe(false);
  });

  it('merges deep-dive details with existing product item on success', async () => {
    vi.spyOn(api, 'getDepositProduct').mockResolvedValueOnce({
      status: 200,
      data: {
        accountNumber: 'ACC-12345',
        productName: 'Premier Savings Account (Updated)',
        branchAccount: 'Main Branch',
        placementAmount: '50000.00',
      },
    });

    await useProductStore.getState().openProductModal('ACC-12345', 'Deposit');

    const state = useProductStore.getState();
    expect(state.error).toBeNull();
    expect(state.modalOpen).toBe(true);
    expect(state.selectedProductDetails?.accountNumber).toBe('ACC-12345');
    expect(state.selectedProductDetails?.productName).toBe('Premier Savings Account (Updated)');
    expect((state.selectedProductDetails as any)?.branchAccount).toBe('Main Branch');
    expect(state.loadingDetails).toBe(false);
  });

  it('clears modal state and modal error on closeProductModal', () => {
    useProductStore.setState({
      modalOpen: true,
      selectedProductDetails: sampleProduct,
      selectedProductType: 'Deposit',
      modalDetailsError: 'Some error',
    });

    useProductStore.getState().closeProductModal();

    const state = useProductStore.getState();
    expect(state.modalOpen).toBe(false);
    expect(state.selectedProductDetails).toBeNull();
    expect(state.selectedProductType).toBe('');
    expect(state.modalDetailsError).toBeNull();
  });
});
