import { Badge } from '@omniconnect/ui';
import { useStatus } from '../stores/useStatusConfigStore';
import type { StatusEntityType } from '../types/domain';

export interface StatusBadgeProps {
  /** Which kind of record the status belongs to — "Product", "SubCategory", "Category". */
  entityType: StatusEntityType;
  value: string;
}

/**
 * A record's status, drawn as Setup says: its label and its colour.
 *
 * Nothing here knows any status by name. An administrator can rename "Active", recolour it or add a
 * status of their own, and this follows without a deployment. Until Setup has loaded — or if the status
 * has since been deleted — it shows the raw value in a neutral tone rather than nothing.
 */
export function StatusBadge({ entityType, value }: StatusBadgeProps) {
  const { label, tone } = useStatus(entityType, value);
  return <Badge tone={tone}>{label}</Badge>;
}
