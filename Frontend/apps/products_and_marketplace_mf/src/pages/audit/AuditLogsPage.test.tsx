import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditLog } from '../../types/domain';

/**
 * The marketplace's audit screen.
 *
 * This page had no Refresh button at all — every other log screen on the platform has one — and adding
 * it meant nothing until the read could bypass the HTTP layer's 30-second reuse of a success. These
 * hold both halves: the button exists, and pressing it asks the server rather than being answered from
 * memory. The live banner is kept alongside it, because the two do different things: the banner only
 * appears for events the current page and filters would not have shown.
 */

const search = vi.hoisted(() => vi.fn());
const getActionOptions = vi.hoisted(() => vi.fn());
const getEntityTypes = vi.hoisted(() => vi.fn());
const getSummary = vi.hoisted(() => vi.fn());

vi.mock('../../services/auditLogApi', () => ({
  auditLogApi: { search, getActionOptions, getEntityTypes, getSummary },
}));
vi.mock('../../services/realtime', () => ({ subscribeToAuditLogs: () => () => undefined }));

const { AuditLogsPage } = await import('./AuditLogsPage');
const { useAuditLogStore } = await import('../../stores/useAuditLogStore');

const entry = (over: Partial<AuditLog> = {}): AuditLog => ({
  id: crypto.randomUUID(),
  timestamp: '2026-10-01T09:00:00Z',
  actorName: 'Aiman Hakim',
  actorEmail: 'aiman@example.com',
  action: 'product.created',
  entityType: 'Product',
  entityId: 'p1',
  entityName: 'Home Loan – Salaried',
  description: 'Created product Home Loan – Salaried',
  success: true,
  ...over,
});

beforeEach(() => {
  search.mockReset().mockResolvedValue({ items: [entry()], totalCount: 1, totalPages: 1, page: 1, pageSize: 10 });
  getActionOptions.mockReset().mockResolvedValue([]);
  getEntityTypes.mockReset().mockResolvedValue([]);
  getSummary.mockReset().mockResolvedValue({ totalCount: 1, successCount: 1, failureCount: 0, actionTypeCount: 1 });
  useAuditLogStore.setState({ items: [], totalCount: 0, loading: false, error: null, page: 1, liveCount: 0, summary: null, search: '', action: null, entityType: null });
});

describe('AuditLogsPage', () => {
  it('shows the events the server returned', async () => {
    render(<AuditLogsPage />);

    expect(await screen.findByText('Aiman Hakim')).toBeInTheDocument();
    expect(screen.getByText('Product Created')).toBeInTheDocument();
  });

  it('offers a Refresh button, which this page did not have', async () => {
    render(<AuditLogsPage />);

    expect(await screen.findByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('asks the server again when Refresh is pressed, rather than being answered from the cache', async () => {
    const user = userEvent.setup();
    render(<AuditLogsPage />);
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(search.mock.calls.length).toBeGreaterThan(1));
    expect(search.mock.calls.at(-1)?.[1]).toMatchObject({ fresh: true });
  });

  it('goes back to the newest page on Refresh, which is what someone pressing it wants', async () => {
    const user = userEvent.setup();
    render(<AuditLogsPage />);
    await waitFor(() => expect(search).toHaveBeenCalled());

    useAuditLogStore.setState({ page: 4 });
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(useAuditLogStore.getState().page).toBe(1));
  });

  it('keeps the live banner, which says something Refresh does not', async () => {
    render(<AuditLogsPage />);
    await waitFor(() => expect(search).toHaveBeenCalled());

    useAuditLogStore.setState({ liveCount: 3 });

    expect(await screen.findByRole('button', { name: /3 new events/ })).toBeInTheDocument();
  });

  it('says there are no events rather than showing a blank table', async () => {
    search.mockResolvedValue({ items: [], totalCount: 0, totalPages: 0, page: 1, pageSize: 10 });
    render(<AuditLogsPage />);

    expect(await screen.findByText(/No events yet/i)).toBeInTheDocument();
  });
});
