import type { ProductFieldValue } from '../types/domain';

/**
 * A number in the reader's own locale — grouping and decimal mark included — rather than one baked in.
 * (The old formatter returned a literal "₹" prefix for every Currency field of every bank.)
 */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(undefined, options).format(value);
}

/** "+12%", "-4.5%", "0%": a change, signed, at most one decimal. */
export function formatChange(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  const text = `${formatNumber(Math.abs(rounded), { maximumFractionDigits: 1 })}%`;
  return rounded > 0 ? `+${text}` : rounded < 0 ? `−${text}` : text;
}

/**
 * How a product's attribute reads on a card or in its details.
 *
 * What surrounds the value comes from the field's own `unit`, set by whoever defined the field — "₹" or
 * "% p.a." or "years" — not from this code. A currency field puts its unit in front of the amount; any
 * other puts it after. Values that are not numbers are shown as entered.
 */
export function formatFieldValue(field: Pick<ProductFieldValue, 'dataType' | 'unit' | 'value'>): string {
  const { dataType, unit, value } = field;
  const suffix = unit ? ` ${unit}` : '';

  switch (dataType) {
    case 'Currency': {
      const amount = Number(value);
      return `${unit ?? ''}${Number.isFinite(amount) ? formatNumber(amount) : value}`;
    }
    case 'Number':
    case 'Percentage': {
      const amount = Number(value);
      return `${Number.isFinite(amount) ? formatNumber(amount) : value}${suffix}`;
    }
    case 'Boolean':
      return value === 'true' ? 'Yes' : value === 'false' ? 'No' : value;
    default:
      return `${value}${suffix}`;
  }
}

/**
 * "product.status_change" → "Product Status Change".
 *
 * Audit actions are stored as machine keys so new kinds can appear without a schema change; this is only
 * how they read to a person. It is derived, never looked up in a list, so a kind added later needs no edit here.
 */
export function formatAuditAction(action: string): string {
  return action
    .split(/[._]/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}
