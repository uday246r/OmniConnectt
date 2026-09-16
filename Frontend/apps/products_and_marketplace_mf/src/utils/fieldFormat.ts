import { EMPTY_VALUE, formatDate as platformFormatDate } from "@omniconnect/ui";
import type { FieldDataType } from "../types/domain";

export function formatFieldValue(dataType: FieldDataType, value: string, unit?: string | null): string {
  const suffix = unit ?? "";
  switch (dataType) {
    case "Currency":
      return `₹${value}${suffix}`;
    case "Percentage":
      return `${value}%${suffix}`;
    case "Number":
      return `${value}${suffix}`;
    case "Boolean":
      return value === "true" ? "Yes" : "No";
    default:
      return `${value}${suffix}`;
  }
}

/**
 * A date in the viewer's locale — the platform `formatDate` unless the caller asks for other parts.
 * It was pinned to "en-IN" and printed "-" (or "Invalid Date") for a missing or malformed value.
 */
export function formatDate(value: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!options) return platformFormatDate(value);
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return date.toLocaleDateString(undefined, options);
}

export function formatRelativeTime(value: string): string {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min${diffMinutes === 1 ? "" : "s"} ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  return formatDate(value);
}
