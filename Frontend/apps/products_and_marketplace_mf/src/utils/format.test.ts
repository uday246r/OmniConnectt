import { describe, expect, it } from 'vitest';
import { formatAuditAction, formatChange, formatFieldValue, formatNumber } from './format';

/**
 * How values read on a card. The old formatter returned a literal "₹" prefix for every currency field of
 * every bank; now the symbol is the field's own unit, and numbers follow the reader's locale.
 */

const at = (dataType: string, value: string, unit?: string | null) => formatFieldValue({ dataType: dataType as never, value, unit });

describe('formatFieldValue', () => {
  it('puts a currency\'s unit in front, taken from the field — no symbol is built in', () => {
    expect(at('Currency', '10000', '₹')).toBe(`₹${formatNumber(10000)}`);
    expect(at('Currency', '500', '$')).toBe(`$${formatNumber(500)}`);
    expect(at('Currency', '500')).toBe(formatNumber(500));
  });

  it('puts any other unit after the value', () => {
    expect(at('Percentage', '8.35', '% p.a.')).toBe(`${formatNumber(8.35)} % p.a.`);
    expect(at('Number', '20', 'years')).toBe(`${formatNumber(20)} years`);
    expect(at('Percentage', '8.35')).toBe(formatNumber(8.35));
  });

  it('shows a value that is not a number as it was entered', () => {
    expect(at('Currency', 'on request', '₹')).toBe('₹on request');
    expect(at('Number', 'n/a')).toBe('n/a');
  });

  it('reads a boolean as words', () => {
    expect(at('Boolean', 'true')).toBe('Yes');
    expect(at('Boolean', 'false')).toBe('No');
  });

  it('leaves text and choices alone, adding the unit if there is one', () => {
    expect(at('Text', 'Salaried')).toBe('Salaried');
    expect(at('Dropdown', '20 years')).toBe('20 years');
    expect(at('Text', '3', 'months')).toBe('3 months');
  });
});

describe('formatChange', () => {
  it('signs a change and rounds it to one decimal', () => {
    expect(formatChange(12)).toBe('+12%');
    expect(formatChange(4.56)).toBe('+4.6%');
    expect(formatChange(-3)).toBe('−3%');
    expect(formatChange(-0.04)).toBe('0%');
    expect(formatChange(0)).toBe('0%');
  });
});

describe('formatAuditAction', () => {
  it('turns a machine key into words, whatever it is', () => {
    expect(formatAuditAction('product.status_change')).toBe('Product Status Change');
    expect(formatAuditAction('sub_category.create')).toBe('Sub Category Create');
    expect(formatAuditAction('search')).toBe('Search');
  });

  it('needs no edit for a kind of action added later', () => {
    expect(formatAuditAction('brand_new.thing_happened')).toBe('Brand New Thing Happened');
  });
});
