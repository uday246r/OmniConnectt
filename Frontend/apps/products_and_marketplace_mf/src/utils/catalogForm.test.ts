import { describe, expect, it } from 'vitest';
import { CODE_HINT, hasErrors, validateCode, validateDescription, validateName } from './catalogForm';

/**
 * The client-side twin of the server's category / sub-category / product rules.
 *
 * Worth pinning because the two must agree: a rule the browser is stricter about blocks something the
 * API would accept, and one it is looser about only moves the failure to a round trip. The messages are
 * the server's own, so a person sees the same words whichever side caught it.
 */
describe('validateName', () => {
  it('requires one', () => {
    expect(validateName('', 'Category')).toBe('Category name is required.');
    expect(validateName('   ', 'Category')).toBe('Category name is required.');
  });

  it('holds it to the server\'s length, counted after trimming', () => {
    expect(validateName('A', 'Category')).toBe('Category name must be between 2 and 150 characters.');
    expect(validateName(' A ', 'Category')).toBe('Category name must be between 2 and 150 characters.');
    expect(validateName('Ab', 'Category')).toBeUndefined();
    expect(validateName('x'.repeat(150), 'Category')).toBeUndefined();
    expect(validateName('x'.repeat(151), 'Category')).toBe('Category name must be between 2 and 150 characters.');
  });

  it('names the kind of record in its message', () => {
    expect(validateName('', 'Sub-category')).toBe('Sub-category name is required.');
  });
});

describe('validateCode', () => {
  it('requires one', () => {
    expect(validateCode('', 'Category')).toBe('Category code is required.');
  });

  it('holds it to the server\'s length', () => {
    expect(validateCode('L', 'Category')).toBe('Category code must be between 2 and 30 characters.');
    expect(validateCode('L'.repeat(31), 'Category')).toBe('Category code must be between 2 and 30 characters.');
    expect(validateCode('LN', 'Category')).toBeUndefined();
  });

  it.each(['LN-HM', 'CC_CASH_001', 'a1', '2FA'])('accepts %s', (code) => {
    expect(validateCode(code, 'Category')).toBeUndefined();
  });

  it.each(['-LN', '_LN', 'L N', 'LN!', 'LN/HM', 'LÑ'])('refuses %s', (code) => {
    expect(validateCode(code, 'Category')).toBe(CODE_HINT);
  });

  it('allows a longer limit for products, whose codes are up to 50 characters', () => {
    expect(validateCode('P'.repeat(50), 'Product', 50)).toBeUndefined();
    expect(validateCode('P'.repeat(51), 'Product', 50)).toBe('Product code must be between 2 and 50 characters.');
  });
});

describe('validateDescription', () => {
  it('allows up to the limit and refuses beyond it', () => {
    expect(validateDescription('x'.repeat(1000))).toBeUndefined();
    expect(validateDescription('x'.repeat(1001))).toBe('Description cannot exceed 1000 characters.');
    expect(validateDescription('x'.repeat(4001), 4000)).toBe('Description cannot exceed 4000 characters.');
  });
});

describe('hasErrors', () => {
  it('is true only when some field has a message', () => {
    expect(hasErrors({ name: undefined, code: undefined })).toBe(false);
    expect(hasErrors({ name: undefined, code: 'Bad.' })).toBe(true);
    expect(hasErrors({})).toBe(false);
  });
});
