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

export function formatDate(value: string | null | undefined, options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", options);
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
