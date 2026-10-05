import { describe, expect, it } from 'vitest';
import { buildFieldValues, initialFieldValues, joinChoices, placeServerErrors, splitChoices, validateProductField, validateProductFields } from './productForm';
import type { FieldDataType, FieldDefinition } from '../types/domain';

/**
 * A product has no fixed attribute fields: its sub-category defines them. So the form's checks are the
 * definitions' checks, and they must agree with the server's — same order (required, type, format rules),
 * same words — or a value would be refused on one side and accepted on the other.
 */

let counter = 0;
function field(over: Partial<FieldDefinition> & { dataType: FieldDataType }): FieldDefinition {
  counter += 1;
  return {
    id: `f${counter}`, subCategoryId: 's1', key: over.key ?? `field_${counter}`, label: over.label ?? `Field ${counter}`, unit: null, options: null,
    validations: [], required: false, filterable: false, sortable: false, displayOnCard: false, displayOnDetails: true, isReadOnly: false,
    isPrimaryMetric: false, isSecondaryMetric: false, sortOrder: counter, ...over,
  };
}

describe('required', () => {
  it('is refused when empty or only spaces, naming the field', () => {
    const rate = field({ dataType: 'Percentage', label: 'Interest Rate', required: true });
    expect(validateProductField(rate, '')).toBe('Interest Rate is required.');
    expect(validateProductField(rate, '   ')).toBe('Interest Rate is required.');
    expect(validateProductField(rate, undefined)).toBe('Interest Rate is required.');
  });

  it('lets an optional field stay empty without checking its type', () => {
    expect(validateProductField(field({ dataType: 'Number' }), '')).toBeUndefined();
  });
});

describe('numbers', () => {
  const rate = field({ dataType: 'Percentage', label: 'Rate' });

  it.each(['8', '8.35', '-4', '+2.5', '5,00,000', '1,234.56', ' 7 '])('accepts %s', (value) => {
    expect(validateProductField(rate, value)).toBeUndefined();
  });

  it.each(['high', '8.', '.5', '8.3.5', '1e5', '₹500', '5 lakh'])('refuses %s', (value) => {
    expect(validateProductField(rate, value)).toBe('Rate must be a number.');
  });

  it('applies to currency and plain numbers too', () => {
    expect(validateProductField(field({ dataType: 'Currency', label: 'Fee' }), 'free')).toBe('Fee must be a number.');
    expect(validateProductField(field({ dataType: 'Number', label: 'Count' }), 'many')).toBe('Count must be a number.');
  });
});

describe('other types', () => {
  it('holds a boolean to true or false, in any case', () => {
    const flag = field({ dataType: 'Boolean', label: 'Insured' });
    expect(validateProductField(flag, 'TRUE')).toBeUndefined();
    expect(validateProductField(flag, 'maybe')).toBe('Insured must be true or false.');
  });

  it('holds a date to a date', () => {
    const launch = field({ dataType: 'Date', label: 'Launch' });
    expect(validateProductField(launch, '2026-10-01')).toBeUndefined();
    expect(validateProductField(launch, 'next spring')).toBe('Launch must be a date.');
  });

  it('holds a dropdown to its options, in any case, and lists them when refused', () => {
    const tenure = field({ dataType: 'Dropdown', label: 'Tenure', options: ['10 years', '20 years'] });
    expect(validateProductField(tenure, '20 YEARS')).toBeUndefined();
    expect(validateProductField(tenure, '99 years')).toBe('Tenure must be one of: 10 years, 20 years.');
  });

  it('holds every choice of a multi-select to the options, naming the one that is not', () => {
    const perks = field({ dataType: 'MultiSelect', label: 'Perks', options: ['Lounge', 'Cashback'] });
    expect(validateProductField(perks, 'lounge, CASHBACK')).toBeUndefined();
    expect(validateProductField(perks, 'Lounge, Spa')).toBe('"Spa" is not an option for Perks. Choose from: Lounge, Cashback.');
  });

  it('leaves free text alone', () => {
    expect(validateProductField(field({ dataType: 'Text' }), 'anything at all')).toBeUndefined();
  });
});

