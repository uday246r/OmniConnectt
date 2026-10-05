import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BarChart } from './BarChart';
import { niceStep } from './chartMath';
import { DonutChart } from './DonutChart';

/**
 * The dashboard's charts. The axis maths is the part that goes quietly wrong — a step that is not round
 * gives an axis reading 0, 3, 6, 9 — and a chart with nothing behind it must say so rather than draw an
 * empty frame. Both must also be readable without seeing them.
 */

describe('niceStep', () => {
  it.each([
    [0, 1], [1, 1], [4, 1], [5, 2], [8, 2], [12, 5], [20, 5], [21, 10], [40, 10], [100, 50], [900, 500],
  ])('for a largest value of %s uses a round step of %s', (max, step) => {
    expect(niceStep(max)).toBe(step);
  });

  it('is always a whole number of at least one, so an axis never reads 0, 0.25, 0.5', () => {
    for (const max of [0, 1, 2, 3, 7, 50, 333, 12_345]) {
      const step = niceStep(max);
      expect(Number.isInteger(step)).toBe(true);
      expect(step).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives an axis that always reaches the largest value', () => {
    for (const max of [1, 3, 9, 13, 24, 57, 101, 640]) expect(niceStep(max) * 4).toBeGreaterThanOrEqual(max);
  });
});

describe('BarChart', () => {
  const data = [{ id: 'a', label: 'Loans', value: 12 }, { id: 'b', label: 'Credit Cards', value: 6 }];

  it('describes itself to a screen reader with every value', () => {
    render(<BarChart data={data} ariaLabel="Products per category" />);

    expect(screen.getByRole('img', { name: 'Products per category: Loans 12, Credit Cards 6' })).toBeInTheDocument();
  });

  it('draws a bar per item and writes each value above it', () => {
    const { container } = render(<BarChart data={data} ariaLabel="x" />);

    expect(container.querySelectorAll('rect')).toHaveLength(2);
    expect(container.textContent).toContain('12');
    expect(container.textContent).toContain('6');
  });

  it('shortens a long label but keeps the full name in the tooltip', () => {
    const { container } = render(<BarChart data={[{ id: 'a', label: 'Wealth Management', value: 2 }]} ariaLabel="x" />);

    expect(container.textContent).toContain('Wealth Mana…');
    expect(container.querySelector('title')?.textContent).toBe('Wealth Management: 2');
  });

  it('says so, instead of drawing an empty frame, when there is nothing to chart', () => {
    render(<BarChart data={[]} ariaLabel="x" emptyText="No categories yet." />);

    expect(screen.getByText('No categories yet.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('still charts values that are all zero', () => {
    const { container } = render(<BarChart data={[{ id: 'a', label: 'Insurance', value: 0 }]} ariaLabel="x" />);

    expect(container.querySelectorAll('rect')).toHaveLength(1);
  });
});

describe('DonutChart', () => {
  const segments = [{ key: 'Active', label: 'Active', value: 24, tone: 'success' as const }, { key: 'Draft', label: 'Draft', value: 8, tone: 'warning' as const }];

  it('describes itself with every slice, and shows the total in the middle', () => {
    render(<DonutChart segments={segments} centerValue={32} centerLabel="Products" ariaLabel="Products by status" />);

    expect(screen.getByRole('img', { name: 'Products by status: Active 24, Draft 8' })).toBeInTheDocument();
    expect(screen.getByText('32')).toBeInTheDocument();
  });

  it('sizes each slice by its share of the whole', () => {
    const { container } = render(<DonutChart segments={segments} centerValue={32} centerLabel="Products" ariaLabel="x" />);

    const dashes = [...container.querySelectorAll('circle[stroke-dasharray]')].map((c) => c.getAttribute('stroke-dasharray'));
    expect(dashes).toEqual(['75 25', '25 75']);
  });

  it('draws only the empty ring when there is nothing to show', () => {
    const { container } = render(<DonutChart segments={[]} centerValue={0} centerLabel="Products" ariaLabel="x" />);

    expect(container.querySelectorAll('circle[stroke-dasharray]')).toHaveLength(0);
  });
});
