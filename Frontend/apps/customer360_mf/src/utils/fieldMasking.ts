import type { MaskingRule } from '../types/api';

/**
 * Generic masking engine for the Customer 360 field-config feature — one implementation of the
 * four rules an admin can pick from Field Settings, parameterized by `visibleCharCount` rather than
 * a fixed count baked into each rule (unlike the older per-field functions in `masking.ts`, which
 * this replaces for every field the new config-driven renderer touches; `masking.ts` itself is left
 * in place since Customer360.tsx's own corporate-signatory reveal fields — a different data domain,
 * out of this feature's scope — still use it).
 */
export function applyMaskingRule(raw: string, rule: MaskingRule, visibleCharCount: number): string {
  const len = raw.length;
  if (len === 0) return raw;

  const show = Math.max(0, Math.min(visibleCharCount, len));

  switch (rule) {
    case 'FullMask':
      return '*'.repeat(len);

    case 'HideFirstShowLast':
      return '*'.repeat(len - show) + raw.slice(len - show);

    case 'HideLastShowFirst':
      return raw.slice(0, show) + '*'.repeat(len - show);

    case 'HideMiddleShowFirstAndLast': {
      // Never let the two visible ends overlap or exceed the string — cap each side at half the
      // length so e.g. a 3-character value with visibleCharCount=4 doesn't show more than it hides.
      const sidelen = Math.min(show, Math.floor(len / 2));
      if (sidelen <= 0) return '*'.repeat(len);
      const first = raw.slice(0, sidelen);
      const last = raw.slice(len - sidelen);
      const middleLen = len - sidelen * 2;
      return first + '*'.repeat(middleLen) + last;
    }

    case 'None':
    default:
      return raw;
  }
}

/** Renders '_' for empty/null/"null"/"undefined" profile fields before display or masking. */
export function formatFieldValue(val: unknown): string {
  if (val === null || val === undefined) return '_';
  const s = String(val).trim();
  if (s === '' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') {
    return '_';
  }
  return s;
}

/** Whether a raw value is substantial enough to be worth revealing/masking at all — mirrors the
 * exact guard every hand-rolled reveal button in this app already used. */
export function hasRevealableValue(val: unknown): val is string {
  if (val === null || val === undefined) return false;
  const s = String(val).trim();
  return s !== '' && s.toLowerCase() !== 'null';
}
