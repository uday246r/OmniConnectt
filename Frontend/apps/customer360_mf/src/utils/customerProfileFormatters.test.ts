import { describe, expect, it } from 'vitest';
import { formatCustomerName, cleanSegmentValue } from './customerProfileFormatters';

describe('customerProfileFormatters', () => {
  describe('formatCustomerName', () => {
    it('prepends salutation to fullName when both are present', () => {
      expect(formatCustomerName('Mr.', 'John Doe')).toBe('Mr. John Doe');
      expect(formatCustomerName('Dr.', 'Sarah Jenkins')).toBe('Dr. Sarah Jenkins');
      expect(formatCustomerName("Dato'", 'Mohd Ali')).toBe("Dato' Mohd Ali");
    });

    it('deduplicates when fullName already starts with salutation', () => {
      expect(formatCustomerName('Mr.', 'Mr. John Doe')).toBe('Mr. John Doe');
      expect(formatCustomerName('dr', 'Dr. Sarah Jenkins')).toBe('Dr. Sarah Jenkins');
      expect(formatCustomerName('Ms.', 'Ms. Jane Doe')).toBe('Ms. Jane Doe');
    });

    it('returns fullName if salutation is missing or empty', () => {
      expect(formatCustomerName(null, 'John Doe')).toBe('John Doe');
      expect(formatCustomerName('', 'John Doe')).toBe('John Doe');
      expect(formatCustomerName(undefined, 'John Doe')).toBe('John Doe');
    });

    it('returns salutation if fullName is missing or empty', () => {
      expect(formatCustomerName('Mr.', null)).toBe('Mr.');
      expect(formatCustomerName('Dr.', '')).toBe('Dr.');
    });

    it('returns fallback dash when both are empty or null', () => {
      expect(formatCustomerName(null, null)).toBe('-');
      expect(formatCustomerName('', '')).toBe('-');
    });
  });

  describe('cleanSegmentValue', () => {
    it('returns trimmed string for valid segmentation', () => {
      expect(cleanSegmentValue('Mass Market')).toBe('Mass Market');
      expect(cleanSegmentValue('  Affluent  ')).toBe('Affluent');
      expect(cleanSegmentValue('Premier')).toBe('Premier');
    });

    it('returns null for empty, placeholder or null values', () => {
      expect(cleanSegmentValue(null)).toBeNull();
      expect(cleanSegmentValue(undefined)).toBeNull();
      expect(cleanSegmentValue('')).toBeNull();
      expect(cleanSegmentValue('   ')).toBeNull();
      expect(cleanSegmentValue('-')).toBeNull();
      expect(cleanSegmentValue('null')).toBeNull();
      expect(cleanSegmentValue('undefined')).toBeNull();
    });
  });
});
