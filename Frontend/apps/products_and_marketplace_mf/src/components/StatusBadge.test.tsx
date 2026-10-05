import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';
import { resolveStatus, useStatusConfigStore } from '../stores/useStatusConfigStore';
import type { StatusConfig } from '../types/domain';

/**
 * A status is drawn as Setup says: its label and its colour, and nothing in the app knows any status by
 * name. These pin that the badge follows an administrator's changes and never invents a meaning for a
 * status it has not been told about.
 */

const row = (over: Partial<StatusConfig>): StatusConfig => ({
  id: 'x', entityType: 'Product', value: 'Active', label: 'Active', color: 'success', enabled: true, isLive: true, sortOrder: 1, ...over,
});

function load(configs: StatusConfig[]) {
  act(() => {
    useStatusConfigStore.setState({ configs, byKey: Object.fromEntries(configs.map((c) => [`${c.entityType}:${c.value}`, c])), loaded: true });
  });
}

beforeEach(() => {
  useStatusConfigStore.setState({ configs: [], byKey: {}, loaded: false, loading: false, error: null });
});

describe('StatusBadge', () => {
  it('shows the label Setup gives the status, not the stored value', () => {
    load([row({ value: 'PendingReview', label: 'Pending review', color: 'warning' })]);

    render(<StatusBadge entityType="Product" value="PendingReview" />);

    expect(screen.getByText('Pending review')).toBeInTheDocument();
    expect(screen.queryByText('PendingReview')).not.toBeInTheDocument();
  });

  it('draws it in the colour Setup gives it', () => {
    load([row({ value: 'Draft', label: 'Draft', color: 'warning' }), row({ id: 'y', value: 'Active', color: 'success' })]);

    const { rerender } = render(<StatusBadge entityType="Product" value="Draft" />);
    expect(screen.getByText('Draft').className).toMatch(/warning/);

    rerender(<StatusBadge entityType="Product" value="Active" />);
    expect(screen.getByText('Active').className).toMatch(/success/);
  });

  it('shows the raw value in a neutral tone until Setup has loaded, rather than nothing', () => {
    render(<StatusBadge entityType="Product" value="Featured" />);

    expect(screen.getByText('Featured').className).toMatch(/neutral/);
  });

  it('follows a change an administrator makes in Setup', () => {
    load([row({ label: 'Active', color: 'success' })]);
    render(<StatusBadge entityType="Product" value="Active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();

    load([row({ label: 'Live now', color: 'info' })]);

    expect(screen.getByText('Live now').className).toMatch(/info/);
  });

  it('keeps the same value distinct across kinds of record', () => {
    load([row({ entityType: 'Product', label: 'Product live' }), row({ id: 'z', entityType: 'Category', label: 'Category live' })]);

    render(<><StatusBadge entityType="Product" value="Active" /><StatusBadge entityType="Category" value="Active" /></>);

    expect(screen.getByText('Product live')).toBeInTheDocument();
    expect(screen.getByText('Category live')).toBeInTheDocument();
  });
});

describe('resolveStatus', () => {
  it('reports whether a status is live, and never assumes an unknown one is', () => {
    const byKey = { 'Product:Active': row({ isLive: true }), 'Product:Draft': row({ value: 'Draft', isLive: false }) };

    expect(resolveStatus(byKey, 'Product', 'Active')).toMatchObject({ isLive: true, known: true });
    expect(resolveStatus(byKey, 'Product', 'Draft')).toMatchObject({ isLive: false, known: true });
    expect(resolveStatus(byKey, 'Product', 'Mystery')).toMatchObject({ isLive: false, known: false, label: 'Mystery', tone: 'neutral' });
  });
});
