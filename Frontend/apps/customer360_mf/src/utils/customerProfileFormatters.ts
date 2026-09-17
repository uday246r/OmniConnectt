/**
 * Utility functions for Customer 360 profile presentation.
 */

/**
 * Combines salutation and full name safely with deduplication.
 * E.g., salutation="Mr.", fullName="John Doe" -> "Mr. John Doe"
 * E.g., salutation="Dr.", fullName="Dr. Jane Smith" -> "Dr. Jane Smith" (deduplicated)
 */
export function formatCustomerName(
  salutation?: string | null,
  fullName?: string | null
): string {
  const cleanSalutation = (salutation ?? '').trim();
  const cleanName = (fullName ?? '').trim();

  if (!cleanSalutation && !cleanName) {
    return '-';
  }
  if (!cleanSalutation) {
    return cleanName;
  }
  if (!cleanName) {
    return cleanSalutation;
  }

  // Deduplicate if fullName already begins with the salutation
  if (cleanName.toLowerCase().startsWith(cleanSalutation.toLowerCase())) {
    return cleanName;
  }

  return `${cleanSalutation} ${cleanName}`;
}

/**
 * Cleans and returns the segmentation value for badge display.
 * Returns null if the value is empty, '-' or placeholder.
 */
export function cleanSegmentValue(segmentation?: string | null): string | null {
  if (!segmentation) return null;
  const trimmed = segmentation.trim();
  if (
    trimmed === '' ||
    trimmed === '-' ||
    trimmed.toLowerCase() === 'null' ||
    trimmed.toLowerCase() === 'undefined'
  ) {
    return null;
  }
  return trimmed;
}
