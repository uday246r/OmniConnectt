import type { StatusTone } from '../../types/domain';

/**
 * The colours a status can be given. One list, typed against the shared badge's own tones, so a tone the
 * badge does not know cannot be offered here. (The server stores the choice as free text; this is the
 * vocabulary the screens can actually draw.)
 */
export const STATUS_TONES = ['success', 'warning', 'danger', 'info', 'primary', 'neutral'] as const satisfies readonly StatusTone[];

/** "SubCategory" → "Sub category": how a kind of record reads as a heading. Derived, so a new kind needs no edit here. */
export function humanizeEntityType(entityType: string): string {
  const spaced = entityType.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
