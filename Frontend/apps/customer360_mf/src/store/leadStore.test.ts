import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLeadStore } from './leadStore';
import { api } from '../services/api';
import type { LeadRecord } from '../types/api';

describe('useLeadStore', () => {
  const sampleLead: LeadRecord = {
    id: 'LEAD-101',
    name: 'Ahmad Faiz Bin Razak',
    icNumber: '900214105421',
    phone: '+60123456789',
    email: 'faiz@example.com',
    product: 'BSN MyHome Financing',
    categoryName: 'Home Financing',
    subCategoryName: 'Residential',
    state: 'Selangor',
    branch: 'Klang',
    status: 'Submitted',
    createdDate: '2026-03-01',
    appliedAmount: '350000.00',
  };

  beforeEach(() => {
    useLeadStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads customer leads successfully and updates store state', async () => {
    vi.spyOn(api, 'getCustomerLeads').mockResolvedValueOnce({
      success: true,
      data: {
        items: [sampleLead],
        totalRecords: 1,
        page: 1,
        pageSize: 5,
        totalPages: 1,
      },
    });

    await useLeadStore.getState().loadCustomerLeads({
      icNumber: '900214105421',
    });

    const state = useLeadStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.leads).toHaveLength(1);
    expect(state.leads[0].id).toBe('LEAD-101');
    expect(state.totalCount).toBe(1);
  });

  it('opens and closes lead details drawer', () => {
    useLeadStore.getState().openLeadDrawer(sampleLead);
    expect(useLeadStore.getState().drawerOpen).toBe(true);
    expect(useLeadStore.getState().selectedLead).toEqual(sampleLead);

    useLeadStore.getState().closeLeadDrawer();
    expect(useLeadStore.getState().drawerOpen).toBe(false);
    expect(useLeadStore.getState().selectedLead).toBeNull();
  });

  it('handles 404 cleanly as empty leads array without error state', async () => {
    vi.spyOn(api, 'getCustomerLeads').mockRejectedValueOnce({
      name: 'ApiError',
      message: 'Not Found',
      status: 404,
    });

    await useLeadStore.getState().loadCustomerLeads({
      icNumber: '000000000000',
    });

    const state = useLeadStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.leads).toHaveLength(0);
    expect(state.totalCount).toBe(0);
  });
});