describe('format rules', () => {
  const code = field({
    dataType: 'Text', label: 'Scheme Code',
    validations: [{ type: 'custom', pattern: '^[A-Z]{3}[0-9]{2}$', message: 'Use three letters and two digits.' }],
  });

  it('are evaluated by the shared engine, after the type check', () => {
    expect(validateProductField(code, 'abc1')).toBe('Use three letters and two digits.');
    expect(validateProductField(code, 'ABC12')).toBeUndefined();
  });

  it('fail open for a format this build does not know, like the server', () => {
    const renamed = field({ dataType: 'Text', validations: [{ type: 'aFormatThatWasDeleted', message: 'Nope.' }] });
    expect(validateProductField(renamed, 'anything')).toBeUndefined();
  });

  it('are not reached when the type check already failed', () => {
    const rate = field({ dataType: 'Number', label: 'Rate', validations: [{ type: 'custom', pattern: '^9', message: 'Must start with 9.' }] });
    expect(validateProductField(rate, 'abc')).toBe('Rate must be a number.');
  });
});

describe('a whole form', () => {
  it('reports every failing field by id, and only those', () => {
    const rate = field({ dataType: 'Number', label: 'Rate', required: true });
    const tenure = field({ dataType: 'Dropdown', label: 'Tenure', options: ['1 year'] });
    const note = field({ dataType: 'Text' });

    const errors = validateProductFields([rate, tenure, note], { [rate.id]: 'x', [tenure.id]: '2 years' });

    expect(Object.keys(errors).sort()).toEqual([rate.id, tenure.id].sort());
  });

  it('is empty when everything is fine', () => {
    const rate = field({ dataType: 'Number', required: true });
    expect(validateProductFields([rate], { [rate.id]: '8.5' })).toEqual({});
  });
});

describe('what is sent', () => {
  it('includes only fields that have a value, trimmed', () => {
    const a = field({ dataType: 'Text' });
    const b = field({ dataType: 'Text' });
    const c = field({ dataType: 'Text' });

    expect(buildFieldValues([a, b, c], { [a.id]: '  kept  ', [b.id]: '   ' })).toEqual([{ fieldDefinitionId: a.id, value: 'kept' }]);
  });

  it('starts an edit from the values the product already holds', () => {
    const values = initialFieldValues({
      cardFields: [{ fieldDefinitionId: 'a', key: 'k', label: 'K', dataType: 'Text', value: '1', displayOnCard: true, displayOnDetails: false }],
      detailFields: [{ fieldDefinitionId: 'b', key: 'j', label: 'J', dataType: 'Text', value: '2', displayOnCard: false, displayOnDetails: true }],
    });
    expect(values).toEqual({ a: '1', b: '2' });
    expect(initialFieldValues(null)).toEqual({});
  });

  it('round-trips a multi-select through its comma-separated form', () => {
    expect(splitChoices('Lounge,  Cashback ,, ')).toEqual(['Lounge', 'Cashback']);
    expect(joinChoices(['Lounge', 'Cashback'])).toBe('Lounge, Cashback');
    expect(splitChoices('')).toEqual([]);
  });
});

describe('the server\'s answer', () => {
  it('is placed on the fields it names, and what it cannot place is kept for a general message', () => {
    const rate = field({ dataType: 'Number', key: 'interest_rate' });
    const { byField, unplaced } = placeServerErrors([rate], { interest_rate: 'Rate must be a number.', 'some-unknown-id': 'This field does not belong here.' });

    expect(byField).toEqual({ [rate.id]: 'Rate must be a number.' });
    expect(unplaced).toEqual(['This field does not belong here.']);
  });
});
